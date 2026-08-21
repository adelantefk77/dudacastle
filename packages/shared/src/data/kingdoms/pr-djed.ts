import type { UnitComposition } from "./build-kingdom.js";

export const PR_DJED_ID = "pr-djed";

// Pr-Djed (39 kart, v4 — zob. cards (1) 2.py / PDF "39 kart w talii"): 9+8+4+5+3+3+3+4 = 39.
export const PR_DJED_COMPOSITION: UnitComposition[] = [
  { unitName: "Centaur", count: 9 },
  { unitName: "Elf Świetlisty", count: 8 },
  { unitName: "Młody Smok", count: 4 },
  { unitName: "Gryf", count: 3 },
  { unitName: "Feniks", count: 3 },
  { unitName: "Pegaz", count: 3 },
  { unitName: "Doświadczony Łucznik", count: 5 },
  { unitName: "Medjayet", count: 4 },
];
