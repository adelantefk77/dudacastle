import type { UnitComposition } from "./build-kingdom.js";

export const SKOGARRIKI_ID = "skogarriki";

// Skógarríki (36 kart, v4 — zob. cards (1) 2.py / PDF "36 kart w talii"): 6+5+4+3+5+3+4+6 = 36.
export const SKOGARRIKI_COMPOSITION: UnitComposition[] = [
  { unitName: "Faun", count: 6 },
  { unitName: "Elf Leśny", count: 5 },
  { unitName: "Gryf", count: 4 },
  { unitName: "Druid", count: 3 },
  { unitName: "Najemnik", count: 5 },
  { unitName: "Abzugud", count: 3 },
  { unitName: "Ent", count: 4 },
  { unitName: "Leśny Tropiciel", count: 6 },
];
