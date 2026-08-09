import type { CardInstance, GameState, PlayerState, Zone } from "@dudacastle/shared";
import { TOWER_DEFINITIONS } from "@dudacastle/shared";

const TOWER_IDS = new Set(TOWER_DEFINITIONS.map((t) => t.id));

export function getPlayer(state: GameState, matchPlayerId: string): PlayerState {
  const player = state.players.find((p) => p.matchPlayerId === matchPlayerId);
  if (!player) throw new Error(`Nieznany gracz: ${matchPlayerId}`);
  return player;
}

export function cardsInZone(state: GameState, matchPlayerId: string, zone: Zone): CardInstance[] {
  return Object.values(state.cards).filter(
    (c) => c.ownerMatchPlayerId === matchPlayerId && c.zone === zone,
  );
}

export function currentPlayer(state: GameState): PlayerState {
  return getPlayer(state, state.turnOrder[state.currentPlayerIndex]);
}

/**
 * Liczba miejsc w zwykłym obszarze gry (play_area): stała wartość 3 (sekcja 4).
 * Wieża NIE rozszerza tej strefy — daje własne, odrębne miejsca (zob. totalUnitCapacity),
 * zgodnie z sekcją 8: "jednostki znajdujące się w Wieży" to odrębny zbiór od play_area.
 */
export function unitSlotCapacity(_state: GameState, _matchPlayerId: string): number {
  return 3;
}

/** Łączna liczba miejsc na jednostki (play_area + Wieża, jeśli gracz ją posiada) — "z 3 do 5" z sekcji 8. */
export function totalUnitCapacity(state: GameState, matchPlayerId: string): number {
  const hasTower = Object.values(state.cards).some(
    (c) => c.ownerMatchPlayerId === matchPlayerId && c.zone === "tower" && TOWER_IDS.has(c.definitionId),
  );
  return unitSlotCapacity(state, matchPlayerId) + (hasTower ? 2 : 0);
}

export function occupiedSlotIndexes(state: GameState, matchPlayerId: string): Set<number> {
  return new Set(
    cardsInZone(state, matchPlayerId, "play_area")
      .map((c) => c.slotIndex)
      .filter((i): i is number => i !== null),
  );
}
