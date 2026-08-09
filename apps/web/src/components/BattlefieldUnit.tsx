import type { CardInstance } from "@dudacastle/shared";
import { getCardDefinition } from "../lib/catalog";
import { UnitCard } from "./UnitCard";
import "./battlefield-unit.css";

export interface BattlefieldUnitProps {
  card: CardInstance;
  selected?: boolean;
  /** Zdolność aktywowana ręcznie dostępna na tej karcie (np. Harmonia, Galop) — pokazuje osobny przycisk. */
  hasActivatedAbility?: boolean;
  onSelect?: () => void;
  onUseAbility?: () => void;
}

export function BattlefieldUnit({ card, selected, hasActivatedAbility, onSelect, onUseAbility }: BattlefieldUnitProps) {
  const definition = getCardDefinition(card.definitionId);
  if (!definition || definition.type !== "unit") return null;

  return (
    <div className="battlefield-unit">
      <UnitCard definition={definition} instance={card} selected={selected} onClick={onSelect} />
      {hasActivatedAbility && (
        <button type="button" className="battlefield-unit__ability-btn" onClick={onUseAbility}>
          Zdolność
        </button>
      )}
    </div>
  );
}
