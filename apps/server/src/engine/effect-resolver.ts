import { nanoid } from "nanoid";
import type { CardInstance, GameState } from "@dudacastle/shared";
import { BATTLEFIELD_ZONES } from "@dudacastle/shared";
import type { CardCatalog } from "./catalog.js";
import { getUnitDefinition } from "./catalog.js";
import { drawFromStartingDeck } from "./deck-utils.js";
import { GameRuleError } from "./errors.js";
import { cardsInZone, getPlayer } from "./selectors.js";
import { drawAndPlaceFromStartingDeck, placeUnitBaseStats } from "./unit-lifecycle.js";
import { findFreeSlotIndex, moveToDiscard, moveToHand } from "./zones.js";

/** Heurystyka "jak dobra jest ta karta" — zob. cards.py priority_score (uproszczona: bez bonusów per-zdolność). */
function unitValueHeuristic(def: { atk: number; hp: number }): number {
  return def.atk * 1.5 + def.hp * 0.5;
}

export interface EffectContext {
  state: GameState;
  catalog: CardCatalog;
  /** Karta, z której pochodzi efekt (jednostka ze zdolnością, karta Wydarzenia...) */
  sourceCard: CardInstance;
  ownerMatchPlayerId: string;
  /** Statyczne parametry z definicji karty (packages/shared) */
  params?: Record<string, unknown>;
  /** Parametry wybrane przez gracza w momencie wywołania (cel, wybrana zdolność...) */
  actionParams?: Record<string, unknown>;
  emit: (type: string, payload?: Record<string, unknown>) => void;
}

type EffectFn = (ctx: EffectContext) => void;

function battlefieldUnitsOf(state: GameState, catalog: CardCatalog, matchPlayerId: string): CardInstance[] {
  return Object.values(state.cards).filter(
    (c) =>
      c.ownerMatchPlayerId === matchPlayerId &&
      BATTLEFIELD_ZONES.includes(c.zone) &&
      catalog.get(c.definitionId)?.type === "unit",
  );
}

function otherActivePlayers(state: GameState, exceptMatchPlayerId: string) {
  return state.players.filter((p) => p.matchPlayerId !== exceptMatchPlayerId && !p.eliminated);
}

/** Kolejny gracz w kolejności tur po `matchPlayerId` (z pominięciem wyeliminowanych), zgodnie z ruchem wskazówek zegara. */
function nextPlayerInOrder(state: GameState, matchPlayerId: string) {
  const idx = state.turnOrder.indexOf(matchPlayerId);
  for (let step = 1; step <= state.turnOrder.length; step++) {
    const candidate = getPlayer(state, state.turnOrder[(idx + step) % state.turnOrder.length]);
    if (!candidate.eliminated) return candidate;
  }
  return getPlayer(state, matchPlayerId);
}

