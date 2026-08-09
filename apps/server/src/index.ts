import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { Server as SocketIOServer } from "socket.io";
import { z } from "zod";
import type { GameAction } from "@dudacastle/shared";
import { KINGDOMS } from "@dudacastle/shared";
import { buildCardCatalog } from "./engine/catalog.js";
import { applyAction } from "./engine/reducer.js";
import { GameRuleError } from "./engine/errors.js";
import { MatchStore } from "./engine/match-manager.js";
import { decideBotAction } from "./engine/bot.js";
import { currentPlayer } from "./engine/selectors.js";
import {
  DuplicateKingdomError,
  LobbyAlreadyStartedError,
  LobbyFullError,
  LobbyManager,
  LobbyNotFoundError,
} from "./engine/lobby-manager.js";
import { SessionManager } from "./engine/session-manager.js";
import type { PersistenceAdapter } from "./persistence/adapter.js";
import { NoopPersistenceAdapter } from "./persistence/adapter.js";

const PORT = Number(process.env.PORT ?? 4000);
/** Co ile zdarzeń zapisujemy pełny snapshot GameState — ogranicza replay przy reconnect. */
const SNAPSHOT_EVERY_N_EVENTS = 20;
/** Odstęp między kolejnymi akcjami bota — na tyle długi, żeby ruchy dało się śledzić na ekranie. */
const BOT_ACTION_DELAY_MS = 600;
/** Twardy limit akcji bota w jednej turze — zabezpieczenie przed pętlą przy błędzie w decideBotAction. */
const BOT_MAX_ACTIONS_PER_CHAIN = 30;
const VALID_KINGDOM_IDS = KINGDOMS.map((k) => k.id) as [string, ...string[]];

const app = Fastify({ logger: true });
await app.register(cors, { origin: true }); // TODO: ograniczyć do originu frontendu przed produkcją

const matchStore = new MatchStore();
const lobbyManager = new LobbyManager();
const sessionManager = new SessionManager();
const catalog = buildCardCatalog();

// Trwałość jest opcjonalna: bez DATABASE_URL gra działa w pełni w pamięci procesu.
// Import Prisma jest dynamiczny (nie w top-level), żeby brak `@prisma/client` generated
// output (np. przed pierwszym `npx prisma generate`) nie wywalał serwera, który w ogóle
// nie chce używać bazy danych.
let persistence: PersistenceAdapter = new NoopPersistenceAdapter();
const sequenceNoByMatch = new Map<string, number>();

if (process.env.DATABASE_URL) {
  const [{ PrismaClient }, { PrismaPersistenceAdapter }] = await Promise.all([
    import("@prisma/client"),
    import("./persistence/prisma-adapter.js"),
  ]);
  persistence = new PrismaPersistenceAdapter(new PrismaClient());
  app.log.info("Trwałość Prisma aktywna (DATABASE_URL ustawione).");
} else {
  app.log.warn("DATABASE_URL nie ustawione — mecze żyją wyłącznie w pamięci procesu (brak historii/reconnectu po restarcie).");
}

const createLobbySchema = z.object({
  maxPlayers: z.number().int().min(2).max(5),
  kingdomId: z.enum(VALID_KINGDOM_IDS),
  userId: z.string().min(1),
  displayName: z.string().min(1).max(40),
  /** Natychmiast dopełnia pozostałe miejsca botami i startuje mecz bez czekania na innych graczy. */
  fillWithBots: z.boolean().optional(),
});

const joinLobbySchema = z.object({
  kingdomId: z.enum(VALID_KINGDOM_IDS),
  userId: z.string().min(1),
  displayName: z.string().min(1).max(40),
});

/**
 * Jedyne miejsce, które mutuje mecz: aplikuje akcję przez silnik, rozgłasza nowy stan i
 * zdarzenia, i asynchronicznie zapisuje trwałość. Używane zarówno dla akcji żywych graczy
 * (po uwierzytelnieniu socketu), jak i dla akcji generowanych przez boty — dzięki temu obie
 * ścieżki mają identyczną walidację reguł (ten sam `applyAction`) i identyczny efekt uboczny.
 */
function processAction(matchId: string, action: GameAction) {
  const state = matchStore.get(matchId);
  if (!state) throw new GameRuleError("Nie znaleziono meczu.", "MATCH_NOT_FOUND");
  const result = applyAction(state, action, catalog);
  matchStore.set(matchId, result.state);

  // `reducer.ts` numeruje zdarzenia lokalnie od 0 w ramach JEDNEJ akcji (żeby applyAction
  // pozostało czystą funkcją bez zewnętrznego licznika) — tu nadajemy im globalny,
  // monotoniczny numer w ramach całego meczu, wymagany przez unique(matchId, sequenceNo)
  // w MatchEvent i potrzebny do poprawnego replayu/reconnectu.
  const baseSeq = sequenceNoByMatch.get(matchId) ?? 0;
  const globalEvents = result.events.map((ev, i) => ({ ...ev, sequenceNo: baseSeq + i }));
  const newTotal = baseSeq + globalEvents.length;
  sequenceNoByMatch.set(matchId, newTotal);

  io.to(matchId).emit("state_sync", result.state);
  io.to(matchId).emit("events", globalEvents);

  void persistence.recordEvents(matchId, globalEvents).catch((err) => app.log.error(err));
  if (Math.floor(newTotal / SNAPSHOT_EVERY_N_EVENTS) > Math.floor(baseSeq / SNAPSHOT_EVERY_N_EVENTS)) {
    void persistence.saveSnapshot(matchId, newTotal, result.state).catch((err) => app.log.error(err));
  }
  if (result.state.status === "finished") {
    void persistence.finalizeMatch(matchId, result.state.winnerMatchPlayerId).catch((err) => app.log.error(err));
  }
  return result;
}

