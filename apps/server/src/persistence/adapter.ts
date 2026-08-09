import type { GameEvent, GameState } from "@dudacastle/shared";
import type { SeatConfig } from "../engine/match-manager.js";

/**
 * Warstwa trwałości jest opcjonalna: silnik gry (apps/server/src/engine/*) działa w całości
 * w pamięci procesu (zob. MatchStore) i nigdy nie zależy bezpośrednio od tego interfejsu.
 * Adapter tylko OBSERWUJE mecze — zapisuje historię, żeby przetrwała restart procesu i żeby
 * dało się odtworzyć stan po reconnect (snapshot + replay zdarzeń od niego), oraz żeby
 * istniała historia rozgrywek do przyszłego matchmakingu/statystyk.
 */
export interface PersistenceAdapter {
  createMatch(matchId: string, seats: SeatConfig[]): Promise<void>;
  recordEvents(matchId: string, events: GameEvent[]): Promise<void>;
  saveSnapshot(matchId: string, sequenceNo: number, state: GameState): Promise<void>;
  finalizeMatch(matchId: string, winnerMatchPlayerId: string | null): Promise<void>;
}

/** Domyślny adapter, gdy nie skonfigurowano DATABASE_URL — gra działa w pełni bez bazy danych. */
export class NoopPersistenceAdapter implements PersistenceAdapter {
  async createMatch(): Promise<void> {}
  async recordEvents(): Promise<void> {}
  async saveSnapshot(): Promise<void> {}
  async finalizeMatch(): Promise<void> {}
}
