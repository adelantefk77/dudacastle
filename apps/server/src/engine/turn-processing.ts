import type { CardInstance, GameState, PlayerState } from "@dudacastle/shared";
import { BATTLEFIELD_ZONES } from "@dudacastle/shared";
import type { CardCatalog } from "./catalog.js";
import { getInfrastructureDefinition, getUnitDefinition } from "./catalog.js";
import { resolveEffect } from "./effect-resolver.js";
import { resolveAutomaticAttack, destroyUnit } from "./combat.js";
import { cardsInZone, getPlayer } from "./selectors.js";
import { moveToDiscard } from "./zones.js";

type Emit = (type: string, payload?: Record<string, unknown>) => void;

/** Karta infrastruktury (nie jednostka) w danej strefie należąca do gracza. */
function infraInstancesOf(state: GameState, catalog: CardCatalog, matchPlayerId: string, zone: CardInstance["zone"]) {
  return cardsInZone(state, matchPlayerId, zone).filter((c) => catalog.get(c.definitionId)?.type === "infrastructure");
}

/**
 * Jednostki "siedzące" na danej karcie infrastruktury (ten sam zone, definicja typu unit).
 * UWAGA: dopasowanie po samym `zone`, nie po równości `slotIndex` z kartą infrastruktury —
 * Wieża ma 2 miejsca na jednostki (mechanics.maxUnits=2), więc druga jednostka miałaby
 * slotIndex=1 i nie zostałaby znaleziona, gdyby wymagać równości ze slotIndex infry (zawsze 0).
 * Uproszczenie: zakłada, że gracz posiada co najwyżej JEDNĄ kartę danego rodzaju infrastruktury
 * (prawdziwe dla Wieży; dla Kopalni/Koszar/Warowni z puli współdzielonej graczy-1 sztuk gracz
 * teoretycznie mógłby kupić więcej niż jedną kopię tego samego rodzaju — nieobsłużone, do
 * doprecyzowania jeśli balans na to pozwoli).
 */
function occupantsOf(state: GameState, catalog: CardCatalog, infra: CardInstance): CardInstance[] {
  return Object.values(state.cards).filter(
    (c) =>
      c.ownerMatchPlayerId === infra.ownerMatchPlayerId &&
      c.zone === infra.zone &&
      c.instanceId !== infra.instanceId &&
      catalog.get(c.definitionId)?.type === "unit",
  );
}

/**
 * Dochód z infrastruktury na początku tury (Kopalnia, Kopalnia Goblinów, Poborca).
 * Uproszczenie: instrukcja warunkuje bonus Kopalni obecnością jednostki "humanoidalnej",
 * ale nie definiuje listy jednostek humanoidalnych — traktujemy obecność DOWOLNEJ
 * jednostki jako spełnienie tego warunku (do doprecyzowania względem oryginalnych kart).
 */
function processIncome(state: GameState, catalog: CardCatalog, player: PlayerState, emit: Emit): void {
  let income = player.flatBonusCoinsPerTurn;

  for (const mine of infraInstancesOf(state, catalog, player.matchPlayerId, "mine")) {
    const def = getInfrastructureDefinition(catalog, mine.definitionId);
    const occupant = occupantsOf(state, catalog, mine)[0];
    let amount = def.mechanics.baseCoinProduction ?? 1;
    if (occupant) {
      const occupantDef = getUnitDefinition(catalog, occupant.definitionId);
      const poborca = occupantDef.abilities.find((a) => a.effectKey === "flatCoinOnInfra");
      const gornik = occupantDef.abilities.find((a) => a.effectKey === "mineProductionOverride");
      if (poborca && (poborca.params?.infra as string[] | undefined)?.includes("mine")) {
        amount = Number(poborca.params?.amount ?? 4);
      } else if (gornik) {
        amount = Number(gornik.params?.amount ?? 5);
      } else {
        amount = def.mechanics.humanoidCoinProduction ?? 3;
      }
    }
    if (player.mineProductionMultiplier > 1) amount *= player.mineProductionMultiplier;
    income += amount;
  }

  // Poborca działa też w Wieży, nie tylko w Kopalni.
  for (const tower of infraInstancesOf(state, catalog, player.matchPlayerId, "tower")) {
    for (const occupant of occupantsOf(state, catalog, tower)) {
      const occupantDef = getUnitDefinition(catalog, occupant.definitionId);
      const poborca = occupantDef.abilities.find((a) => a.effectKey === "flatCoinOnInfra");
      if (poborca && (poborca.params?.infra as string[] | undefined)?.includes("tower")) {
        income += Number(poborca.params?.amount ?? 4);
      }
    }
  }

  if (income > 0) {
    player.coins += income;
    emit("INCOME_COLLECTED", { matchPlayerId: player.matchPlayerId, amount: income });
  }
  player.mineProductionMultiplier = 1;
}