/**
 * Gdy po jakiejkolwiek akcji tura należy do bota, odpala łańcuch jego ruchów z odstępem
 * czasowym (przez setTimeout, nie ciasną pętlą) — po każdej akcji sprawdza od nowa, czy wciąż
 * gra bot (ta sama tura dalej, albo kolejny bot w rzędzie przy meczu z wieloma botami).
 */
function maybeAdvanceBots(matchId: string, chainLength = 0): void {
  const state = matchStore.get(matchId);
  if (!state || state.status !== "in_progress") return;
  if (!currentPlayer(state).isBot) return;
  if (chainLength >= BOT_MAX_ACTIONS_PER_CHAIN) {
    app.log.error({ matchId }, "Bot przekroczył limit akcji w turze — przerywam łańcuch, żeby uniknąć pętli.");
    return;
  }

  setTimeout(() => {
    const freshState = matchStore.get(matchId);
    if (!freshState || freshState.status !== "in_progress") return;
    const bot = currentPlayer(freshState);
    if (!bot.isBot) return;

    try {
      const action = decideBotAction(freshState, bot.matchPlayerId, catalog);
      processAction(matchId, action);
    } catch (err) {
      app.log.error({ err, matchId, matchPlayerId: bot.matchPlayerId }, "Nieprawidłowa akcja bota — wymuszam koniec tury.");
      try {
        processAction(matchId, { type: "END_TURN", matchPlayerId: bot.matchPlayerId });
      } catch (endTurnErr) {
        app.log.error({ endTurnErr, matchId }, "Nie udało się wymusić końca tury bota — zatrzymuję łańcuch.");
        return;
      }
    }
    maybeAdvanceBots(matchId, chainLength + 1);
  }, BOT_ACTION_DELAY_MS);
}

async function startMatchFromLobby(lobbyId: string) {
  const lobby = lobbyManager.get(lobbyId);
  if (!lobby || !lobbyManager.isReady(lobby)) return null;
  const seats = lobbyManager.toSeatConfigs(lobby);
  const state = matchStore.create(seats);
  lobbyManager.markStarted(lobbyId, state.matchId);
  for (const seat of seats) sessionManager.attachMatch(seat.matchPlayerId, state.matchId);
  sequenceNoByMatch.set(state.matchId, 0);
  persistence.createMatch(state.matchId, seats).catch((err) => app.log.error(err));
  return state.matchId;
}

// POST /lobbies — pierwszy gracz zakłada poczekalnię i wybiera swoje królestwo.
// `fillWithBots: true` dopełnia od razu resztę miejsc botami i startuje mecz w tej samej odpowiedzi.
app.post("/lobbies", async (request, reply) => {
  const parsed = createLobbySchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ message: "Nieprawidłowe dane.", issues: parsed.error.issues });

  const { maxPlayers, kingdomId, userId, displayName, fillWithBots } = parsed.data;
  const { lobby, matchPlayerId } = lobbyManager.create(maxPlayers, { kingdomId, userId, displayName });
  const token = sessionManager.register(matchPlayerId);

  let matchId: string | null = null;
  if (fillWithBots) {
    lobbyManager.fillWithBots(lobby.id);
    matchId = await startMatchFromLobby(lobby.id);
    if (matchId) maybeAdvanceBots(matchId);
  }

  return reply.send({ lobbyId: lobby.id, matchPlayerId, token, maxPlayers: lobby.maxPlayers, seats: lobby.seats, matchId });
});

// POST /lobbies/:lobbyId/join — kolejny gracz dołącza; gdy komplet miejsc, mecz startuje automatycznie.
app.post<{ Params: { lobbyId: string } }>("/lobbies/:lobbyId/join", async (request, reply) => {
  const parsed = joinLobbySchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ message: "Nieprawidłowe dane.", issues: parsed.error.issues });

  try {
    const { lobby, matchPlayerId } = lobbyManager.join(request.params.lobbyId, parsed.data);
    const token = sessionManager.register(matchPlayerId);
    let matchId: string | null = null;
    if (lobbyManager.isReady(lobby)) {
      matchId = await startMatchFromLobby(lobby.id);
      if (matchId) {
        io.to(`lobby:${lobby.id}`).emit("match_started", { matchId });
        maybeAdvanceBots(matchId);
      }
    }
    return reply.send({ lobbyId: lobby.id, matchPlayerId, token, maxPlayers: lobby.maxPlayers, seats: lobby.seats, matchId });
  } catch (err) {
    if (err instanceof LobbyNotFoundError) return reply.status(404).send({ message: err.message });
    if (err instanceof LobbyFullError || err instanceof LobbyAlreadyStartedError || err instanceof DuplicateKingdomError) {
      return reply.status(409).send({ message: err.message });
    }
    throw err;
  }
});

