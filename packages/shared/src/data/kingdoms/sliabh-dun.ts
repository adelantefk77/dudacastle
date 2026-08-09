import type { UnitComposition } from "./build-kingdom.js";

export const SLIABH_DUN_ID = "sliabh-dun";

// Sliabh Dún (37 kart, v3 — zob. cards.py): 7+9+4+5+4+4+4 = 37.
export const SLIABH_DUN_COMPOSITION: UnitComposition[] = [
  { unitName: "Minotaur", count: 7 },
  { unitName: "Krasnolud", count: 9 },
  { unitName: "Młody Smok", count: 4 },
  { unitName: "Gryf", count: 5 },
  { unitName: "Ludzie", count: 4 },
  { unitName: "Mag", count: 4 },
  { unitName: "Włócznik Fianna", count: 4 },
];
