import type { UnitComposition } from "./build-kingdom.js";

export const SKOGARRIKI_ID = "skogarriki";

// Skógarríki (35 kart, v3 — zob. cards.py): 6+7+3+3+5+3+4+4 = 35.
// Zmiana względem pierwotnej transkrypcji PDF: "Ludzie" usunięte z tego królestwa,
// dodany nowy "Leśny Tropiciel".
export const SKOGARRIKI_COMPOSITION: UnitComposition[] = [
  { unitName: "Faun", count: 6 },
  { unitName: "Elf Leśny", count: 7 },
  { unitName: "Gryf", count: 3 },
  { unitName: "Druid", count: 3 },
  { unitName: "Najemnik", count: 5 },
  { unitName: "Abzugud", count: 3 },
  { unitName: "Ent", count: 4 },
  { unitName: "Leśny Tropiciel", count: 4 },
];