app.get<{ Params: { lobbyId: string } }>("/lobbies/:lobbyId", async (request, reply) => {
  const lobby = lobbyManager.get(request.params.lobbyId);
  if (!lobby) return reply.status(404).send({ message: "Nieznane lobby." });
  return reply.send({ lobbyId: lobby.id, maxPlayers: lobby.maxPlayers, seats: lobby.seats, matchId: lobby.matchId });
});

// Serwuje zbudowany frontend (apps/web/dist) z TEGO SAMEGO procesu/originu co API i WebSocket —
// jeden serwis na Railway zamiast dwóch, bez CORS i bez cross-origin WebSocketu w produkcji.
// W trybie dev (`npm run dev:web` na osobnym porcie Vite) ten katalog jeszcze nie istnieje —
// rejestracja jest wtedy pomijana i serwer działa wyłącznie jako API/WebSocket, tak jak dotąd.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST_DIR = path.join(__dirname, "../../web/dist");
if (existsSync(WEB_DIST_DIR)) {
  await app.register(fastifyStatic, { root: WEB_DIST_DIR });
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET" || request.url.startsWith("/lobbies")) {
      return reply.status(404).send({ message: "Nie znaleziono." });
    }
    return reply.sendFile("index.html");
  });
  app.log.info(`Serwowanie zbudowanego frontendu z ${WEB_DIST_DIR}.`);
} else {
  app.log.warn(`Katalog zbudowanego frontendu (${WEB_DIST_DIR}) nie istnieje — serwer działa wyłącznie jako API/WebSocket.`);
}

const io = new SocketIOServer(app.server, {
  cors: { origin: "*" }, // TODO: ograniczyć do originu frontendu przed produkcją
});

interface SocketAuth {
  matchId: string;
  matchPlayerId: string;
}

io.on("connection", (socket) => {
  socket.on("join_lobby", ({ lobbyId }: { lobbyId: string }) => {
    socket.join(`lobby:${lobbyId}`);
  });

  // Uwierzytelnienie połączenia dla całego meczu: klient MUSI przedstawić token wydany przy
  // zajęciu miejsca w lobby (POST /lobbies lub /lobbies/:id/join). Bez poprawnego tokenu socket
  // nie dołącza do pokoju i nie dostaje stanu gry — usuwa to lukę, w której dowolny klient mógł
  // podać cudzy matchPlayerId i sterować grą w jego imieniu.
  socket.on("join_match", ({ matchId, matchPlayerId, token }: { matchId: string; matchPlayerId: string; token: string }) => {
    const state = matchStore.get(matchId);
    if (!state) {
      socket.emit("error", { message: "Nie znaleziono meczu." });
      return;
    }
    if (!token || !matchPlayerId || !sessionManager.verify(token, matchId, matchPlayerId)) {
      socket.emit("error", { message: "Brak autoryzacji do tego meczu." });
      return;
    }
    (socket.data as Partial<SocketAuth>).matchId = matchId;
    (socket.data as Partial<SocketAuth>).matchPlayerId = matchPlayerId;
    socket.join(matchId);
    // Uwaga: w pełnej implementacji stan wysyłany do każdego klienta musi być
    // filtrowany per-gracz (np. ukrywanie nieznanej wierzchniej karty talii
    // królestwa przeciwnika) — tutaj wysyłamy pełny stan dla czytelności szkieletu.
    socket.emit("state_sync", state);
  });

  socket.on("action", ({ matchId, action }: { matchId: string; action: GameAction }) => {
    const auth = socket.data as Partial<SocketAuth>;
    if (!auth.matchId || auth.matchId !== matchId || auth.matchPlayerId !== action.matchPlayerId) {
      socket.emit("action_rejected", {
        code: "UNAUTHORIZED",
        message: "Ten socket nie jest autoryzowany do wykonywania akcji jako ten gracz.",
      });
      return;
    }
    try {
      processAction(matchId, action);
      maybeAdvanceBots(matchId);
    } catch (err) {
      if (err instanceof GameRuleError) {
        socket.emit("action_rejected", { code: err.code, message: err.message });
      } else {
        app.log.error(err);
        socket.emit("action_rejected", { code: "INTERNAL_ERROR", message: "Błąd serwera." });
      }
    }
  });
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  app.log.info(`Serwer gry nasłuchuje na porcie ${PORT}`);
});
