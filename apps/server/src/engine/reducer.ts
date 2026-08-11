import { nanoid } from "nanoid";
import type { CardInstance, GameAction, GameEvent, GameState } from "@dudacastle/shared";
import { BARRACKS_DEFINITION, BATTLEFIELD_ZONES, MINE_DEFINITION, STRONGHOLD_DEFINITION } from "@dudacastle/shared";
import type { CardCatalog } from "./catalog.js";
import { getUnitDefinition } from "./catalog.js";
import { GameRuleError } from "./errors.js";
import { drawFromStartingDeck } from "./deck-utils.js";
import { resolveEffect } from "./effect-resolver.js";
import { resolveAttackAction, assertUnitReadyToAct, consumeStrongholdAction } from "./combat.js";
import { recomputeAuras } from "./auras.js";
import { processTurnEnd, processTurnStart } from "./turn-processing.js";
import { cardsInZone, currentPlayer, getPlayer } from "./selectors.js";
import { infrastructureMechanicsFor } from "./zones.js";
import {
  assertDrawChoiceAvailable,
  assertFreeUnitSlot,
  assertGameInProgress,
  assertIsCurrentPlayer,
  assertMainPhaseAction,
  assertSufficientCoins,
} from "./validators.js";

/** UNIT_COST (v3 — zob. cards.py): 6→5. */
const UNIT_PURCHASE_COST = 5;
/** INFRA_COST (v3 — zob. cards.py): jednakowy koszt Wieży/Kopalni/Koszar/Warowni, 6→7. */
const INFRASTRUCTURE_PURCHASE_COST = 7;

/** Heurystyka "jak dobra jest ta karta" — zob. cards.py priority_score (uproszczona: bez bonusów per-zdolność). */
function unitValueHeuristic(def: { atk: number; hp: number }): number {
  return def.atk * 1.5 + def.hp * 0.5;
}

/** Czy gracz ma w obszarze gry jednostkę z daną zdolnością pasywną (np. Leśny Tropiciel — path_expert). */
function hasBattlefieldAbility(state: GameState, catalog: CardCatalog, matchPlayerId: string, effectKey: string): boolean {
  return Object.values(state.cards).some(
    (c) =>
      c.ownerMatchPlayerId === matchPlayerId &&
      BATTLEFIELD_ZONES.includes(c.zone) &&
      catalog.get(c.definitionId)?.type === "unit" &&
      getUnitDefinition(catalog, c.definitionId).abilities.some((a) => a.effectKey === effectKey),
  );
}

export interface ApplyActionResult {
  state: GameState;
  events: GameEvent[];
}

function infrastructureDefinitionIdFor(kind: "mine" | "barracks" | "stronghold") {
  if (kind === "mine") return MINE_DEFINITION.id;
  if (kind === "barracks") return BARRACKS_DEFINITION.id;
  return STRONGHOLD_DEFINITION.id;
}

/**
 * Punkt wejścia silnika: `applyAction` jest jedyną drogą mutacji stanu gry.
 * Nie zależy od transportu (WebSocket) ani trwałości (Postgres) — to czysta
 * funkcja domenowa, testowalna bez sieci i bez bazy danych.
 *
 * Strategia: klonujemy stan (structuredClone — GameState jest czystym JSON-em),
 * mutujemy klon, zwracamy nowy stan + listę zdarzeń do zapisania w
 * match_events i rozgłoszenia do klientów.
 */
