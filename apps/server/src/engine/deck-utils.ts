import type { CardInstance, GameState } from "@dudacastle/shared";
import { cardsInZone } from "./selectors.js";

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Dobiera `count` kart z talii startowej gracza do ręki. Jeżeli talia jest
 * pusta, tasuje stos kart odrzuconych w nową talię startową (zasada z
 * sekcji 4.I instrukcji) zanim kontynuuje dobieranie.
 */
export function drawFromStartingDeck(state: GameState, matchPlayerId: string, count: number): CardInstance[] {
  const drawn: CardInstance[] = [];
  for (let i = 0; i < count; i++) {
    let deck = cardsInZone(state, matchPlayerId, "starting_deck").sort(
      (a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0),
    );
    if (deck.length === 0) {
      const discard = cardsInZone(state, matchPlayerId, "discard");
      if (discard.length === 0) break; // brak kart do dobrania — nic więcej się nie da zrobić
      const reshuffled = shuffle(discard);
      reshuffled.forEach((card, index) => {
        card.zone = "starting_deck";
        card.slotIndex = index;
      });
      deck = reshuffled;
    }
    const top = deck[0];
    top.zone = "hand";
    top.slotIndex = null;
    drawn.push(top);
  }
  return drawn;
}
