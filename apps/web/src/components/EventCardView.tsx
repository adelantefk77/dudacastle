import type { EventCardDefinition } from "@dudacastle/shared";
import { getCardArt } from "../lib/card-art";
import "./event-card.css";

export interface EventCardViewProps {
  definition: EventCardDefinition;
  selected?: boolean;
  onClick?: () => void;
}

const POLARITY_LABEL: Record<EventCardDefinition["polarity"], string> = {
  positive: "Pozytywna",
  negative: "Negatywna",
  mixed: "Mieszana",
};

export function EventCardView({ definition, selected = false, onClick }: EventCardViewProps) {
  const art = getCardArt(definition.id);
  return (
    <button
      type="button"
      className={["event-card", art ? "event-card--has-art" : "", selected ? "event-card--selected" : ""].filter(Boolean).join(" ")}
      style={art ? { backgroundImage: `url(${art})` } : undefined}
      onClick={onClick}
      aria-pressed={selected}
      title={definition.description}
    >
      <header className="event-card__header">
        {/* Nazwa jest już wypalona w ilustracji dla kart z grafiką — tekstowy nagłówek tylko dla pozostałych. */}
        {!art && <span className="event-card__name">{definition.name}</span>}
      </header>
      <p className="event-card__description">{definition.description}</p>
      <footer className="event-card__footer">
        <span className={`event-card__polarity event-card__polarity--${definition.polarity}`}>
          {POLARITY_LABEL[definition.polarity]}
        </span>
      </footer>
    </button>
  );
}