/**
 * Koszary (v3 — zob. simulator_v3.py activate_stored_units): jednostki umieszczone w poprzedniej
 * turze stają się gotowe na początku tej tury i NATYCHMIAST (automatycznie, bez udziału gracza —
 * zgodnie z instrukcją: "opuszczają Koszary, aktywują Cross Training, po czym zostają odrzucone")
 * wykonują atak, po czym trafiają na stos odrzuconych:
 *  - jeśli OBIE karty w Koszarach stają się gotowe jednocześnie (umieszczone tej samej turze):
 *    Cross Training — każda atakuje z PODWOJONYM własnym ATK, obie trafiają na odrzucone razem;
 *  - jeśli gotowa jest tylko JEDNA (brak partnera): zwykły pojedynczy atak, bez podwojenia.
 * Uproszczenie względem v3: pominięta "wspólna pula zdolności" pary (np. Nagual korzystający z
 * Jadowitego Prysku Wyverna) — wymagałoby tymczasowego nadpisania zdolności między kartami.
 * Warownia: jednostka odzyskuje możliwość działania (2 akcje, inicjowane przez gracza).
 */
function releaseGarrisonedUnits(state: GameState, catalog: CardCatalog, matchPlayerId: string, emit: Emit): void {
  const barracksUnits = cardsInZone(state, matchPlayerId, "barracks").filter(
    (c) => catalog.get(c.definitionId)?.type === "unit" && c.status.readyToAct === false,
  );
  if (barracksUnits.length === 2) {
    const [a, b] = barracksUnits;
    // Podwojenie ATK (Cross Training) — zjada się przy pierwszym ataku, jak Inicjatywa.
    a.status.tempAtkBonus = (a.status.tempAtkBonus ?? 0) + a.currentAtk;
    b.status.tempAtkBonus = (b.status.tempAtkBonus ?? 0) + b.currentAtk;
    // v3: OBIE karty najpierw atakują, DOPIERO POTEM trafiają na odrzucone RAZEM (jednocześnie —
    // ma to znaczenie np. dla Przywołania Emisariusza En-šukud, które sprawdza parę odrzuconą
    // "w tej samej turze"). Szał Bitewny Orka (retaliacja) mógł już przenieść atakującego na
    // odrzucone wcześniej — stąd sprawdzenie strefy przed odrzuceniem, żeby nie zdublować.
    resolveAutomaticAttack(state, catalog, a, emit);
    resolveAutomaticAttack(state, catalog, b, emit);
    // destroyUnit (nie moveToDiscard) — nawet rutynowe odesłanie z Koszar musi odpalić on_death
    // celu (np. Przywołanie, jeśli obaj Emisariusze En-šukud trafią na odrzucone tą drogą razem).
    // Nie "destroyedByOpponent": to nie jest zabicie przez przeciwnika, więc Feniks się tu NIE
    // odradza — zgodnie z opisem karty ("po odrzuceniu PRZEZ PRZECIWNIKA").
    if (a.zone === "barracks") destroyUnit(state, catalog, a, emit);
    if (b.zone === "barracks") destroyUnit(state, catalog, b, emit);
    emit("CROSS_TRAINING_TRIGGERED", { cardInstanceIds: [a.instanceId, b.instanceId] });
  } else if (barracksUnits.length === 1) {
    const [solo] = barracksUnits;
    resolveAutomaticAttack(state, catalog, solo, emit);
    if (solo.zone === "barracks") destroyUnit(state, catalog, solo, emit);
  }

  for (const card of cardsInZone(state, matchPlayerId, "stronghold")) {
    if (catalog.get(card.definitionId)?.type !== "unit") continue;
    if (card.status.readyToAct === false) {
      card.status.readyToAct = true;
      card.status.actionsTakenThisTurn = 0;
    }
  }
}

/** Na koniec tury: jednostki z Warowni, które miały już swoje okno akcji, odchodzą na stos odrzuconych. */
function dischargeSpentStrongholdUnits(state: GameState, catalog: CardCatalog, matchPlayerId: string): void {
  for (const card of cardsInZone(state, matchPlayerId, "stronghold")) {
    if (catalog.get(card.definitionId)?.type !== "unit") continue;
    if (card.status.readyToAct === true) moveToDiscard(state, catalog, card);
  }
}

