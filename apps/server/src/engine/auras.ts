import type { CardInstance, GameState } from "@dudacastle/shared";
import { BATTLEFIELD_ZONES } from "@dudacastle/shared";
import type { CardCatalog } from "./catalog.js";
import { getUnitDefinition } from "./catalog.js";
import { getPlayer } from "./selectors.js";

/** Tylko jednostki (nie same karty infrastruktury, np. Wieża zajmująca zone "tower") w strefach liczących się jako obszar gry. */
function battlefieldUnitsOf(state: GameState, catalog: CardCatalog, matchPlayerId: string): CardInstance[] {
  return Object.values(state.cards).filter(
    (c) =>
      c.ownerMatchPlayerId === matchPlayerId &&
      BATTLEFIELD_ZONES.includes(c.zone) &&
      catalog.get(c.definitionId)?.type === "unit",
  );
}

/**
 * Przelicza bonusy HP/ATK pochodzące z aur pasywnych (Śpiew Natury, Zbrojne
 * Pospolite Ruszenie, Natchnienie, Płatnerz...) dla wszystkich jednostek w
 * grze. Wywoływane po każdej akcji (idempotentnie), żeby aury reagowały na
 * zmiany składu obszaru gry (np. dobicie drugiego "Ludzie" aktywuje Zbrojne
 * Pospolite Ruszenie natychmiast), bez potrzeby ręcznego wywoływania efektu
 * przy każdym possible triggerze.
 *
 * WAŻNE: nie resetuje `currentHp`/`currentAtk` do wartości bazowej — to
 * zniszczyłoby informację o obrażeniach otrzymanych w tej turze. Zamiast
 * tego liczy nowy sumaryczny bonus aury i aplikuje tylko RÓŻNICĘ względem
 * poprzednio zastosowanego bonusu (zapisanego w status.auraHpBonus/AtkBonus).
 */
export function recomputeAuras(state: GameState, catalog: CardCatalog): void {
  for (const player of state.players) {
    if (player.eliminated) continue;
    const units = battlefieldUnitsOf(state, catalog, player.matchPlayerId);
    const unitNames = units.map((u) => getUnitDefinition(catalog, u.definitionId).name);

    let flatAtkBonus = 0; // Natchnienie itp. — jednakowy dla wszystkich jednostek gracza
    let flatHpBonus = player.permanentUnitHpAura; // Płatnerz — trwały, dotyczy też przyszłych jednostek

    for (const unit of units) {
      const def = getUnitDefinition(catalog, unit.definitionId);
      for (const ability of def.abilities) {
        if (ability.trigger !== "passive_aura") continue;
        const params = ability.params ?? {};
        switch (ability.effectKey) {
          case "auraAtkAllOwnUnits":
            flatAtkBonus += Number(params.amount ?? 0);
            break;
          case "conditionalAuraAtkIfUnitCount": {
            const requiredCount = Number(params.requiredCount ?? 0);
            const name = String(params.unitName ?? "");
            const count = unitNames.filter((n) => n === name).length;
            if (count >= requiredCount) flatAtkBonus += Number(params.amount ?? 0);
            break;
          }
          default:
            break; // np. jointAttackThreshold, mineProductionOverride — nie są aurami staty
        }
      }
    }

    // Aury warunkujące HP liczone osobno, bo część (Śpiew Natury) wymaga współwystępowania konkretnego zestawu jednostek.
    for (const unit of units) {
      const def = getUnitDefinition(catalog, unit.definitionId);
      for (const ability of def.abilities) {
        if (ability.trigger !== "passive_aura" || ability.effectKey !== "conditionalAuraHpIfUnitsPresent") continue;
        const requiresNames = (ability.params?.requiresUnitNames as string[] | undefined) ?? [];
        const satisfied = requiresNames.every((n) => unitNames.includes(n));
        if (satisfied) flatHpBonus += Number(ability.params?.amount ?? 0);
      }
    }

    for (const unit of units) {
      const prevAtk = unit.status.auraAtkBonus ?? 0;
      const prevHp = unit.status.auraHpBonus ?? 0;
      unit.currentAtk += flatAtkBonus - prevAtk;
      unit.currentHp += flatHpBonus - prevHp;
      unit.status.auraAtkBonus = flatAtkBonus;
      unit.status.auraHpBonus = flatHpBonus;
    }
  }
}

/** Efektywne ATK do rozpatrzenia ataku: baza + bonus tymczasowy (Inicjatywa) + ewentualne podwojenie na tę turę. */
export function effectiveAttackDamage(state: GameState, attacker: CardInstance): number {
  const owner = getPlayer(state, attacker.ownerMatchPlayerId);
  const base = attacker.currentAtk + (attacker.status.tempAtkBonus ?? 0);
  return owner.doubleAtkUntilEndOfTurn ? base * 2 : base;
}
