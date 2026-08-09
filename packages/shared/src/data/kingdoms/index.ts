import type { KingdomDefinition, UnitCardDefinition } from "../../types/card.js";
import type { UnitComposition } from "./build-kingdom.js";
import { buildKingdomUnits } from "./build-kingdom.js";
import { UNIT_TEMPLATES } from "../units-catalog.js";
import { SKOGARRIKI_ID, SKOGARRIKI_COMPOSITION } from "./skogarriki.js";
import { URU_GAL_ID, URU_GAL_COMPOSITION } from "./uru-gal.js";
import { MICTLANCALLI_ID, MICTLANCALLI_COMPOSITION } from "./mictlancalli.js";
import { SLIABH_DUN_ID, SLIABH_DUN_COMPOSITION } from "./sliabh-dun.js";
import { PR_DJED_ID, PR_DJED_COMPOSITION } from "./pr-djed.js";

export {
  SKOGARRIKI_ID,
  URU_GAL_ID,
  MICTLANCALLI_ID,
  SLIABH_DUN_ID,
  PR_DJED_ID,
};

/**
 * HP Królestwa wg liczby graczy (v3 — zob. cards.py CASTLE_HP_BY_PLAYERS). Ta sama wartość
 * dla każdego królestwa (gra nie różnicuje balansu startowego HP między królestwami).
 */
const CASTLE_HP_BY_PLAYER_COUNT: Record<number, number> = {
  2: 25,
  3: 20,
  4: 15,
  5: 12,
};

export const KINGDOMS: KingdomDefinition[] = [
  {
    id: SKOGARRIKI_ID,
    name: "Skógarríki",
    towerCardId: `${SKOGARRIKI_ID}-tower`,
    startingHpByPlayerCount: CASTLE_HP_BY_PLAYER_COUNT,
  },
  {
    id: URU_GAL_ID,
    name: "Uru-Gal",
    towerCardId: `${URU_GAL_ID}-tower`,
    startingHpByPlayerCount: CASTLE_HP_BY_PLAYER_COUNT,
  },
  {
    id: MICTLANCALLI_ID,
    name: "Mictlancalli",
    towerCardId: `${MICTLANCALLI_ID}-tower`,
    startingHpByPlayerCount: CASTLE_HP_BY_PLAYER_COUNT,
  },
  {
    id: SLIABH_DUN_ID,
    name: "Sliabh Dún",
    towerCardId: `${SLIABH_DUN_ID}-tower`,
    startingHpByPlayerCount: CASTLE_HP_BY_PLAYER_COUNT,
  },
  {
    id: PR_DJED_ID,
    name: "Pr-Djed",
    towerCardId: `${PR_DJED_ID}-tower`,
    startingHpByPlayerCount: CASTLE_HP_BY_PLAYER_COUNT,
  },
];

export const KINGDOM_UNIT_DEFINITIONS: Record<string, UnitCardDefinition[]> = {
  [SKOGARRIKI_ID]: buildKingdomUnits(SKOGARRIKI_ID, SKOGARRIKI_COMPOSITION),
  [URU_GAL_ID]: buildKingdomUnits(URU_GAL_ID, URU_GAL_COMPOSITION),
  [MICTLANCALLI_ID]: buildKingdomUnits(MICTLANCALLI_ID, MICTLANCALLI_COMPOSITION),
  [SLIABH_DUN_ID]: buildKingdomUnits(SLIABH_DUN_ID, SLIABH_DUN_COMPOSITION),
  [PR_DJED_ID]: buildKingdomUnits(PR_DJED_ID, PR_DJED_COMPOSITION),
};

/**
 * Katapulta (v3) nie należy do żadnej talii królestwa — powstaje wyłącznie z połączenia dwóch
 * Krasnoludów w obszarze gry (zob. effectKey "mergeIntoKatapulta"). Potrzebuje mimo to wpisu w
 * katalogu kart (do lookupu definitionId/renderowania), stąd osobny, niekupowalny wpis tutaj.
 */
const KATAPULTA_TEMPLATE = UNIT_TEMPLATES.Katapulta;
export const KATAPULTA_DEFINITION: UnitCardDefinition = {
  id: "unit-katapulta",
  type: "unit",
  kingdomId: "merge", // sentinel: nigdy nie kupowana/losowana z żadnej talii
  name: KATAPULTA_TEMPLATE.name,
  cost: 0,
  hp: KATAPULTA_TEMPLATE.hp,
  atk: KATAPULTA_TEMPLATE.atk,
  canTarget: KATAPULTA_TEMPLATE.canTarget,
  targetCategory: KATAPULTA_TEMPLATE.targetCategory,
  infrastructureForbidden: KATAPULTA_TEMPLATE.infrastructureForbidden,
  abilities: KATAPULTA_TEMPLATE.abilities,
};

export const ALL_UNIT_DEFINITIONS: UnitCardDefinition[] = [
  ...Object.values(KINGDOM_UNIT_DEFINITIONS).flat(),
  KATAPULTA_DEFINITION,
];

export {
  SKOGARRIKI_COMPOSITION,
  URU_GAL_COMPOSITION,
  MICTLANCALLI_COMPOSITION,
  SLIABH_DUN_COMPOSITION,
  PR_DJED_COMPOSITION,
};

export const KINGDOM_COMPOSITIONS: Record<string, UnitComposition[]> = {
  [SKOGARRIKI_ID]: SKOGARRIKI_COMPOSITION,
  [URU_GAL_ID]: URU_GAL_COMPOSITION,
  [MICTLANCALLI_ID]: MICTLANCALLI_COMPOSITION,
  [SLIABH_DUN_ID]: SLIABH_DUN_COMPOSITION,
  [PR_DJED_ID]: PR_DJED_COMPOSITION,
};

/**
 * `KINGDOM_UNIT_DEFINITIONS` zawiera po JEDNEJ definicji na unikalną jednostkę (potrzebne dla
 * katalogu kart / lookup po id). Fizyczna talia królestwa ma jednak powtórzenia wg `count`
 * z instrukcji (np. Uru-Gal: 6x Ork, 7x Harpia... = 32 karty) — tę listę budujemy tutaj,
 * do użytku w `match-manager.ts` przy tworzeniu faktycznych egzemplarzy kart w grze.
 */
export function expandKingdomDeck(kingdomId: string): UnitCardDefinition[] {
  const definitions = KINGDOM_UNIT_DEFINITIONS[kingdomId];
  const composition = KINGDOM_COMPOSITIONS[kingdomId];
  if (!definitions || !composition) {
    throw new Error(`Nieznane królestwo: ${kingdomId}`);
  }
  const byName = new Map(definitions.map((d) => [d.name, d]));
  return composition.flatMap(({ unitName, count }) => {
    const def = byName.get(unitName);
    if (!def) throw new Error(`Brak definicji jednostki "${unitName}" w królestwie "${kingdomId}".`);
    return Array.from({ length: count }, () => def);
  });
}
