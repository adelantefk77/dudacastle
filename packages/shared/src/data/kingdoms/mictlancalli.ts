import type { UnitComposition } from "./build-kingdom.js";

export const MICTLANCALLI_ID = "mictlancalli";

// Mictlancalli (36 kart, v3 — zob. cards.py): 9+3+2+3+4+7+5+3 = 36.
// "Wyvern" z cards.py odpowiada jednostce "Legendarny Wyvern" z listy postaci.
export const MICTLANCALLI_COMPOSITION: UnitComposition[] = [
  { unitName: "Elf Mroczny", count: 9 },
  { unitName: "Feniks", count: 3 },
  { unitName: "Legendarny Wyvern", count: 2 },
  { unitName: "Młody Smok", count: 3 },
  { unitName: "Czarodziej", count: 4 },
  { unitName: "Nagual", count: 7 },
  { unitName: "Emisariusz En-šukud", count: 5 },
  { unitName: "Łucznik", count: 3 },
];
