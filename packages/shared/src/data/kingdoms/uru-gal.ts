import type { UnitComposition } from "./build-kingdom.js";

export const URU_GAL_ID = "uru-gal";

// Uru-Gal (39 kart, v3 — zob. cards.py): 9+6+5+4+2+5+5+3 = 39.
// Zmiana względem pierwotnej transkrypcji PDF: dodane "Młody Smok" i nowa "Amazonka".
export const URU_GAL_COMPOSITION: UnitComposition[] = [
  { unitName: "Ork", count: 9 },
  { unitName: "Harpia", count: 6 },
  { unitName: "Cyklop", count: 5 },
  { unitName: "Czarodziej", count: 4 },
  { unitName: "Młody Smok", count: 2 },
  { unitName: "Amazonka", count: 5 },
  { unitName: "Ludzie", count: 5 },
  { unitName: "Doświadczony Królewski Gwardzista", count: 3 },
];
