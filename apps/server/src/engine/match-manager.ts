import { nanoid } from "nanoid";
import type { CardInstance, GameState, PlayerState } from "@dudacastle/shared";
import { KINGDOMS, EVENT_CARD_DEFINITIONS, expandKingdomDeck, infrastructurePoolSize } from "@dudacastle/shared";

const STARTING_DECK_SIZE = 12;
/** STARTING_GOLD (v3 — zob. cards.py): 5→3. */
const STARTING_COINS = 3;
const STARTING_BANK_COINS = 200;

export interface SeatConfig {
  matchPlayerId: string;
  userId: string;
  kingdomId: string;
  isBot?: boolean;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function newCardInstance(
  definitionId: string,
  ownerMatchPlayerId: string,
  zone: CardInstance["zone"],
  slotIndex: number | null,
  hp: number,
  atk: number,
): CardInstance {
  return {
    instanceId: nanoid(),
    definitionId,
    ownerMatchPlayerId,
    zone,
    slotIndex,
    currentHp: hp,
    currentAtk: atk,
    status: {},
  };
}

/**
 * Przygotowanie do gry: każdy gracz tasuje talię swojego królestwa, losuje 12 kart jako talię
 * startową, resztę odkłada jako talię królestwa (do zakupów). Wieża NIE jest już przyznawana za
 * darmo (v3 — zob. TOWER_DEFINITIONS w infrastructure.ts): gracz zaczyna bez niej i kupuje ją
 * jak każdą inną infrastrukturę (zob. reducer.ts BUY_INFRASTRUCTURE, kind "tower"). Wspólna
 * talia Wydarzeń jest tasowana raz dla całego meczu.
 */
export function createMatch(matchId: string, seats: SeatConfig[]): GameState {
  const cards: Record<string, CardInstance> = {};
  const players: PlayerState[] = [];

  for (const seat of seats) {
    const kingdom = KINGDOMS.find((k) => k.id === seat.kingdomId);
    if (!kingdom) throw new Error(`Nieznane królestwo: ${seat.kingdomId}`);

    const unitDefs = expandKingdomDeck(seat.kingdomId);
    const shuffledDeck = shuffle(unitDefs);
    const startingDeck = shuffledDeck.slice(0, STARTING_DECK_SIZE);
    const kingdomDeck = shuffledDeck.slice(STARTING_DECK_SIZE);

    startingDeck.forEach((def, index) => {
      const card = newCardInstance(def.id, seat.matchPlayerId, "starting_deck", index, def.hp, def.atk);
      cards[card.instanceId] = card;
    });
    kingdomDeck.forEach((def, index) => {
      const card = newCardInstance(def.id, seat.matchPlayerId, "kingdom_deck", index, def.hp, def.atk);
      cards[card.instanceId] = card;
    });

    const startingHp = kingdom.startingHpByPlayerCount[seats.length] ?? 20;

    players.push({
      matchPlayerId: seat.matchPlayerId,
      userId: seat.userId,
      kingdomId: seat.kingdomId,
      seatOrder: players.length,
      kingdomHp: startingHp,
      maxKingdomHp: startingHp,
      coins: STARTING_COINS,
      eliminated: false,
      hasMadeDrawChoiceThisTurn: false,
      unitSlotCapacity: 3,
      turnsToSkip: 0,
      untargetableTurnsRemaining: 0,
      doubleAtkUntilEndOfTurn: false,
      permanentUnitHpAura: 0,
      flatBonusCoinsPerTurn: 0,
      mineProductionMultiplier: 1,
      scheduledTurnEffects: [],
      isBot: seat.isBot ?? false,
    });
  }

  // Wspólna talia Wydarzeń — tasowana raz, dzielona przez wszystkich graczy. Munmaa (v3) nie
  // jest już bezpośrednio kartą w tej talii — to zwykła karta Wydarzenia, której efekt tworzy
  // nowy egzemplarz jednostki Munmaa na ręce (zob. effect-resolver.ts "grantSpecificUnitToHand").
  const eventPool = EVENT_CARD_DEFINITIONS.flatMap((def) => Array.from({ length: def.deckCount }, () => def));
  const shuffledEvents = shuffle(eventPool);
  shuffledEvents.forEach((def, index) => {
    const card = newCardInstance(def.id, "shared", "event_deck", index, 0, 0);
    cards[card.instanceId] = card;
  });

  return {
    matchId,
    status: "in_progress",
    players,
    cards,
    turnOrder: seats.map((s) => s.matchPlayerId),
    currentPlayerIndex: 0,
    turnNumber: 1,
    turnPhase: "draw",
    bankCoins: STARTING_BANK_COINS,
    winnerMatchPlayerId: null,
    infrastructurePool: infrastructurePoolSize(seats.length),
  };
}

/** Store stanu gier "na żywo" w pamięci procesu. Przy skalowaniu poziomym zastąpić Redisem (zob. ARCHITECTURE.md). */
export class MatchStore {
  private matches = new Map<string, GameState>();

  get(matchId: string): GameState | undefined {
    return this.matches.get(matchId);
  }

  set(matchId: string, state: GameState): void {
    this.matches.set(matchId, state);
  }

  create(seats: SeatConfig[]): GameState {
    const matchId = nanoid();
    const state = createMatch(matchId, seats);
    this.matches.set(matchId, state);
    return state;
  }
}
