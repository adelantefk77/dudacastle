import type { UnitCardDefinition } from "../../types/card.js";
import { UNIT_TEMPLATES } from "../units-catalog.js";

/** v3 (zob. cards.py UNIT_COST): 6→5. */
export const UNIT_PURCHASE_COST = 5;

export interface UnitComposition {
  unitName: keyof typeof UNIT_TEMPLATES;
  /** Liczba egzemplarzy tej jednostki w talii królestwa (deckCount) */
  count: number;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    // "ł" nie ma dekompozycji NFD do "l" (to odrębny znak, nie litera+diakrytyk) — bez tej jawnej
    // podmiany np. "Włócznik Fianna"/"Doświadczony Łucznik" traciłyby "ł" jako martwy myślnik
    // zamiast "l" (odkryte przy dodawaniu "Doświadczony Łucznik" — zob. slug("Łucznik") === "ucznik").
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Buduje pełne definicje kart jednostek dla jednego królestwa na podstawie
 * szablonów w units-catalog.ts. Każda jednostka dostaje unikalne id
 * `${kingdomId}-${slug(nazwa)}`, bo pule kart królestw są rozłączne.
 */
export function buildKingdomUnits(
  kingdomId: string,
  composition: UnitComposition[],
): UnitCardDefinition[] {
  return composition.map(({ unitName }) => {
    const template = UNIT_TEMPLATES[unitName];
    if (!template) {
      throw new Error(`Nieznany szablon jednostki: ${String(unitName)}`);
    }
    return {
      id: `${kingdomId}-${slug(template.name)}`,
      type: "unit",
      kingdomId,
      name: template.name,
      cost: UNIT_PURCHASE_COST,
      hp: template.hp,
      atk: template.atk,
      canTarget: template.canTarget,
      targetCategory: template.targetCategory,
      infrastructureForbidden: template.infrastructureForbidden,
      abilities: template.abilities,
    };
  });
}

/** deckCount per jednostka — potrzebne przy budowaniu fizycznej talii królestwa (nie samych definicji) */
export function expandDeckCounts(composition: UnitComposition[]): Record<string, number> {
  return Object.fromEntries(composition.map((c) => [slug(String(c.unitName)), c.count]));
}
