import type { UnitComposition } from "./build-kingdom.js";

export const SLIABH_DUN_ID = "sliabh-dun";

// Sliabh Dún (39 kart, v4 — zob. cards (1) 2.py / PDF "39 kart w talii"): 8+8+7+7+3+2+2+2 = 39.
// v4: "Ludzie" usunięte z tej talii; dodane "Wyvern" i "Druid".
export const SLIABH_DUN_COMPOSITION: UnitComposition[] = [
  { unitName: "Krasnolud", count: 8 },
  { unitName: "Minotaur", count: 8 },
  { unitName: "Młody Smok", count: 7 },
  { unitName: "Mag", count: 7 },
  { unitName: "Wyvern", count: 3 },
  { unitName: "Gryf", count: 2 },
  { unitName: "Druid", count: 2 },
  { unitName: "Włócznik Fianna", count: 2 },
];
