import type { UnitComposition } from "./build-kingdom.js";

export const PR_DJED_ID = "pr-djed";

// Pr-Djed (38 kart, v3 — zob. cards.py): 9+5+2+9+4+3+3+3 = 38.
// Zmiana względem pierwotnej transkrypcji PDF: dodany nowy "Medjayet".
export const PR_DJED_COMPOSITION: UnitComposition[] = [
  { unitName: "Centaur", count: 9 },
  { unitName: "Gryf", count: 5 },
  { unitName: "Młody Smok", count: 2 },
  { unitName: "Elf Świetlisty", count: 9 },
  { unitName: "Feniks", count: 4 },
  { unitName: "Pegaz", count: 3 },
  { unitName: "Łucznik", count: 3 },
  { unitName: "Medjayet", count: 3 },
];
