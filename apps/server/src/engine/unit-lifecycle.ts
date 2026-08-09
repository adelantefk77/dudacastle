import type { CardInstance, GameState } from "@dudacastle/shared";
import type { CardCatalog } from "./catalog.js";
import { getUnitDefinition } from "./catalog.js";
import { drawFromStartingDeck } from "./deck-utils.js";
import { findFreeSlotIndex } from "./zones.js";

/**
 * Ustawia kartę w obszarze gry z bazowymi statystykami. UWAGA: nie odpala
 * ponownie zdolności on_play tej karty — wywołujące efekty (Spotkanie
 * Alchemika, Powstanie z Popiołów Feniksa) świadomie NIE łańcuchują dalszych
 * efektów on_play, żeby uniknąć nieograniczonej rekurencji efektów
 * generujących kolejne efekty. Zwykłe zagranie karty z ręki (PLAY_UNIT w
 * reducer.ts) odpala on_play osobno, przez własne wywołanie resolveEffect.
 */
export function placeUnitBaseStats(
  state: GameState,
  catalog: CardCatalog,
  card: CardInstance,
  slotIndex: number,
  extraHpBonus = 0,
): void {
  const def = getUnitDefinition(catalog, card.definitionId);
  card.zone = "play_area";
  card.slotIndex = slotIndex;
  card.status.enteredZoneOnTurn = state.turnNumber;
  card.status.hasAttacked = false;
  card.status.permanentHpBonus = (card.status.permanentHpBonus ?? 0) + extraHpBonus;
  card.currentHp = def.hp + card.status.permanentHpBonus;
  card.currentAtk = def.atk + (card.status.permanentAtkBonus ?? 0);
}

/**
 * Dobiera wierzchnią kartę z talii startowej gracza (z fallbackiem
 * przetasowania stosu odrzuconych) i od razu stawia ją w obszarze gry.
 * Używane przez efekty "Spotkanie Alchemika" i "Powstanie z popiołów".
 * Zwraca null, jeśli brak wolnego miejsca lub brak kart do dobrania.
 */
export function drawAndPlaceFromStartingDeck(
  state: GameState,
  catalog: CardCatalog,
  matchPlayerId: string,
  extraHpBonus = 0,
): CardInstance | null {
  const slotIndex = findFreeSlotIndex(state, matchPlayerId);
  if (slotIndex === null) return null;
  const [drawn] = drawFromStartingDeck(state, matchPlayerId, 1);
  if (!drawn) return null;
  placeUnitBaseStats(state, catalog, drawn, slotIndex, extraHpBonus);
  return drawn;
}