export function applyAction(prevState: GameState, action: GameAction, catalog: CardCatalog): ApplyActionResult {
  const state = structuredClone(prevState);
  const events: GameEvent[] = [];
  const emit = (type: string, payload: Record<string, unknown> = {}) => {
    events.push({
      matchId: state.matchId,
      sequenceNo: events.length,
      actorMatchPlayerId: "matchPlayerId" in action ? action.matchPlayerId : null,
      type,
      payload,
      createdAt: new Date().toISOString(),
    });
  };

  assertGameInProgress(state);

  switch (action.type) {
    case "DRAW_CARDS": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      assertDrawChoiceAvailable(state, action.matchPlayerId);
      const drawn = drawFromStartingDeck(state, action.matchPlayerId, 2);
      const player = getPlayer(state, action.matchPlayerId);
      player.hasMadeDrawChoiceThisTurn = true;
      state.turnPhase = "main";
      emit("CARDS_DRAWN", { count: drawn.length });
      break;
    }

    case "TAKE_COINS": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      assertDrawChoiceAvailable(state, action.matchPlayerId);
      if (state.bankCoins < 2) {
        throw new GameRuleError("Bank nie posiada wystarczającej liczby monet.", "BANK_EMPTY");
      }
      const player = getPlayer(state, action.matchPlayerId);
      player.coins += 2;
      state.bankCoins -= 2;
      player.hasMadeDrawChoiceThisTurn = true;
      state.turnPhase = "main";
      emit("COINS_TAKEN", { amount: 2 });
      break;
    }

    case "PLAY_UNIT": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      assertMainPhaseAction(state);

      const card = state.cards[action.cardInstanceId];
      if (!card || card.ownerMatchPlayerId !== action.matchPlayerId || card.zone !== "hand") {
        throw new GameRuleError("Karta nie znajduje się na ręce tego gracza.", "CARD_NOT_IN_HAND");
      }
      const definition = getUnitDefinition(catalog, card.definitionId);

      if (action.stackOnInstanceId) {
        // Zakorzenienie (Ent): dodatkowa jednostka dzieli miejsce z gospodarzem, nie zajmuje własnego slotu.
        const host = state.cards[action.stackOnInstanceId];
        if (!host || host.ownerMatchPlayerId !== action.matchPlayerId || host.zone !== "play_area") {
          throw new GameRuleError("Nieprawidłowa jednostka-gospodarz.", "INVALID_STACK_HOST");
        }
        const hostDef = getUnitDefinition(catalog, host.definitionId);
        const stackAbility = hostDef.abilities.find((a) => a.effectKey === "extraUnitSlotOnHost");
        if (!stackAbility) {
          throw new GameRuleError("Ta jednostka nie pozwala na umieszczenie dodatkowej karty.", "STACKING_NOT_ALLOWED");
        }
        const maxExtra = Number(stackAbility.params?.extraSlots ?? 1);
        const stackedCount = Object.values(state.cards).filter((c) => c.status.stackedOnInstanceId === host.instanceId).length;
        if (stackedCount >= maxExtra) {
          throw new GameRuleError("Limit dodatkowych jednostek na tej karcie został osiągnięty.", "STACK_LIMIT_REACHED");
        }
        card.zone = "play_area";
        card.slotIndex = host.slotIndex;
        card.status.stackedOnInstanceId = host.instanceId;
      } else {
        assertFreeUnitSlot(state, action.matchPlayerId, action.slotIndex);
        card.zone = "play_area";
        card.slotIndex = action.slotIndex;
      }

      card.status.enteredZoneOnTurn = state.turnNumber;
      card.status.hasAttacked = false;
      // nowe-polecenia.pdf #5/#10: moveToDiscard czyści status przy WYJŚCIU z planszy, ale
      // destroyUnit zaraz potem doczepia destroyedOnTurn (potrzebne przez on_death w tym samym
      // momencie) — bez tej linii ta jedna wartość przetrwałaby aż do kolejnego zagrania karty.
      card.status.destroyedOnTurn = undefined;
      card.currentHp = definition.hp + (card.status.permanentHpBonus ?? 0);
      card.currentAtk = definition.atk + (card.status.permanentAtkBonus ?? 0);

      for (const ability of definition.abilities) {
        if (ability.trigger === "on_play") {
          resolveEffect(ability.effectKey, {
            state,
            catalog,
            sourceCard: card,
            ownerMatchPlayerId: action.matchPlayerId,
            params: ability.params,
            emit,
          });
        }
      }
      emit("UNIT_PLAYED", { cardInstanceId: card.instanceId, slotIndex: card.slotIndex });
      break;
    }

    case "BUY_UNIT": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      assertMainPhaseAction(state);
      assertSufficientCoins(state, action.matchPlayerId, UNIT_PURCHASE_COST);

      const kingdomDeck = cardsInZone(state, action.matchPlayerId, "kingdom_deck").sort(
        (a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0),
      );
      if (kingdomDeck.length === 0) {
        throw new GameRuleError("Talia królestwa jest pusta — brak jednostek do kupienia.", "KINGDOM_DECK_EMPTY");
      }
      const player = getPlayer(state, action.matchPlayerId);
      player.coins -= UNIT_PURCHASE_COST;

      // Gracz nigdy nie wie, jaka jednostka zostanie zakupiona — dobieramy wierzchnią, zakrytą kartę.
      // Leśny Tropiciel (path_expert, v3): podejrzyj 2 wierzchnie karty, zatrzymaj lepszą, drugą
      // odłóż pod spód talii królestwa zamiast zostawiać ją jako kolejną-do-dobrania.
      let bought: CardInstance;
      if (kingdomDeck.length >= 2 && hasBattlefieldAbility(state, catalog, action.matchPlayerId, "pathExpertPeekAndKeepBest")) {
        const [c1, c2] = kingdomDeck;
        const v1 = unitValueHeuristic(getUnitDefinition(catalog, c1.definitionId));
        const v2 = unitValueHeuristic(getUnitDefinition(catalog, c2.definitionId));
        const [chosen, buried] = v1 >= v2 ? [c1, c2] : [c2, c1];
        bought = chosen;
        const maxIndex = kingdomDeck.reduce((max, c) => Math.max(max, c.slotIndex ?? 0), -1);
        buried.slotIndex = maxIndex + 1;
      } else {
        bought = kingdomDeck[0];
      }
      bought.zone = "discard"; // "Zakupione jednostki trafiają na stos kart odrzuconych" (sekcja 7)
      bought.slotIndex = null;
      emit("UNIT_BOUGHT", { cardInstanceId: bought.instanceId });
      break;
    }

    case "BUY_INFRASTRUCTURE": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      assertMainPhaseAction(state);

      // Wieża (v3): nie jest już darmowym prezentem startowym — kupowana jak każda inna
      // infrastruktura, bez limitu wspólnej puli (co najwyżej 1 na gracza, wymuszane przez ownership).
      if (action.kind === "tower") {
        const alreadyOwnsTower = cardsInZone(state, action.matchPlayerId, "tower").some(
          (c) => catalog.get(c.definitionId)?.type === "infrastructure",
        );
        if (alreadyOwnsTower) {
          throw new GameRuleError("Posiadasz już Wieżę.", "TOWER_ALREADY_OWNED");
        }
        assertSufficientCoins(state, action.matchPlayerId, INFRASTRUCTURE_PURCHASE_COST);
        const towerPlayer = getPlayer(state, action.matchPlayerId);
        towerPlayer.coins -= INFRASTRUCTURE_PURCHASE_COST;

        const towerCard: CardInstance = {
          instanceId: nanoid(),
          definitionId: `${towerPlayer.kingdomId}-tower`,
          ownerMatchPlayerId: action.matchPlayerId,
          zone: "tower",
          slotIndex: 0,
          currentHp: 0,
          currentAtk: 0,
          status: {},
        };
        state.cards[towerCard.instanceId] = towerCard;
        emit("INFRASTRUCTURE_BOUGHT", { kind: "tower", cardInstanceId: towerCard.instanceId });
        break;
      }

      const poolKey = action.kind === "mine" ? "mines" : action.kind === "barracks" ? "barracks" : "strongholds";
      if (state.infrastructurePool[poolKey] <= 0) {
        throw new GameRuleError(`Brak dostępnych kart "${action.kind}" we wspólnej puli.`, "INFRASTRUCTURE_POOL_EMPTY");
      }
      assertSufficientCoins(state, action.matchPlayerId, INFRASTRUCTURE_PURCHASE_COST);

      const player = getPlayer(state, action.matchPlayerId);
      player.coins -= INFRASTRUCTURE_PURCHASE_COST;
      state.infrastructurePool[poolKey] -= 1;

      // slotIndex unikalny wśród WŁASNYCH kart tego rodzaju infrastruktury — gracz teoretycznie
      // może kupić więcej niż jedną kopię (pula współdzielona graczy-1 sztuk), a sztywne 0
      // powodowałoby kolizję slotIndex z pierwszą kopią (zob. occupantsOf w turn-processing.ts).
      const existingOfKind = cardsInZone(state, action.matchPlayerId, action.kind).filter(
        (c) => catalog.get(c.definitionId)?.type === "infrastructure",
      ).length;
      const card: CardInstance = {
        instanceId: nanoid(),
        definitionId: infrastructureDefinitionIdFor(action.kind),
        ownerMatchPlayerId: action.matchPlayerId,
        zone: action.kind,
        slotIndex: existingOfKind,
        currentHp: 0,
        currentAtk: 0,
        status: {},
      };
      state.cards[card.instanceId] = card;
      emit("INFRASTRUCTURE_BOUGHT", { kind: action.kind, cardInstanceId: card.instanceId });
      break;
    }

    case "PLACE_IN_INFRASTRUCTURE": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      assertMainPhaseAction(state);

      const card = state.cards[action.cardInstanceId];
      if (!card || card.ownerMatchPlayerId !== action.matchPlayerId || card.zone !== "hand") {
        throw new GameRuleError("Karta nie znajduje się na ręce tego gracza.", "CARD_NOT_IN_HAND");
      }
      const definition = getUnitDefinition(catalog, card.definitionId);
      if (definition.infrastructureForbidden && action.infrastructure !== "barracks") {
        throw new GameRuleError(
          "Ta jednostka nie może zostać umieszczona w Wieży, Warowni ani Kopalni.",
          "INFRASTRUCTURE_FORBIDDEN",
        );
      }

      const ownsInfra = cardsInZone(state, action.matchPlayerId, action.infrastructure).some(
        (c) => catalog.get(c.definitionId)?.type === "infrastructure",
      );
      if (!ownsInfra) {
        throw new GameRuleError(`Gracz nie posiada karty "${action.infrastructure}".`, "INFRASTRUCTURE_NOT_OWNED");
      }
      const mechanics = infrastructureMechanicsFor(action.infrastructure);
      const occupantCount = Object.values(state.cards).filter(
        (c) => c.ownerMatchPlayerId === action.matchPlayerId && c.zone === action.infrastructure && catalog.get(c.definitionId)?.type === "unit",
      ).length;
      const maxUnits = mechanics.maxUnits ?? 1;
      if (occupantCount >= maxUnits) {
        throw new GameRuleError(`Limit jednostek w "${action.infrastructure}" został osiągnięty.`, "INFRASTRUCTURE_FULL");
      }

      card.zone = action.infrastructure;
      card.slotIndex = occupantCount;
      card.status.enteredZoneOnTurn = state.turnNumber;
      card.status.hasAttacked = false;
      card.status.destroyedOnTurn = undefined; // nowe-polecenia.pdf #5/#10 — zob. identyczny komentarz w PLAY_UNIT
      // Bonus HP z Wieży musi wejść do permanentHpBonus (nie tylko do bieżącego currentHp) —
      // inaczej znika po pierwszym resecie HP na koniec tury ("obrażenia nie przechodzą między
      // turami" w turn-processing.ts liczy currentHp na nowo z def.hp + permanentHpBonus, nie
      // wiedząc nic o Wieży).
      const towerHpBonus = action.infrastructure === "tower" ? mechanics.unitHpBonus ?? 0 : 0;
      card.status.permanentHpBonus = (card.status.permanentHpBonus ?? 0) + towerHpBonus;
      card.currentHp = definition.hp + card.status.permanentHpBonus;
      card.currentAtk = definition.atk + (card.status.permanentAtkBonus ?? 0);

      if (action.infrastructure === "barracks" || action.infrastructure === "stronghold") {
        card.status.readyToAct = false;
        card.status.actionsTakenThisTurn = 0;
      } else {
        card.status.readyToAct = true;
      }

      for (const ability of definition.abilities) {
        if (ability.trigger === "on_play") {
          resolveEffect(ability.effectKey, {
            state,
            catalog,
            sourceCard: card,
            ownerMatchPlayerId: action.matchPlayerId,
            params: ability.params,
            emit,
          });
        }
      }
      emit("UNIT_PLACED_IN_INFRASTRUCTURE", { cardInstanceId: card.instanceId, infrastructure: action.infrastructure });
      break;
    }

    case "BUY_EVENT_CARD": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      assertMainPhaseAction(state);

      const eventDeck = cardsInZone(state, "shared", "event_deck").sort(
        (a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0),
      );
      if (eventDeck.length === 0) {
        throw new GameRuleError("Talia Wydarzeń jest pusta.", "EVENT_DECK_EMPTY");
      }

      // Leśny Tropiciel (path_expert, v3): podejrzyj 2 wierzchnie karty Wydarzeń, zatrzymaj tę o
      // pozytywnej polaryzacji (przy remisie/braku — pierwszą), drugą odłóż pod spód talii.
      let top: CardInstance;
      if (eventDeck.length >= 2 && hasBattlefieldAbility(state, catalog, action.matchPlayerId, "pathExpertPeekAndKeepBest")) {
        const [c1, c2] = eventDeck;
        const def1 = catalog.get(c1.definitionId);
        const def2 = catalog.get(c2.definitionId);
        const pol1 = def1?.type === "event" ? def1.polarity : undefined;
        const pol2 = def2?.type === "event" ? def2.polarity : undefined;
        const [chosen, buried] = pol2 === "positive" && pol1 !== "positive" ? [c2, c1] : [c1, c2];
        top = chosen;
        const maxIndex = eventDeck.reduce((max, c) => Math.max(max, c.slotIndex ?? 0), -1);
        buried.slotIndex = maxIndex + 1;
      } else {
        top = eventDeck[0];
      }

      const definition = catalog.get(top.definitionId);
      if (!definition || definition.type !== "event") {
        throw new Error(`Definicja karty Wydarzenia "${top.definitionId}" nieznaleziona.`);
      }
      assertSufficientCoins(state, action.matchPlayerId, definition.cost);

      const player = getPlayer(state, action.matchPlayerId);
      player.coins -= definition.cost;
      top.ownerMatchPlayerId = action.matchPlayerId;

      if (definition.timing === "held_one_shot") {
        top.zone = "hand";
        top.slotIndex = null;
      } else {
        resolveEffect(definition.effectKey, {
          state,
          catalog,
          sourceCard: top,
          ownerMatchPlayerId: action.matchPlayerId,
          params: definition.params,
          emit,
        });
        top.zone = "event_discard";
        top.slotIndex = null;
      }
      emit("EVENT_CARD_BOUGHT", { cardInstanceId: top.instanceId, timing: definition.timing });
      break;
    }

    case "PLAY_EVENT_FROM_HAND": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      assertMainPhaseAction(state);
      const card = state.cards[action.cardInstanceId];
      if (!card || card.ownerMatchPlayerId !== action.matchPlayerId || card.zone !== "hand") {
        throw new GameRuleError("Karta Wydarzenia nie znajduje się na ręce tego gracza.", "CARD_NOT_IN_HAND");
      }
      const definition = catalog.get(card.definitionId);
      if (!definition || definition.type !== "event") {
        throw new Error(`Definicja karty Wydarzenia "${card.definitionId}" nieznaleziona.`);
      }
      resolveEffect(definition.effectKey, {
        state,
        catalog,
        sourceCard: card,
        ownerMatchPlayerId: action.matchPlayerId,
        params: definition.params,
        actionParams: action.params,
        emit,
      });

      // Zasadzka Banitów: karta wraca pod spód Talii Wydarzeń zamiast trafiać na stos odrzuconych.
      if (definition.params?.returnToBottomOfEventDeck) {
        const deck = cardsInZone(state, "shared", "event_deck");
        const maxIndex = deck.reduce((max, c) => Math.max(max, c.slotIndex ?? 0), -1);
        card.zone = "event_deck";
        card.ownerMatchPlayerId = "shared";
        card.slotIndex = maxIndex + 1;
      } else {
        card.zone = "event_discard";
        card.slotIndex = null;
      }
      emit("EVENT_CARD_PLAYED", { cardInstanceId: card.instanceId });
      break;
    }

    case "USE_ABILITY": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      assertMainPhaseAction(state);
      const card = state.cards[action.cardInstanceId];
      const onBattlefield =
        card &&
        (card.zone === "play_area" || card.zone === "tower" || card.zone === "mine" || card.zone === "barracks" || card.zone === "stronghold");
      if (!card || card.ownerMatchPlayerId !== action.matchPlayerId || !onBattlefield) {
        throw new GameRuleError("Karta nie znajduje się w obszarze gry tego gracza.", "CARD_NOT_ON_BATTLEFIELD");
      }
      assertUnitReadyToAct(card);
      const definition = getUnitDefinition(catalog, card.definitionId);
      const ability = definition.abilities.find((a) => a.key === action.abilityKey && a.trigger === "activated");
      if (!ability) {
        throw new GameRuleError(`Zdolność "${action.abilityKey}" nie istnieje lub nie jest aktywowana ręcznie.`, "ABILITY_NOT_FOUND");
      }
      if (card.status.activatedAbilityUsedThisTurn) {
        throw new GameRuleError("Ta zdolność została już użyta w tej turze.", "ABILITY_ALREADY_USED");
      }
      resolveEffect(ability.effectKey, {
        state,
        catalog,
        sourceCard: card,
        ownerMatchPlayerId: action.matchPlayerId,
        params: ability.params,
        actionParams: action.params,
        emit,
      });
      consumeStrongholdAction(state, catalog, card);
      emit("ABILITY_USED", { cardInstanceId: card.instanceId, abilityKey: action.abilityKey });
      break;
    }

    case "ATTACK": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      assertMainPhaseAction(state);
      resolveAttackAction(state, catalog, action.matchPlayerId, action.attackerInstanceIds, action.targets, emit);
      break;
    }

    case "END_TURN": {
      assertIsCurrentPlayer(state, action.matchPlayerId);
      endTurn(state, catalog, emit);
      break;
    }

    default:
      throw new GameRuleError(`Nieobsłużony typ akcji: ${(action as GameAction).type}`, "UNKNOWN_ACTION");
  }

  recomputeAuras(state, catalog);
  checkEliminationsAndWinner(state, emit);

  return { state, events };
}

