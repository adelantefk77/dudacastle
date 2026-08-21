import type { UnitComposition } from "./build-kingdom.js";

export const MICTLANCALLI_ID = "mictlancalli";

// Mictlancalli (34 kart, v4 — zob. cards (1) 2.py / PDF "34 kart w talii"): 5+4+3+6+2+4+6+4 = 34.
export const MICTLANCALLI_COMPOSITION: UnitComposition[] = [
  { unitName: "Elf Mroczny", count: 5 },
  { unitName: "Czarodziej", count: 4 },
  { unitName: "Wyvern", count: 3 },
  { unitName: "Emisariusz En-šukud", count: 6 },
  { unitName: "Młody Smok", count: 2 },
  { unitName: "Doświadczony Łucznik", count: 4 },
  { unitName: "Nagual", count: 6 },
  { unitName: "Feniks", count: 4 },
];
