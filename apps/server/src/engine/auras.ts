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
 * Przelicza bonusy HP/ATK pochodzące z aur pasywnych (Zbrojne Pospolite
 * Ruszenie, Natchnienie, Wzmocnienie, Płatnerz...) dla wszystkich jednostek w
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

    // flatAtkBonus: bonus JEDNAKOWY dla wszystkich jednostek gracza (Zbrojne Pospolite Ruszenie —
    // deduplikowane progowo — oraz Natchnienie — sumowane PER INSTANCJA, zob. niżej).
    let flatAtkBonus = 0;
    const flatHpBonus = player.permanentUnitHpAura; // Płatnerz — trwały, dotyczy też przyszłych jednostek

    // Każda WARUNKOWA aura progowa (np. "2x Ludzie = +1 ATK całej armii") opisuje próg spełniony
    // przez ARMIĘ, nie bonus przyznawany osobno przez każdą kopię jednostki, która go niesie — bez
    // tej deduplikacji po `ability.key` 3x Ludzie dawałoby błędnie +3 ATK zamiast +1 (a przy
    // usuwaniu/dodawaniu jednostek między turami ta nadwyżka rozjeżdżała currentAtk, bo poniższa
    // pętla aplikuje tylko RÓŻNICĘ względem poprzednio zapisanego bonusu).
    const countedThresholdAtkAbilities = new Set<string>();
    for (const unit of units) {
      const def = getUnitDefinition(catalog, unit.definitionId);
      for (const ability of def.abilities) {
        if (ability.trigger !== "passive_aura") continue;
        const params = ability.params ?? {};
        switch (ability.effectKey) {
          case "auraAtkAllOwnUnits":
            // Natchnienie (Abzugud/Czarodziej): ŻYWA aura, dopóki karta jest w obszarze gry,
            // WLICZAJĄC samą siebie. Każda kopia kontrybuuje NIEZALEŻNIE (2 Czarodziejów = +2 ATK),
            // więc celowo BEZ deduplikacji po ability.key (w przeciwieństwie do aur progowych).
            flatAtkBonus += Number(params.amount ?? 0);
            break;
          case "conditionalAuraAtkIfUnitCount": {
            if (countedThresholdAtkAbilities.has(ability.key)) break;
            const requiredCount = Number(params.requiredCount ?? 0);
            const name = String(params.unitName ?? "");
            const count = unitNames.filter((n) => n === name).length;
            if (count >= requiredCount) {
              flatAtkBonus += Number(params.amount ?? 0);
              countedThresholdAtkAbilities.add(ability.key);
            }
            break;
          }
          default:
            break; // np. jointAttackThreshold, mineProductionOverride, wzmocnienieAura — obsłużone osobno/gdzie indziej
        }
      }
    }

    // Wzmocnienie (Faun/Druid/Feniks/Mag/Elf Świetlisty...): ŻYWA, CIĄGŁA aura HP, ale — inaczej niż
    // Natchnienie — KAŻDY nosiciel wyklucza WYŁĄCZNIE SIEBIE z grona odbiorców własnego bonusu, więc
    // bonus jest RÓŻNY dla różnych jednostek (nie da się go zwinąć do jednego flatHpBonus). Zbieramy
    // najpierw listę wszystkich źródeł, potem dla każdej jednostki sumujemy bonus wszystkich INNYCH źródeł.
    const wzmocnienieSources: Array<{ instanceId: string; amount: number }> = [];
    for (const unit of units) {
      const def = getUnitDefinition(catalog, unit.definitionId);
      for (const ability of def.abilities) {
        if (ability.trigger === "passive_aura" && ability.effectKey === "wzmocnienieAura") {
          wzmocnienieSources.push({ instanceId: unit.instanceId, amount: Number(ability.params?.amount ?? 0) });
        }
      }
    }

    for (const unit of units) {
      const prevAtk = unit.status.auraAtkBonus ?? 0;
      const prevHp = unit.status.auraHpBonus ?? 0;
      let unitHpBonus = flatHpBonus;
      for (const source of wzmocnienieSources) {
        if (source.instanceId !== unit.instanceId) unitHpBonus += source.amount;
      }
      unit.currentAtk += flatAtkBonus - prevAtk;
      // max(1, ...) — usunięcie/zmniejszenie aury nie może "zabić" jednostki samym przeliczeniem
      // (zob. simulator_v3 (1) 2.py sync_all_hp: `max(1, hp + diff) if hp > 0 else hp`).
      unit.currentHp = Math.max(1, unit.currentHp + (unitHpBonus - prevHp));
      unit.status.auraAtkBonus = flatAtkBonus;
      unit.status.auraHpBonus = unitHpBonus;
    }
  }
}

/** Efektywne ATK do rozpatrzenia ataku: baza + bonus tymczasowy (Inicjatywa) + ewentualne podwojenie na tę turę. */
export function effectiveAttackDamage(state: GameState, attacker: CardInstance): number {
  const owner = getPlayer(state, attacker.ownerMatchPlayerId);
  const base = attacker.currentAtk + (attacker.status.tempAtkBonus ?? 0);
  return owner.doubleAtkUntilEndOfTurn ? base * 2 : base;
}