function advanceToNextActivePlayer(state: GameState): void {
  let nextIndex = state.currentPlayerIndex;
  do {
    nextIndex = (nextIndex + 1) % state.turnOrder.length;
  } while (getPlayer(state, state.turnOrder[nextIndex]).eliminated && nextIndex !== state.currentPlayerIndex);
  if (nextIndex <= state.currentPlayerIndex) state.turnNumber += 1;
  state.currentPlayerIndex = nextIndex;
}

function endTurn(state: GameState, catalog: CardCatalog, emit: (type: string, payload?: Record<string, unknown>) => void) {
  const endingPlayer = currentPlayer(state);
  processTurnEnd(state, catalog, endingPlayer.matchPlayerId, emit);

  // Gracze pod efektem "pomiń swoją następną turę" (Zachodni Wiatr, Utknięcie w Grzęzawisku,
  // Przysługa dla Księcia, Wędrowna Trupa Artystyczna...) są przeskakiwani całkowicie —
  // ich tura nigdy się nie rozpoczyna, więc processTurnStart się dla nich nie odpala.
  let nextPlayer: ReturnType<typeof currentPlayer>;
  do {
    advanceToNextActivePlayer(state);
    nextPlayer = currentPlayer(state);
    if (nextPlayer.turnsToSkip > 0) {
      nextPlayer.turnsToSkip -= 1;
      // Pominięta tura wciąż "mija" dla tego gracza — ochrona czasowa (Wędrowna Trupa
      // Artystyczna...) musi się odliczać, inaczej trwałaby dłużej niż zamierzono, bo
      // processTurnStart (jedyne inne miejsce dekrementujące) nigdy nie odpala się dla pominiętej tury.
      if (nextPlayer.untargetableTurnsRemaining > 0) nextPlayer.untargetableTurnsRemaining -= 1;
      emit("TURN_SKIPPED", { matchPlayerId: nextPlayer.matchPlayerId });
    } else {
      break;
    }
  } while (nextPlayer.matchPlayerId !== endingPlayer.matchPlayerId);

  state.turnPhase = "draw";
  nextPlayer.hasMadeDrawChoiceThisTurn = false;
  processTurnStart(state, catalog, nextPlayer.matchPlayerId, emit);

  emit("TURN_ENDED", { nextMatchPlayerId: nextPlayer.matchPlayerId, turnNumber: state.turnNumber });
}

