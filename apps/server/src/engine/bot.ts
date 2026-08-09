import type { CardInstance, GameAction, GameState } from "@dudacastle/shared";
import { BATTLEFIELD_ZONES } from "@dudacastle/shared";
import type { CardCatalog } from "./catalog.js";
import { getUnitDefinition } from "./catalog.js";
import { canAttackerHitTargetCategory } from "./combat.js";
import { findFreeSlotIndex } from "./zones.js";
import { cardsInZone, getPlayer } from "./selectors.js";

/** UNIT_COST (v3 — zob. cards.py): 6→5. */
const UNIT_PURCHASE_COST = 5;

function battlefieldUnitsOf(state: GameState, catalog: CardCatalog, matchPlayerId: string): CardInstance[] {
  return Object.values(state.cards).filter(
    (c) =>
      c.ownerMatchPlayerId === matchPlayerId &&
      BATTLEFIELD_ZONES.includes(c.zone) &&
      catalog.get(c.definitionId)?.type === "unit",
  );
}

function canAct(card: CardInstance): boolean {
  if ((card.zone === "barracks" || card.zone === "stronghold") && card.status.readyToAct === false) return false;
  return !card.status.hasAttacked;
}

/** Czy przeciwnik ma jakąkolwiek jednostkę w grze, w tym w Warowni (blokuje atak bezpośredni w Królestwo). */
function hasAnyUnitAnywhere(state: GameState, catalog: CardCatalog, matchPlayerId: string): boolean {
  return Object.values(state.cards).some(
    (c) => c.ownerMatchPlayerId === matchPlayerId && BATTLEFIELD_ZONES.includes(c.zone) && catalog.get(c.definitionId)?.type === "unit",
  );
}

/**
 * Bot serwera — celowo prosty (bez zdolności aktywowanych, kart Wydarzeń, infrastruktury,
 * ataków łączonych): DRAW/TAKE_COINS w fazie doboru, potem w pętli gra jednostki z ręki na
 * wolne miejsca, kupuje jednostki gdy stać, i atakuje jednostkami, które jeszcze mogą działać.
 * Gdy nie ma już nic sensownego do zrobienia, kończy turę. Wystarcza, by dać żywemu graczowi
 * realnego przeciwnika bez wymogu drugiego człowieka.
 */
export function decideBotAction(state: GameState, matchPlayerId: string, catalog: CardCatalog): GameAction {
  const player = getPlayer(state, matchPlayerId);

  if (state.turnPhase === "draw") {
    return player.coins < UNIT_PURCHASE_COST
      ? { type: "TAKE_COINS", matchPlayerId }
      : { type: "DRAW_CARDS", matchPlayerId };
  }

  const hand = cardsInZone(state, matchPlayerId, "hand");
  const handUnit = hand.find((c) => catalog.get(c.definitionId)?.type === "unit");
  if (handUnit) {
    const freeSlot = findFreeSlotIndex(state, matchPlayerId);
    if (freeSlot !== null) {
      return { type: "PLAY_UNIT", matchPlayerId, cardInstanceId: handUnit.instanceId, slotIndex: freeSlot };
    }
  }

  if (player.coins >= UNIT_PURCHASE_COST) {
    return { type: "BUY_UNIT", matchPlayerId };
  }

  const opponents = state.players.filter((p) => p.matchPlayerId !== matchPlayerId && !p.eliminated);
  // Kopalnia nie daje prawa do ataku (zob. combat.ts requireOwnedActingCard).
  for (const attacker of battlefieldUnitsOf(state, catalog, matchPlayerId).filter((c) => c.zone !== "mine")) {
    if (!canAct(attacker)) continue;
    const attackerDef = getUnitDefinition(catalog, attacker.definitionId);
    const effectiveCanTarget = attacker.zone === "tower" ? "land_and_air" : attackerDef.canTarget;
    const canStrikeIgnoringUnits = attackerDef.abilities.some((a) => a.effectKey === "directOrInfraKillInsteadOfAttack");

    for (const opponent of opponents) {
      if (opponent.untargetableTurnsRemaining > 0) continue;
      const enemyUnits = battlefieldUnitsOf(state, catalog, opponent.matchPlayerId).filter((t) => t.zone !== "stronghold");
      const target = enemyUnits.find((t) =>
        canAttackerHitTargetCategory(effectiveCanTarget, getUnitDefinition(catalog, t.definitionId).targetCategory),
      );
      if (target) {
        return {
          type: "ATTACK",
          matchPlayerId,
          attackerInstanceIds: [attacker.instanceId],
          targets: [{ targetInstanceId: target.instanceId, targetPlayerId: opponent.matchPlayerId }],
        };
      }

      // Każda jednostka może uderzyć wprost w Królestwo, jeśli przeciwnik nie ma żadnych
      // jednostek (nawet w Warowni) — Jadowity Prysk dodatkowo pomija istniejące jednostki.
      if (canStrikeIgnoringUnits || !hasAnyUnitAnywhere(state, catalog, opponent.matchPlayerId)) {
        return {
          type: "ATTACK",
          matchPlayerId,
          attackerInstanceIds: [attacker.instanceId],
          targets: [{ targetInstanceId: "kingdom", targetPlayerId: opponent.matchPlayerId }],
        };
      }
    }
  }

  return { type: "END_TURN", matchPlayerId };
}
