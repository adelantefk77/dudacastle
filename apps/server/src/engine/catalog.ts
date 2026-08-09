import type { CardDefinition, InfrastructureCardDefinitionWithMechanics, UnitCardDefinition } from "@dudacastle/shared";
import {
  ALL_UNIT_DEFINITIONS,
  EVENT_CARD_DEFINITIONS,
  EVENT_DECK_UNIT_DEFINITIONS,
  ALL_INFRASTRUCTURE_DEFINITIONS,
} from "@dudacastle/shared";

export type CardCatalog = Map<string, CardDefinition>;

/** Buduje pełny katalog definicji kart (jednostki + wydarzenia + infrastruktura) indeksowany po id. */
export function buildCardCatalog(): CardCatalog {
  const catalog: CardCatalog = new Map();
  const all: CardDefinition[] = [
    ...ALL_UNIT_DEFINITIONS,
    ...EVENT_DECK_UNIT_DEFINITIONS,
    ...EVENT_CARD_DEFINITIONS,
    ...ALL_INFRASTRUCTURE_DEFINITIONS,
  ];
  for (const def of all) catalog.set(def.id, def);
  return catalog;
}

export function getUnitDefinition(catalog: CardCatalog, definitionId: string): UnitCardDefinition {
  const def = catalog.get(definitionId);
  if (!def || def.type !== "unit") {
    throw new Error(`Oczekiwano definicji jednostki dla id "${definitionId}".`);
  }
  return def;
}

/**
 * `CardDefinition` (unia publiczna) nie niesie pola `mechanics` — to szczegół implementacyjny
 * kart infrastruktury (zob. packages/shared/src/data/infrastructure.ts). Rzutowanie jest
 * bezpieczne: każdy obiekt typu "infrastructure" w katalogu faktycznie pochodzi z
 * `ALL_INFRASTRUCTURE_DEFINITIONS`, gdzie `mechanics` jest zawsze obecne.
 */
export function getInfrastructureDefinition(
  catalog: CardCatalog,
  definitionId: string,
): InfrastructureCardDefinitionWithMechanics {
  const def = catalog.get(definitionId);
  if (!def || def.type !== "infrastructure") {
    throw new Error(`Oczekiwano definicji infrastruktury dla id "${definitionId}".`);
  }
  return def as InfrastructureCardDefinitionWithMechanics;
}
