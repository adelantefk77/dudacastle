import type { UnitComposition } from "./build-kingdom.js";

export const URU_GAL_ID = "uru-gal";

// Uru-Gal (39 kart, v4 — zob. cards (1) 2.py / PDF "39 kart w talii"): 8+7+6+3+3+4+5+3 = 39.
// v4: "Doświadczony Królewski Gwardzista" zastąpiony przez nowy "Królewski Gwardzista Ninurty".
export const URU_GAL_COMPOSITION: UnitComposition[] = [
  { unitName: "Ork", count: 8 },
  { unitName: "Harpia", count: 7 },
  { unitName: "Cyklop", count: 6 },
  { unitName: "Czarodziej", count: 3 },
  { unitName: "Młody Smok", count: 3 },
  { unitName: "Amazonka", count: 4 },
  { unitName: "Ludzie", count: 5 },
  { unitName: "Królewski Gwardzista Ninurty", count: 3 },
];
