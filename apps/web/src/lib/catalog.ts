import type { CardDefinition } from "@dudacastle/shared";
import {
  ALL_INFRASTRUCTURE_DEFINITIONS,
  ALL_UNIT_DEFINITIONS,
  EVENT_CARD_DEFINITIONS,
  EVENT_DECK_UNIT_DEFINITIONS,
} from "@dudacastle/shared";

/**
 * `GameState` przesyłany przez serwer niesie tylko `definitionId` + bieżące staty
 * (zob. packages/shared/src/types/game-state.ts) — nazwę, koszt i opisy zdolności trzeba
 * doszukać lokalnie. Katalog kart jest danymi statycznymi (packages/shared), więc frontend
 * może zbudować go samodzielnie zamiast pytać serwer o każdą definicję z osobna.
 */
const CATALOG = new Map<string, CardDefinition>();
for (const def of [
  ...ALL_UNIT_DEFINITIONS,
  ...EVENT_DECK_UNIT_DEFINITIONS,
  ...EVENT_CARD_DEFINITIONS,
  ...ALL_INFRASTRUCTURE_DEFINITIONS,
]) {
  CATALOG.set(def.id, def);
}

export function getCardDefinition(definitionId: string): CardDefinition | undefined {
  return CATALOG.get(definitionId);
}