function checkEliminationsAndWinner(state: GameState, emit: (type: string, payload?: Record<string, unknown>) => void) {
  for (const player of state.players) {
    if (!player.eliminated && player.kingdomHp <= 0) {
      player.eliminated = true;
      // "Wszystkie należące do niego jednostki, infrastruktura oraz karty zostają usunięte z rozgrywki.
      //  Monety zaś trafiają do obszaru wspólnego."
      for (const card of Object.values(state.cards)) {
        if (card.ownerMatchPlayerId === player.matchPlayerId) {
          delete state.cards[card.instanceId];
        }
      }
      state.bankCoins += player.coins;
      player.coins = 0;
      emit("PLAYER_ELIMINATED", { matchPlayerId: player.matchPlayerId });
    }
  }

  const remaining = state.players.filter((p) => !p.eliminated);
  // remaining.length === 0 jest możliwe, gdy efekt globalny (np. Długie Zaćmienie Słońca) zabija
  // WSZYSTKICH pozostałych graczy jednocześnie — bez tej gałęzi mecz zostawałby na zawsze
  // "in_progress" bez zwycięzcy, bo warunek === 1 nigdy by się nie spełnił.
  if (state.status === "in_progress" && remaining.length <= 1) {
    state.status = "finished";
    state.winnerMatchPlayerId = remaining[0]?.matchPlayerId ?? null;
    emit("GAME_FINISHED", { winnerMatchPlayerId: state.winnerMatchPlayerId });
  }
}
