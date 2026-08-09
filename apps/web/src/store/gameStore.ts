import { create } from "zustand";
import type { GameAction, GameEvent, GameState } from "@dudacastle/shared";
import { createLobby, joinLobby, type LobbyResponse } from "../lib/api";
import { loadIdentity, saveDisplayName } from "../lib/identity";
import { getSocket } from "../lib/socket";

export type ScreenPhase = "landing" | "waiting" | "playing";

interface GameStore {
  phase: ScreenPhase;
  userId: string;
  displayName: string;
  lobby: LobbyResponse | null;
  myMatchPlayerId: string | null;
  /** Token wydany przy zajęciu miejsca (POST /lobbies[/join]) — wymagany, żeby socket mógł dołączyć do meczu jako ten gracz. */
  sessionToken: string | null;
  matchId: string | null;
  gameState: GameState | null;
  recentEvents: GameEvent[];
  lastError: string | null;
  connecting: boolean;

  setDisplayName: (name: string) => void;
  createNewLobby: (kingdomId: string, maxPlayers: number, fillWithBots?: boolean) => Promise<void>;
  joinExistingLobby: (lobbyId: string, kingdomId: string) => Promise<void>;
  sendAction: (action: GameAction) => void;
  dismissError: () => void;
  resetToLanding: () => void;
}

function attachMatchListeners(set: (partial: Partial<GameStore>) => void, get: () => GameStore, matchId: string) {
  const { myMatchPlayerId, sessionToken } = get();
  const socket = getSocket();

  // Autoryzacja (join_match) jest przypisana do KONKRETNEGO połączenia transportowego (socket.data
  // po stronie serwera) — po każdym rozłączeniu (sen laptopa, zgubiony WiFi, uśpiona karta na
  // telefonie...) socket.io-client sam nawiązuje nowe połączenie, ale serwer nie pamięta już, kim
  // był ten socket. Bez ponownego join_match przy KAŻDYM "connect" (nie tylko pierwszym) każda
  // kolejna akcja kończy się "Ten socket nie jest autoryzowany..." mimo że gracz nic złego nie zrobił.
  const authenticate = () => socket.emit("join_match", { matchId, matchPlayerId: myMatchPlayerId, token: sessionToken });
  authenticate();
  socket.off("connect");
  socket.on("connect", authenticate);

  socket.off("state_sync");
  socket.off("events");
  socket.off("action_rejected");
  socket.off("error");
  socket.on("state_sync", (state: GameState) => set({ gameState: state, phase: "playing" }));
  socket.on("events", (events: GameEvent[]) => set({ recentEvents: events }));
  socket.on("action_rejected", (payload: { code?: string; message: string }) => set({ lastError: payload.message }));
  socket.on("error", (payload: { message: string }) => set({ lastError: payload.message }));
}

function attachLobbyListeners(set: (partial: Partial<GameStore>) => void, get: () => GameStore, lobbyId: string) {
  const socket = getSocket();
  // Jak w attachMatchListeners: pokój Socket.IO jest przypisany do połączenia, więc reconnect w
  // poczekalni (np. host traci WiFi zanim reszta dołączy) gubi członkostwo w `lobby:${lobbyId}` —
  // bez ponownego join_lobby przy każdym "connect" host nigdy nie dostałby "match_started".
  const joinLobbyRoom = () => socket.emit("join_lobby", { lobbyId });
  joinLobbyRoom();
  socket.off("connect");
  socket.on("connect", joinLobbyRoom);
  socket.off("match_started");
  socket.on("match_started", ({ matchId }: { matchId: string }) => {
    set({ matchId, phase: "playing" });
    attachMatchListeners(set, get, matchId);
  });
}

const identity = loadIdentity();

export const useGameStore = create<GameStore>((set, get) => ({
  phase: "landing",
  userId: identity.userId,
  displayName: identity.displayName,
  lobby: null,
  myMatchPlayerId: null,
  sessionToken: null,
  matchId: null,
  gameState: null,
  recentEvents: [],
  lastError: null,
  connecting: false,

  setDisplayName: (name) => {
    const updated = saveDisplayName(name);
    set({ displayName: updated.displayName });
  },

  createNewLobby: async (kingdomId, maxPlayers, fillWithBots) => {
    set({ connecting: true, lastError: null });
    try {
      const { userId, displayName } = get();
      const lobby = await createLobby({ maxPlayers, kingdomId, userId, displayName, fillWithBots });
      set({ lobby, myMatchPlayerId: lobby.matchPlayerId, sessionToken: lobby.token, connecting: false });
      if (lobby.matchId) {
        set({ matchId: lobby.matchId, phase: "playing" });
        attachMatchListeners(set, get, lobby.matchId);
      } else {
        set({ phase: "waiting" });
        attachLobbyListeners(set, get, lobby.lobbyId);
      }
    } catch (err) {
      set({ lastError: (err as Error).message, connecting: false });
    }
  },

  joinExistingLobby: async (lobbyId, kingdomId) => {
    set({ connecting: true, lastError: null });
    try {
      const { userId, displayName } = get();
      const lobby = await joinLobby(lobbyId, { kingdomId, userId, displayName });
      set({ lobby, myMatchPlayerId: lobby.matchPlayerId, sessionToken: lobby.token, connecting: false });
      if (lobby.matchId) {
        set({ matchId: lobby.matchId, phase: "playing" });
        attachMatchListeners(set, get, lobby.matchId);
      } else {
        set({ phase: "waiting" });
        attachLobbyListeners(set, get, lobby.lobbyId);
      }
    } catch (err) {
      set({ lastError: (err as Error).message, connecting: false });
    }
  },

  sendAction: (action) => {
    const { matchId } = get();
    if (!matchId) return;
    getSocket().emit("action", { matchId, action });
  },

  dismissError: () => set({ lastError: null }),

  resetToLanding: () =>
    set({
      phase: "landing",
      lobby: null,
      myMatchPlayerId: null,
      sessionToken: null,
      matchId: null,
      gameState: null,
      recentEvents: [],
      lastError: null,
    }),
}));
