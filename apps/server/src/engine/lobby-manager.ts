import { nanoid } from "nanoid";
import { KINGDOMS } from "@dudacastle/shared";
import type { SeatConfig } from "./match-manager.js";

/**
 * Rozgrywka (GameState) wymaga znajomości WSZYSTKICH miejsc z góry (zob. match-manager.ts —
 * talie/HP/infrastruktura są przygotowywane raz, przy starcie). Lobby to poczekalnia PRZED tym
 * momentem: gracze dołączają pojedynczo przez `lobbyId` (np. link wysłany znajomemu), a mecz
 * startuje automatycznie, gdy liczba miejsc osiągnie `maxPlayers`.
 */
export interface LobbySeat {
  matchPlayerId: string;
  userId: string;
  kingdomId: string;
  displayName: string;
  isBot?: boolean;
}

export interface Lobby {
  id: string;
  maxPlayers: number;
  seats: LobbySeat[];
  matchId: string | null;
}

export class LobbyFullError extends Error {}
export class LobbyNotFoundError extends Error {}
export class LobbyAlreadyStartedError extends Error {}
export class DuplicateKingdomError extends Error {}

export class LobbyManager {
  private lobbies = new Map<string, Lobby>();

  create(maxPlayers: number, firstSeat: Omit<LobbySeat, "matchPlayerId">): { lobby: Lobby; matchPlayerId: string } {
    const matchPlayerId = nanoid();
    const lobby: Lobby = {
      id: nanoid(10),
      maxPlayers,
      seats: [{ ...firstSeat, matchPlayerId }],
      matchId: null,
    };
    this.lobbies.set(lobby.id, lobby);
    return { lobby, matchPlayerId };
  }

  join(lobbyId: string, seat: Omit<LobbySeat, "matchPlayerId">): { lobby: Lobby; matchPlayerId: string } {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) throw new LobbyNotFoundError(`Nieznane lobby: ${lobbyId}`);
    if (lobby.matchId) throw new LobbyAlreadyStartedError("Ten mecz już się rozpoczął.");
    if (lobby.seats.length >= lobby.maxPlayers) throw new LobbyFullError("Lobby jest już pełne.");
    if (lobby.seats.some((s) => s.kingdomId === seat.kingdomId)) {
      throw new DuplicateKingdomError("To królestwo jest już zajęte w tym meczu.");
    }
    const matchPlayerId = nanoid();
    lobby.seats.push({ ...seat, matchPlayerId });
    return { lobby, matchPlayerId };
  }

  get(lobbyId: string): Lobby | undefined {
    return this.lobbies.get(lobbyId);
  }

  isReady(lobby: Lobby): boolean {
    return lobby.seats.length === lobby.maxPlayers;
  }

  markStarted(lobbyId: string, matchId: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (lobby) lobby.matchId = matchId;
  }

  /** Dopełnia pozostałe (jeszcze nieobsadzone) miejsca botami — po jednym na dostępne, wolne królestwo. */
  fillWithBots(lobbyId: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) throw new LobbyNotFoundError(`Nieznane lobby: ${lobbyId}`);
    if (lobby.matchId) throw new LobbyAlreadyStartedError("Ten mecz już się rozpoczął.");
    const takenKingdoms = new Set(lobby.seats.map((s) => s.kingdomId));
    const availableKingdoms = KINGDOMS.filter((k) => !takenKingdoms.has(k.id));
    while (lobby.seats.length < lobby.maxPlayers && availableKingdoms.length > 0) {
      const kingdom = availableKingdoms.shift()!;
      lobby.seats.push({
        matchPlayerId: nanoid(),
        userId: `bot-${nanoid(8)}`,
        kingdomId: kingdom.id,
        displayName: `Bot (${kingdom.name})`,
        isBot: true,
      });
    }
  }

  toSeatConfigs(lobby: Lobby): SeatConfig[] {
    return lobby.seats.map((s) => ({
      matchPlayerId: s.matchPlayerId,
      userId: s.userId,
      kingdomId: s.kingdomId,
      isBot: s.isBot ?? false,
    }));
  }
}
