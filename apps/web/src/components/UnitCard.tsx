import type { CardInstance, UnitCardDefinition } from "@dudacastle/shared";
import { getCardArt } from "../lib/card-art";
import "./unit-card.css";

export interface UnitCardProps {
  definition: UnitCardDefinition;
  /** Stan konkretnego egzemplarza karty w grze (HP/ATK po buffach, czy już zaatakowała...) */
  instance?: Pick<CardInstance, "currentHp" | "currentAtk" | "status">;
  selected?: boolean;
  onClick?: () => void;
}

const TARGET_LABEL: Record<UnitCardDefinition["canTarget"], string> = {
  land: "Lądowe",
  air: "Powietrzne",
  land_and_air: "Lądowe i powietrzne",
};

const TARGET_ICON: Record<UnitCardDefinition["canTarget"], string> = {
  land: "🛡️",
  air: "🪽",
  land_and_air: "🛡️🪽",
};

export function UnitCard({ definition, instance, selected = false, onClick }: UnitCardProps) {
  const hp = instance?.currentHp ?? definition.hp;
  const atk = instance?.currentAtk ?? definition.atk;
  const hasAttacked = instance?.status.hasAttacked ?? false;
  const damaged = hp < definition.hp + (instance?.status.permanentHpBonus ?? 0);
  const art = getCardArt(definition.id);

  return (
    <button
      type="button"
      className={[
        "unit-card",
        art ? "unit-card--has-art" : "",
        selected ? "unit-card--selected" : "",
        hasAttacked ? "unit-card--spent" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={art ? { backgroundImage: `url(${art})` } : undefined}
      onClick={onClick}
      aria-pressed={selected}
      title={definition.abilities.map((a) => `${a.key}: ${a.description}`).join("\n")}
    >
      <header className="unit-card__header">
        {/* Nazwa jest już wypalona w ilustracji dla kart z grafiką — tekstowy nagłówek tylko dla pozostałych. */}
        {!art && <span className="unit-card__name">{definition.name}</span>}
      </header>

      <div className="unit-card__target" aria-label={`Może atakować: ${TARGET_LABEL[definition.canTarget]}`}>
        {TARGET_ICON[definition.canTarget]} <span>{TARGET_LABEL[definition.canTarget]}</span>
      </div>

      {definition.abilities.length > 0 && (
        <ul className="unit-card__abilities">
          {definition.abilities.map((ability) => (
            <li key={ability.key}>{ability.key.replace(/_/g, " ")}</li>
          ))}
        </ul>
      )}

      {definition.infrastructureForbidden && (
        <div className="unit-card__no-infra" title="Nie można umieścić w Wieży, Warowni ani Kopalni">
          🚫 infrastruktura
        </div>
      )}

      <footer className="unit-card__stats">
        <span className={["unit-card__hp", damaged ? "unit-card__hp--damaged" : ""].join(" ")}>
          ❤️ {hp}
        </span>
        <span className="unit-card__atk">⚔️ {atk}</span>
      </footer>

      {hasAttacked && <div className="unit-card__spent-overlay">Zaatakowała</div>}
    </button>
  );
}
