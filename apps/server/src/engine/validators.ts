import type { CardInstance, GameAction, GameState } from "@dudacastle/shared";
import { GameRuleError } from "./errors.js";
import { currentPlayer, occupiedSlotIndexes, unitSlotCapacity } from "./selectors.js";

export function assertGameInProgress(state: GameState) {
  if (state.status !== "in_progress") {
    throw new GameRuleError("Rozgrywka nie jest w toku.", "GAME_NOT_IN_PROGRESS");
  }
}

export function assertIsCurrentPlayer(state: GameState, matchPlayerId: string) {
  const active = currentPlayer(state);
  if (active.matchPlayerId !== matchPlayerId) {
    throw new GameRuleError("To nie jest tura tego gracza.", "NOT_YOUR_TURN");
  }
  if (active.eliminated) {
    throw new GameRuleError("Gracz został wyeliminowany.", "PLAYER_ELIMINATED");
  }
}

/** I. Dobór — wyłącznie raz na początku tury: 2 karty ALBO 2 monety. */
export function assertDrawChoiceAvailable(state: GameState, matchPlayerId: string) {
  const player = currentPlayer(state);
  if (player.matchPlayerId !== matchPlayerId) return; // walidowane osobno przez assertIsCurrentPlayer
  if (player.hasMadeDrawChoiceThisTurn) {
    throw new GameRuleError(
      "Wybór doboru (karty albo monety) można wykonać tylko raz na początku tury.",
      "DRAW_CHOICE_ALREADY_MADE",
    );
  }
}

export function assertMainPhaseAction(state: GameState) {
  if (state.turnPhase !== "main") {
    throw new GameRuleError(
      "Ta akcja jest dostępna dopiero w etapie Rozgrywania, po dokonaniu wyboru doboru.",
      "WRONG_PHASE",
    );
  }
}

/** Limit miejsc na jednostki: 3 bazowo, 5 z Wieżą w grze (zob. selectors.unitSlotCapacity). */
export function assertFreeUnitSlot(state: GameState, matchPlayerId: string, slotIndex: number) {
  const capacity = unitSlotCapacity(state, matchPlayerId);
  if (slotIndex < 0 || slotIndex >= capacity) {
    throw new GameRuleError(
      `Miejsce ${slotIndex} przekracza limit slotów (${capacity}). Kup Wieżę, aby zwiększyć limit z 3 do 5.`,
      "SLOT_OUT_OF_RANGE",
    );
  }
  if (occupiedSlotIndexes(state, matchPlayerId).has(slotIndex)) {
    throw new GameRuleError("To miejsce w obszarze gry jest już zajęte.", "SLOT_OCCUPIED");
  }
}

export function assertSufficientCoins(state: GameState, matchPlayerId: string, cost: number) {
  const player = state.players.find((p) => p.matchPlayerId === matchPlayerId);
  if (!player || player.coins < cost) {
    throw new GameRuleError(`Niewystarczająca liczba monet (potrzeba ${cost}).`, "INSUFFICIENT_COINS");
  }
}

export function assertHasNotAttackedThisTurn(attacker: CardInstance) {
  if (attacker.status.hasAttacked) {
    throw new GameRuleError(
      "Ta jednostka wykonała już swój atak w tej turze (obrażenia i ataki nie przechodzą między turami).",
      "ALREADY_ATTACKED",
    );
  }
}

export function assertAction(condition: unknown, message: string, code: string): asserts condition {
  if (!condition) throw new GameRuleError(message, code);
}

export type { GameAction };
