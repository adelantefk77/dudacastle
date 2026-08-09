import { nanoid } from "nanoid";
import type { CardInstance, GameState } from "@dudacastle/shared";
import type { CardCatalog } from "./catalog.js";
import { getPlayer, unitSlotCapacity, occupiedSlotIndexes } from "./selectors.js";

/** Pierwsze wolne miejsce w obszarze gry (play_area) gracza, albo null jeśli brak. */
export function findFreeSlotIndex(state: GameState, matchPlayerId: string): number | null {
  const capacity = unitSlotCapacity(state, matchPlayerId);
  const occupied = occupiedSlotIndexes(state, matchPlayerId);
  for (let i = 0; i < capacity; i++) {
    if (!occupied.has(i)) return i;
  }
  return null;
}

/**
 * Przenosi kartę na stos odrzuconych. Wymaga `state`/`catalog`, bo Katapulta (v3 — powstała z
 * trwałego połączenia 2 Krasnoludów, zob. effect-resolver.ts "mergeIntoKatapulta") przy
 * odrzuceniu musi wrócić jako DWIE karty Krasnoluda, nie jedna karta Katapulty — to jedyne
 * miejsce, przez które przechodzą wszystkie odrzucenia jednostek, więc reguła jest tu scentralizowana.
 */
export function moveToDiscard(state: GameState, catalog: CardCatalog, card: CardInstance): void {
  const wasKrasnoludMerge = card.status.isKrasnoludMerge === true;
  card.zone = "discard";
  card.slotIndex = null;
  card.status.stackedOnInstanceId = undefined;
  card.status.isKrasnoludMerge = undefined;

  if (wasKrasnoludMerge) {
    const owner = getPlayer(state, card.ownerMatchPlayerId);
    const krasnoludDefId = `${owner.kingdomId}-krasnolud`;
    if (catalog.get(krasnoludDefId)) {
      // Ta karta wraca jako Krasnolud (nie zostaje "Katapultą" na stosie odrzuconych — inaczej
      // nielegalny, niekupowalny egzemplarz mógłby zostać potasowany z powrotem do talii startowej
      // i dobrany jak zwykła karta). Plus DRUGI, nowy egzemplarz Krasnoluda — razem 2 karty.
      card.definitionId = krasnoludDefId;
      const extraKrasnolud: CardInstance = {
        instanceId: nanoid(),
        definitionId: krasnoludDefId,
        ownerMatchPlayerId: card.ownerMatchPlayerId,
        zone: "discard",
        slotIndex: null,
        currentHp: 0,
        currentAtk: 0,
        status: {},
      };
      state.cards[extraKrasnolud.instanceId] = extraKrasnolud;
    }
  }
}

export function moveToHand(card: CardInstance): void {
  card.zone = "hand";
  card.slotIndex = null;
}