const EFFECT_REGISTRY: Record<string, EffectFn> = {
  // ---- Zdolności jednostek ----

  // Zręczność (Faun, Ludzie, Pegaz)
  drawFromStartingDeck: ({ state, ownerMatchPlayerId, params }) => {
    drawFromStartingDeck(state, ownerMatchPlayerId, Number(params?.count ?? 1));
  },

  // Uzdrowienie (Faun, Druid, Feniks, Mag)
  healKingdom: ({ state, ownerMatchPlayerId, params }) => {
    getPlayer(state, ownerMatchPlayerId).kingdomHp += Number(params?.amount ?? 1);
  },

  // Wzmocnienie (Faun, Druid, Feniks, Mag, Elf Świetlisty) — jednorazowy przyrost na start tury, nie aura ciągła.
  buffOwnUnitsHp: ({ state, catalog, ownerMatchPlayerId, params }) => {
    const amount = Number(params?.amount ?? 1);
    for (const unit of battlefieldUnitsOf(state, catalog, ownerMatchPlayerId)) {
      unit.status.permanentHpBonus = (unit.status.permanentHpBonus ?? 0) + amount;
      unit.currentHp += amount;
    }
  },

  // Inicjatywa (Elf Leśny, Gryf, Czarodziej, Elf Mroczny, Elf Świetlisty, Munmaa...) — konsumowane przy pierwszym ataku.
  buffSelfAtkNextAttack: ({ sourceCard, params }) => {
    sourceCard.status.tempAtkBonus = (sourceCard.status.tempAtkBonus ?? 0) + Number(params?.amount ?? 2);
  },

  // Szał Bitewny (Ork, on_death) — zabija atakującego (przy ataku łączonym: tego o niższym HP).
  retaliateKillAttacker: ({ state, catalog, actionParams }) => {
    const attackerIds = (actionParams?.attackerInstanceIds as string[] | undefined) ?? [];
    const attackers = attackerIds.map((id) => state.cards[id]).filter((c): c is CardInstance => !!c);
    if (attackers.length === 0) return;
    const target = attackers.reduce((lowest, c) => (c.currentHp < lowest.currentHp ? c : lowest));
    moveToDiscard(state, catalog, target);
  },

  // Szarża (Elf Mroczny, Minotaur, Centaur — on_enemy_destroyed): drugi atak natychmiast, potem odrzucona.
  // Rozpatrywane strukturalnie w reducer.ts (ATTACK) — tu tylko ustawiamy flagę udostępniającą dodatkowy atak.
  extraAttackThenDiscard: ({ sourceCard }) => {
    sourceCard.status.hasAttacked = false;
  },

  // Powstanie z popiołów (Feniks, on_death, tylko gdy odrzucony przez przeciwnika)
  replaceWithNextStartingDeckCardOnEnemyDiscard: ({ state, catalog, sourceCard, ownerMatchPlayerId, actionParams }) => {
    if (!actionParams?.destroyedByOpponent) return;
    const slotIndex = sourceCard.slotIndex;
    if (slotIndex === null) return;
    drawAndPlaceFromStartingDeck(state, catalog, ownerMatchPlayerId, 0);
    void slotIndex; // miejsce Feniksa już zwolnione przez moveToDiscard w reducerze przed wywołaniem tego efektu
  },

  // Przywołanie (Emisariusz En-šukud, on_death) — jeśli para odrzucona w tej samej turze.
  recycleFromDiscardOnPairDeath: ({ state, catalog, sourceCard, ownerMatchPlayerId, params }) => {
    const pairName = String(params?.pairUnitName ?? "");
    const otherCopyDiscardedThisTurn = Object.values(state.cards).some(
      (c) =>
        c.instanceId !== sourceCard.instanceId &&
        c.ownerMatchPlayerId === ownerMatchPlayerId &&
        c.zone === "discard" &&
        c.status.destroyedOnTurn === state.turnNumber &&
        c.definitionId === sourceCard.definitionId &&
        pairName.length > 0,
    );
    if (!otherCopyDiscardedThisTurn) return;
    const discard = cardsInZone(state, ownerMatchPlayerId, "discard").filter(
      (c) => c.instanceId !== sourceCard.instanceId,
    );
    const hand = cardsInZone(state, ownerMatchPlayerId, "hand");
    if (discard.length === 0 || hand.length === 0) return;
    // Uproszczenie: bez interaktywnego wyboru gracza, silnik wybiera deterministycznie
    // (najnowszy odrzucony trafia na rękę, najstarsza karta z ręki jest odrzucana).
    const recovered = discard[discard.length - 1];
    moveToHand(recovered);
    moveToDiscard(state, catalog, hand[0]);
  },

  // Harpii Zryw / Galop (activated) — przenosi tę jednostkę na wskazane wolne miejsce.
  relocateSelf: ({ state, sourceCard, ownerMatchPlayerId, actionParams }) => {
    const targetSlot = Number(actionParams?.targetSlotIndex);
    const occupied = cardsInZone(state, ownerMatchPlayerId, "play_area").some(
      (c) => c.slotIndex === targetSlot && c.instanceId !== sourceCard.instanceId,
    );
    if (occupied) throw new GameRuleError("Docelowe miejsce jest zajęte.", "SLOT_OCCUPIED");
    sourceCard.slotIndex = targetSlot;
    sourceCard.status.activatedAbilityUsedThisTurn = true;
  },

  // Powietrzny Transport (Pegaz, activated) — przenosi INNĄ sojuszniczą jednostkę.
  relocateAllyOncePerTurn: ({ state, sourceCard, ownerMatchPlayerId, actionParams }) => {
    const targetId = String(actionParams?.targetInstanceId ?? "");
    const targetSlot = Number(actionParams?.targetSlotIndex);
    const ally = state.cards[targetId];
    if (!ally || ally.ownerMatchPlayerId !== ownerMatchPlayerId || ally.zone !== "play_area") {
      throw new GameRuleError("Nieprawidłowa sojusznicza jednostka do przeniesienia.", "INVALID_ALLY_TARGET");
    }
    const occupied = cardsInZone(state, ownerMatchPlayerId, "play_area").some(
      (c) => c.slotIndex === targetSlot && c.instanceId !== ally.instanceId,
    );
    if (occupied) throw new GameRuleError("Docelowe miejsce jest zajęte.", "SLOT_OCCUPIED");
    ally.slotIndex = targetSlot;
    sourceCard.status.activatedAbilityUsedThisTurn = true;
  },

  // Harmonia (Munmaa, activated) — zamienia miejscami dwie własne jednostki.
  swapTwoOwnUnitsOncePerTurn: ({ state, sourceCard, ownerMatchPlayerId, actionParams }) => {
    const a = state.cards[String(actionParams?.instanceIdA ?? "")];
    const b = state.cards[String(actionParams?.instanceIdB ?? "")];
    if (!a || !b || a.ownerMatchPlayerId !== ownerMatchPlayerId || b.ownerMatchPlayerId !== ownerMatchPlayerId) {
      throw new GameRuleError("Nieprawidłowe jednostki do zamiany.", "INVALID_SWAP_TARGETS");
    }
    const tmp = a.slotIndex;
    a.slotIndex = b.slotIndex;
    b.slotIndex = tmp;
    sourceCard.status.activatedAbilityUsedThisTurn = true;
  },

  // ---- Karty Wydarzeń ----

  // Warownia (1) / Koszary (1) / Kopalnia (1)
  grantInfrastructureCard: ({ state, ownerMatchPlayerId, params, emit }) => {
    const kind = String(params?.kind) as "mine" | "barracks" | "stronghold";
    const poolKey = kind === "mine" ? "mines" : kind === "barracks" ? "barracks" : "strongholds";
    if (state.infrastructurePool[poolKey] <= 0) {
      emit("INFRASTRUCTURE_POOL_EXHAUSTED", { kind });
      return;
    }
    state.infrastructurePool[poolKey] -= 1;
    const infraDefId = `infra-${kind}`;
    const card: CardInstance = {
      instanceId: nanoid(),
      definitionId: infraDefId,
      ownerMatchPlayerId,
      zone: kind,
      slotIndex: 0,
      currentHp: 0,
      currentAtk: 0,
      status: {},
    };
    state.cards[card.instanceId] = card;
    emit("INFRASTRUCTURE_GRANTED", { kind, cardInstanceId: card.instanceId });
  },

  // Płatnerz — trwały bonus HP dla wszystkich (także przyszłych) jednostek gracza.
  permanentAuraHpAllOwnUnits: ({ state, ownerMatchPlayerId, params }) => {
    getPlayer(state, ownerMatchPlayerId).permanentUnitHpAura += Number(params?.amount ?? 1);
  },

  // Wojownik Srebrnych Głów — użycza jednej z 4 zdolności wybranej jednostce, jednorazowo.
  grantOneShotAbilityToUnit: ({ state, ownerMatchPlayerId, actionParams, emit, catalog }) => {
    const targetId = String(actionParams?.targetInstanceId ?? "");
    const chosen = String(actionParams?.chosenAbilityKey ?? "");
    const target = state.cards[targetId];
    if (!target || target.ownerMatchPlayerId !== ownerMatchPlayerId) {
      throw new GameRuleError("Nieprawidłowa jednostka docelowa.", "INVALID_TARGET");
    }
    const oneShotEffects: Record<string, { effectKey: string; params?: Record<string, unknown> }> = {
      uzdrowienie: { effectKey: "healKingdom", params: { amount: 1 } },
      zrecznosc: { effectKey: "drawFromStartingDeck", params: { count: 1 } },
      inicjatywa: { effectKey: "buffSelfAtkNextAttack", params: { amount: 2 } },
      szarza: { effectKey: "extraAttackThenDiscard" },
    };
    const mapped = oneShotEffects[chosen];
    if (!mapped) throw new GameRuleError(`Nieznana zdolność: ${chosen}`, "UNKNOWN_ABILITY_CHOICE");
    resolveEffect(mapped.effectKey, {
      state,
      catalog,
      sourceCard: target,
      ownerMatchPlayerId,
      params: mapped.params,
      emit,
    });
  },

  // Generał Szarych Płaszczy — ATK x2 do końca tej tury.
  doubleAtkAllOwnUnitsThisTurn: ({ state, ownerMatchPlayerId }) => {
    getPlayer(state, ownerMatchPlayerId).doubleAtkUntilEndOfTurn = true;
  },

  // Kopalnia Goblinów — stały bonus monet co własną turę, bez wymogu jednostki.
  grantPermanentCoinProducer: ({ state, ownerMatchPlayerId, params }) => {
    getPlayer(state, ownerMatchPlayerId).flatBonusCoinsPerTurn += Number(params?.amount ?? 0);
  },

  // Sekrety Hrabiny
  collectCoinFromEachOpponentOrSkipTurn: ({ state, ownerMatchPlayerId, params }) => {
    const amount = Number(params?.amount ?? 1);
    const caster = getPlayer(state, ownerMatchPlayerId);
    for (const opponent of otherActivePlayers(state, ownerMatchPlayerId)) {
      if (opponent.coins >= amount) {
        opponent.coins -= amount;
        caster.coins += amount;
      } else {
        opponent.turnsToSkip += 1;
      }
    }
  },

  // Sprzyjająca Pogoda
  healAllKingdoms: ({ state, params }) => {
    const amount = Number(params?.amount ?? 1);
    for (const player of state.players) if (!player.eliminated) player.kingdomHp += amount;
  },

  // Zachodni Wiatr
  skipNextPlayerTurn: ({ state, ownerMatchPlayerId }) => {
    nextPlayerInOrder(state, ownerMatchPlayerId).turnsToSkip += 1;
  },

  // Mgła — v3: chroni AŻ DO nadejścia własnej następnej tury (nie tylko do końca bieżącej), czyli
  // przez pełną kolejkę wszystkich przeciwników. Ponieważ karta jest zagrywana W TRAKCIE własnej
  // tury (po tym, jak `untargetableTurnsRemaining` zostało już zdekrementowane na starcie tej
  // tury), ustawienie 1 tutaj poprawnie przetrwa do startu następnej własnej tury, gdzie zostanie
  // zdekrementowane do 0 (zob. turn-processing.ts processTurnStart).
  untargetableSelfThisTurn: ({ state, ownerMatchPlayerId }) => {
    const player = getPlayer(state, ownerMatchPlayerId);
    player.untargetableTurnsRemaining = Math.max(player.untargetableTurnsRemaining, 1);
  },

  // Długie Zaćmienie Słońca
  damageAllKingdoms: ({ state, params }) => {
    const amount = Number(params?.amount ?? 1);
    for (const player of state.players) if (!player.eliminated) player.kingdomHp -= amount;
  },

  // Spotkanie Przyjaznego Trolla — POTROJENIE (v3) produkcji Kopalni w NAJBLIŻSZEJ turze właściciela.
  doubleMineProductionNextTurn: ({ state, ownerMatchPlayerId, params }) => {
    getPlayer(state, ownerMatchPlayerId).scheduledTurnEffects.push({
      id: nanoid(),
      effectKey: "activateMineProductionMultiplier",
      params: { multiplier: Number(params?.multiplier ?? 2) },
      turnsUntil: 0,
    });
  },

  // Spotkanie Alchemika
  drawAndPlayUnitWithBonusHp: ({ state, catalog, ownerMatchPlayerId, params }) => {
    drawAndPlaceFromStartingDeck(state, catalog, ownerMatchPlayerId, Number(params?.hpBonus ?? 0));
  },

  // Przysługa dla Księcia
  skipTurnThenFreeUnitDraw: ({ state, ownerMatchPlayerId }) => {
    const player = getPlayer(state, ownerMatchPlayerId);
    player.turnsToSkip += 1;
    player.scheduledTurnEffects.push({ id: nanoid(), effectKey: "freeKingdomDeckDraw", turnsUntil: 0 });
  },

  // Zaraźliwa Plaga
  discardOwnUnitsOrPassEffect: ({ state, catalog, ownerMatchPlayerId, params, emit }) => {
    const amount = Number(params?.amount ?? 2);
    let currentOwner = ownerMatchPlayerId;
    for (let hop = 0; hop < state.players.length; hop++) {
      const units = battlefieldUnitsOf(state, catalog, currentOwner);
      if (units.length > 0) {
        units.slice(0, amount).forEach((u) => moveToDiscard(state, catalog, u));
        emit("PLAGUE_RESOLVED", { matchPlayerId: currentOwner, discarded: Math.min(amount, units.length) });
        return;
      }
      currentOwner = nextPlayerInOrder(state, currentOwner).matchPlayerId;
    }
  },

  // Zasadzka Banitów — v3: tylko Wieża/Kopalnia/Koszary (Warownia jest chroniona jak przy
  // zwykłych atakach; "chyba że efekt karty stanowi inaczej" tu nie ma zastosowania). Bez filtru
  // typu "unit" kandydatami byłyby też same karty infrastruktury (currentHp=0), więc zawsze
  // wygrywałyby porównanie najniższego HP zamiast realnej, słabej jednostki.
  destroyLowestHpEnemyInInfrastructure: ({ state, catalog, actionParams }) => {
    const targetPlayerId = String(actionParams?.targetPlayerId ?? "");
    const infraZones: CardInstance["zone"][] = ["tower", "mine", "barracks"];
    const candidates = Object.values(state.cards).filter(
      (c) => c.ownerMatchPlayerId === targetPlayerId && infraZones.includes(c.zone) && catalog.get(c.definitionId)?.type === "unit",
    );
    if (candidates.length === 0) return;
    const lowest = candidates.reduce((min, c) => (c.currentHp < min.currentHp ? c : min));
    moveToDiscard(state, catalog, lowest);
  },

  // Utknięcie w Grzęzawisku
  skipNextOwnTurn: ({ state, ownerMatchPlayerId }) => {
    getPlayer(state, ownerMatchPlayerId).turnsToSkip += 1;
  },

  // Wędrowna Trupa Artystyczna
  skipTwoTurnsUntargetableThenCoins: ({ state, ownerMatchPlayerId, params }) => {
    const player = getPlayer(state, ownerMatchPlayerId);
    player.turnsToSkip += Number(params?.skipTurns ?? 2);
    player.untargetableTurnsRemaining += Number(params?.skipTurns ?? 2);
    player.scheduledTurnEffects.push({
      id: nanoid(),
      effectKey: "grantCoins",
      params: { amount: Number(params?.coinsAfter ?? 3) },
      turnsUntil: 0,
    });
  },

  // Zamieszanie
  relocateOwnUnitThenDiscard: ({ state, ownerMatchPlayerId, actionParams }) => {
    const cardId = String(actionParams?.cardInstanceId ?? "");
    const targetSlot = Number(actionParams?.targetSlotIndex);
    const card = state.cards[cardId];
    if (!card || card.ownerMatchPlayerId !== ownerMatchPlayerId || card.zone !== "play_area") {
      throw new GameRuleError("Nieprawidłowa jednostka do przeniesienia.", "INVALID_RELOCATE_TARGET");
    }
    const occupied = cardsInZone(state, ownerMatchPlayerId, "play_area").some(
      (c) => c.slotIndex === targetSlot && c.instanceId !== card.instanceId,
    );
    if (occupied) throw new GameRuleError("Docelowe miejsce jest zajęte.", "SLOT_OCCUPIED");
    card.slotIndex = targetSlot;
  },

  // Goranowe Szczęście
  forceNextPlayerDrawEventWithConsequence: ({ state, catalog, ownerMatchPlayerId, params, emit }) => {
    const forced = nextPlayerInOrder(state, ownerMatchPlayerId);
    const deck = cardsInZone(state, "shared", "event_deck").sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
    if (deck.length === 0) return;
    const drawnCard = deck[0];
    const definition = catalog.get(drawnCard.definitionId);
    if (!definition || definition.type !== "event") return;

    drawnCard.ownerMatchPlayerId = forced.matchPlayerId;
    if (definition.timing === "held_one_shot") {
      moveToHand(drawnCard);
    } else {
      resolveEffect(definition.effectKey, {
        state,
        catalog,
        sourceCard: drawnCard,
        ownerMatchPlayerId: forced.matchPlayerId,
        params: definition.params,
        emit,
      });
      drawnCard.zone = "event_discard";
      drawnCard.slotIndex = null;
    }

    if (definition.polarity === "positive") {
      getPlayer(state, ownerMatchPlayerId).coins += Number(params?.rewardIfBeneficial ?? 8);
    } else if (definition.polarity === "negative") {
      forced.turnsToSkip += 1;
    }
    emit("GORANOWE_SZCZESCIE_RESOLVED", { forcedMatchPlayerId: forced.matchPlayerId, cardId: drawnCard.definitionId });
  },

  // Munmaa (karta Wydarzenia) — tworzy nowy egzemplarz unikalnej jednostki Munmaa bezpośrednio na ręce.
  grantSpecificUnitToHand: ({ state, ownerMatchPlayerId, params }) => {
    const unitDefinitionId = String(params?.unitDefinitionId ?? "");
    const card: CardInstance = {
      instanceId: nanoid(),
      definitionId: unitDefinitionId,
      ownerMatchPlayerId,
      zone: "hand",
      slotIndex: null,
      currentHp: 0,
      currentAtk: 0,
      status: {},
    };
    state.cards[card.instanceId] = card;
  },

  // Natchnienie (Abzugud, on_play) — v3: jednorazowy zryw dla jednostek AKTUALNIE w grze, nie trwała aura.
  buffUnitsCurrentlyInPlayAtkOnce: ({ state, catalog, ownerMatchPlayerId, params }) => {
    const amount = Number(params?.amount ?? 1);
    for (const unit of battlefieldUnitsOf(state, catalog, ownerMatchPlayerId)) {
      unit.currentAtk += amount;
    }
  },

  // Siostrzana Przysięga (Amazonka x2, on_turn_start) — podejrzyj wierzch talii startowej,
  // zagraj/dobierz najlepszą kartę, resztę rozdziel między odrzucone i spód talii.
  // Uproszczenie: nasz silnik nie ma interaktywnego "podejrzyj i wybierz" dla gracza — użyto tej
  // samej heurystyki wartości co w cards.py priority_score (uproszczonej, bez bonusów per-zdolność).
  amazonSisterlyOath: ({ state, catalog, ownerMatchPlayerId, params }) => {
    const requiredCount = Number(params?.requiredCount ?? 2);
    const amazonCount = battlefieldUnitsOf(state, catalog, ownerMatchPlayerId).filter(
      (u) => getUnitDefinition(catalog, u.definitionId).name === "Amazonka",
    ).length;
    if (amazonCount < requiredCount) return;

    const deck = cardsInZone(state, ownerMatchPlayerId, "starting_deck").sort(
      (a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0),
    );
    if (deck.length === 0) return;
    const peeked = deck.slice(0, 3);
    const scored = peeked
      .map((c) => ({ card: c, value: unitValueHeuristic(getUnitDefinition(catalog, c.definitionId)) }))
      .sort((a, b) => b.value - a.value);

    const best = scored[0].card;
    const freeSlot = findFreeSlotIndex(state, ownerMatchPlayerId);
    if (freeSlot !== null) {
      placeUnitBaseStats(state, catalog, best, freeSlot);
    } else {
      moveToHand(best);
    }

    const rest = scored.slice(1).map((s) => s.card);
    if (rest[0]) moveToDiscard(state, catalog, rest[0]);
    if (rest[1]) {
      const maxIndex = cardsInZone(state, ownerMatchPlayerId, "starting_deck").reduce(
        (max, c) => Math.max(max, c.slotIndex ?? 0),
        -1,
      );
      rest[1].zone = "starting_deck";
      rest[1].slotIndex = maxIndex + 1;
    }
  },

  // Katapulta (Krasnolud, activated) — trwałe, opcjonalne połączenie dwóch Krasnoludów w obszarze
  // gry w jedną kartę Katapulty (4 HP / 6 ATK / lądowe i powietrzne). Partner jest odrzucany jako
  // pełna karta; ta karta zamienia definitionId na Katapultę (zob. zones.ts moveToDiscard —
  // przy jej ewentualnym późniejszym odrzuceniu wraca jako 2 karty Krasnoluda).
  mergeIntoKatapulta: ({ state, catalog, sourceCard, ownerMatchPlayerId, actionParams, emit }) => {
    const partnerId = String(actionParams?.partnerInstanceId ?? "");
    const partner = state.cards[partnerId];
    if (!partner || partner.ownerMatchPlayerId !== ownerMatchPlayerId || partner.zone !== "play_area" || partner.instanceId === sourceCard.instanceId) {
      throw new GameRuleError("Nieprawidłowy partner do połączenia.", "INVALID_MERGE_PARTNER");
    }
    const partnerDef = getUnitDefinition(catalog, partner.definitionId);
    const sourceDef = getUnitDefinition(catalog, sourceCard.definitionId);
    if (partnerDef.name !== "Krasnolud" || sourceDef.name !== "Krasnolud") {
      throw new GameRuleError("Do połączenia potrzeba dwóch Krasnoludów.", "INVALID_MERGE_PARTNER");
    }
    const katapultaDef = getUnitDefinition(catalog, "unit-katapulta");
    moveToDiscard(state, catalog, partner);
    sourceCard.definitionId = "unit-katapulta";
    sourceCard.currentHp = katapultaDef.hp;
    sourceCard.currentAtk = katapultaDef.atk;
    sourceCard.status.isKrasnoludMerge = true;
    emit("KRASNOLUD_MERGED_INTO_KATAPULTA", { cardInstanceId: sourceCard.instanceId, discardedPartnerId: partner.instanceId });
  },
};

export function resolveEffect(effectKey: string, ctx: EffectContext): void {
  const fn = EFFECT_REGISTRY[effectKey];
  if (!fn) {
    throw new Error(
      `Effect "${effectKey}" nie jest zaimplementowany w EFFECT_REGISTRY (apps/server/src/engine/effect-resolver.ts).`,
    );
  }
  fn(ctx);
}

export function isEffectImplemented(effectKey: string): boolean {
  return effectKey in EFFECT_REGISTRY;
}