function fireScheduledEffect(
  state: GameState,
  catalog: CardCatalog,
  player: PlayerState,
  effect: { effectKey: string; params?: Record<string, unknown> },
  emit: Emit,
): void {
  switch (effect.effectKey) {
    case "activateMineProductionMultiplier":
      player.mineProductionMultiplier = Number(effect.params?.multiplier ?? 2);
      break;
    case "freeKingdomDeckDraw": {
      const deck = cardsInZone(state, player.matchPlayerId, "kingdom_deck").sort(
        (a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0),
      );
      const top = deck[0];
      if (top) {
        top.zone = "hand";
        top.slotIndex = null;
      }
      break;
    }
    case "grantCoins":
      player.coins += Number(effect.params?.amount ?? 0);
      break;
    default:
      emit("UNKNOWN_SCHEDULED_EFFECT", { effectKey: effect.effectKey });
  }
  void catalog;
}

/** Wywoływane raz na początku tury gracza, którego tura właśnie się zaczyna. */
export function processTurnStart(state: GameState, catalog: CardCatalog, matchPlayerId: string, emit: Emit): void {
  const player = getPlayer(state, matchPlayerId);

  // Kolejka zaplanowanych efektów MUSI odpalić się PRZED naliczeniem dochodu — inaczej np.
  // "Spotkanie Przyjaznego Trolla" (x3 produkcja Kopalni w NAJBLIŻSZEJ turze) aktywowałoby się o
  // jedną turę za późno, bo dochód zostałby już naliczony ze starym mnożnikiem.
  const remaining: typeof player.scheduledTurnEffects = [];
  for (const effect of player.scheduledTurnEffects) {
    if (effect.turnsUntil > 0) {
      remaining.push({ ...effect, turnsUntil: effect.turnsUntil - 1 });
    } else {
      fireScheduledEffect(state, catalog, player, effect, emit);
    }
  }
  player.scheduledTurnEffects = remaining;

  processIncome(state, catalog, player, emit);

  // Kopalnia NIE daje prawa do ataku, ale jednostka tam wciąż "żyje w grze" — jej pasywne
  // zdolności on_turn_start (Uzdrowienie, Zręczność, Wzmocnienie...) nadal działają (v3: zob.
  // simulator_v3.py start_turn_income(), które liczy board+tower+mine, nie tylko board+tower).
  //
  // Zręczność/Uzdrowienie mają się odpalić RAZ NA KAŻDĄ kartę, która je niesie (dwóch uzdrowicieli
  // leczy podwójnie) — ale Siostrzana Przysięga Amazonki to próg "masz 2 Amazonki" dla CAŁEJ armii,
  // nie bonus per-kopia: bez deduplikacji 2 Amazonki odpalały ten sam efekt (podejrzyj 3 karty
  // talii startowej, zagraj/odrzuć) dwa razy na start tury zamiast raz.
  const thresholdEffectsFiredThisCall = new Set<string>();
  for (const card of [
    ...cardsInZone(state, matchPlayerId, "play_area"),
    ...cardsInZone(state, matchPlayerId, "tower"),
    ...cardsInZone(state, matchPlayerId, "mine"),
  ]) {
    if (catalog.get(card.definitionId)?.type !== "unit") continue;
    const def = getUnitDefinition(catalog, card.definitionId);
    for (const ability of def.abilities) {
      if (ability.trigger !== "on_turn_start") continue;
      if (ability.effectKey === "amazonSisterlyOath") {
        if (thresholdEffectsFiredThisCall.has(ability.effectKey)) continue;
        thresholdEffectsFiredThisCall.add(ability.effectKey);
      }
      resolveEffect(ability.effectKey, {
        state,
        catalog,
        sourceCard: card,
        ownerMatchPlayerId: matchPlayerId,
        params: ability.params,
        emit,
      });
    }
  }

  releaseGarrisonedUnits(state, catalog, matchPlayerId, emit);

  if (player.untargetableTurnsRemaining > 0) player.untargetableTurnsRemaining -= 1;

  for (const card of Object.values(state.cards)) {
    if (card.ownerMatchPlayerId === matchPlayerId) card.status.activatedAbilityUsedThisTurn = false;
  }
}

/** Wywoływane raz na końcu tury gracza, którego tura się właśnie kończy. */
export function processTurnEnd(state: GameState, catalog: CardCatalog, matchPlayerId: string): void {
  const player = getPlayer(state, matchPlayerId);
  player.doubleAtkUntilEndOfTurn = false;

  dischargeSpentStrongholdUnits(state, catalog, matchPlayerId);

  // "Obrażenia nie przechodzą między turami" — jednostki, które przeżyły, odzyskują pełne HP.
  for (const card of Object.values(state.cards)) {
    if (card.ownerMatchPlayerId !== matchPlayerId || !BATTLEFIELD_ZONES.includes(card.zone)) continue;
    if (catalog.get(card.definitionId)?.type !== "unit") continue;
    const def = getUnitDefinition(catalog, card.definitionId);
    card.currentHp = def.hp + (card.status.permanentHpBonus ?? 0) + (card.status.auraHpBonus ?? 0);
    card.status.hasAttacked = false;
    card.status.tempAtkBonus = 0;
  }
}
