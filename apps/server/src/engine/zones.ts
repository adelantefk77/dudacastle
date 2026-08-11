import { nanoid } from "nanoid";
import type { CardInstance, GameState, Zone } from "@dudacastle/shared";
import { BARRACKS_DEFINITION, MINE_DEFINITION, STRONGHOLD_DEFINITION, TOWER_DEFINITIONS } from "@dudacastle/shared";
import type { CardCatalog } from "./catalog.js";
import { getUnitDefinition } from "./catalog.js";
import { GameRuleError } from "./errors.js";
import { cardsInZone, getPlayer, unitSlotCapacity, occupiedSlotIndexes } from "./selectors.js";

/** Pierwsze wolne miejsce w obszarze gry (play_area) gracza, albo null jeśli brak. */
export function findFreeSlotIndex(state: GameState, matchPlayerId: string): number | null {
  const capacity = unitSlotCapacity(state, matchPlayerId);
  const occupied = occupiedSlotIndexes(state, matchPlayerId);
  for (let i = 0; i < capacity; i++) {
    if (!occupied.has(i)) return i;
  }
  return null;
}

export type InfrastructureZone = "tower" | "mine" | "barracks" | "stronghold";

export function infrastructureMechanicsFor(kind: InfrastructureZone) {
  if (kind === "tower") return TOWER_DEFINITIONS[0].mechanics;
  if (kind === "mine") return MINE_DEFINITION.mechanics;
  if (kind === "barracks") return BARRACKS_DEFINITION.mechanics;
  return STRONGHOLD_DEFINITION.mechanics;
}

/**
 * Przenosi jednostkę JUŻ będącą w obszarze gry (nie z ręki) do dowolnej innej strefy —
 * play_area albo dowolnej posiadanej infrastruktury (Wieża/Kopalnia/Koszary/Warownia). Współdzielone
 * przez Harpii Zryw/Galop, Powietrzny Transport i Zamieszanie (zob. simulator_v3.py
 * try_reposition_unit/try_zamieszanie/try_pegaz_transport — źródło pozwala tym zdolnościom
 * przenosić jednostki między WSZYSTKIMI strefami, nie tylko w obrębie play_area). W przeciwieństwie
 * do reducer.ts PLACE_IN_INFRASTRUCTURE (zagranie z ręki) NIE odpala on_play — to repozycjonowanie,
 * nie ponowne wejście do gry.
 */
export function relocateUnitToZone(
  state: GameState,
  catalog: CardCatalog,
  card: CardInstance,
  matchPlayerId: string,
  targetZone: Zone,
): void {
  const definition = getUnitDefinition(catalog, card.definitionId);

  if (targetZone === "play_area") {
    const slotIndex = findFreeSlotIndex(state, matchPlayerId);
    if (slotIndex === null) throw new GameRuleError("Brak wolnego miejsca w obszarze gry.", "NO_FREE_SLOT");
    card.zone = "play_area";
    card.slotIndex = slotIndex;
    card.status.readyToAct = true;
    return;
  }

  if (targetZone !== "tower" && targetZone !== "mine" && targetZone !== "barracks" && targetZone !== "stronghold") {
    throw new GameRuleError("Nieprawidłowa strefa docelowa.", "INVALID_TARGET_ZONE");
  }
  if (definition.infrastructureForbidden && targetZone !== "barracks") {
    throw new GameRuleError("Ta jednostka nie może zostać umieszczona w Wieży, Warowni ani Kopalni.", "INFRASTRUCTURE_FORBIDDEN");
  }
  const ownsInfra = cardsInZone(state, matchPlayerId, targetZone).some((c) => catalog.get(c.definitionId)?.type === "infrastructure");
  if (!ownsInfra) {
    throw new GameRuleError(`Gracz nie posiada karty "${targetZone}".`, "INFRASTRUCTURE_NOT_OWNED");
  }
  const mechanics = infrastructureMechanicsFor(targetZone);
  const occupantCount = cardsInZone(state, matchPlayerId, targetZone).filter(
    (c) => catalog.get(c.definitionId)?.type === "unit",
  ).length;
  if (occupantCount >= (mechanics.maxUnits ?? 1)) {
    throw new GameRuleError(`Limit jednostek w "${targetZone}" został osiągnięty.`, "INFRASTRUCTURE_FULL");
  }

  card.zone = targetZone;
  card.slotIndex = occupantCount;

  const towerHpBonus = targetZone === "tower" ? mechanics.unitHpBonus ?? 0 : 0;
  card.status.permanentHpBonus = (card.status.permanentHpBonus ?? 0) + towerHpBonus;
  card.currentHp = definition.hp + card.status.permanentHpBonus;

  if (targetZone === "barracks" || targetZone === "stronghold") {
    card.status.readyToAct = false;
    card.status.actionsTakenThisTurn = 0;
  } else {
    card.status.readyToAct = true;
  }
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
