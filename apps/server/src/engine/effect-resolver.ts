import { nanoid } from "nanoid";
import type { CardInstance, GameState, Zone } from "@dudacastle/shared";
import { BATTLEFIELD_ZONES } from "@dudacastle/shared";
import type { CardCatalog } from "./catalog.js";
import { getUnitDefinition } from "./catalog.js";
import { drawFromStartingDeck } from "./deck-utils.js";
import { GameRuleError } from "./errors.js";
import { cardsInZone, getPlayer } from "./selectors.js";
import { drawAndPlaceFromStartingDeck, placeUnitBaseStats } from "./unit-lifecycle.js";
import { findFreeSlotIndex, moveToDiscard, moveToHand, relocateUnitToZone } from "./zones.js";
// Import cykliczny z combat.ts (które importuje stąd `resolveEffect`) — bezpieczny, bo obie strony
// używają importowanych funkcji WYŁĄCZNIE wewnątrz ciał innych funkcji, nigdy na poziomie modułu.
import { destroyUnit } from "./combat.js";

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
    const player = getPlayer(state, ownerMatchPlayerId);
    player.kingdomHp = Math.min(player.kingdomHp + Number(params?.amount ?? 1), player.maxKingdomHp);
  },

  // Wzmocnienie (Faun, Druid, Feniks, Mag, Elf Świetlisty, Munmaa) — v4: to teraz ŻYWA, CIĄGŁA
  // aura (nie jednorazowa mutacja), przeliczana w auras.ts recomputeAuras. Ta zdolność ma
  // trigger "passive_aura" i effectKey "wzmocnienieAura" — nie ma osobnej funkcji w tym rejestrze,
  // bo nigdy nie jest wywoływana przez resolveEffect (auras.ts odczytuje jej params bezpośrednio).

  // Śpiew Natury (Faun + Elf Leśny, on_play obu kart) — v4: jednorazowy, samo-konsumujący się
  // zryw (nie trwała aura): gdy w obszarze gry są jednocześnie Faun i Elf Leśny, wszystkie
  // jednostki (wliczając ich) dostają +2 ATK do końca tej tury (jak Inicjatywa — tempAtkBonus,
  // konsumowane przy pierwszym ataku), po czym OBIE karty trafiają na stos odrzuconych.
  faunElfSongBurst: ({ state, catalog, ownerMatchPlayerId, emit }) => {
    const units = battlefieldUnitsOf(state, catalog, ownerMatchPlayerId);
    const byName = (name: string) => units.find((u) => getUnitDefinition(catalog, u.definitionId).name === name);
    const faun = byName("Faun");
    const elfLesny = byName("Elf Leśny");
    if (!faun || !elfLesny) return;
    for (const unit of units) {
      unit.status.tempAtkBonus = (unit.status.tempAtkBonus ?? 0) + 2;
    }
    destroyUnit(state, catalog, faun, emit);
    destroyUnit(state, catalog, elfLesny, emit);
    emit("FAUN_ELF_SONG_TRIGGERED", { matchPlayerId: ownerMatchPlayerId });
  },

  // Inicjatywa (Elf Leśny, Gryf, Czarodziej, Elf Mroczny, Elf Świetlisty, Munmaa...) — konsumowane przy pierwszym ataku.
  buffSelfAtkNextAttack: ({ sourceCard, params }) => {
    sourceCard.status.tempAtkBonus = (sourceCard.status.tempAtkBonus ?? 0) + Number(params?.amount ?? 2);
  },

  // Szał Bitewny (Ork, on_death) — zabija atakującego (przy ataku łączonym: tego o niższym HP).
  retaliateKillAttacker: ({ state, catalog, emit, actionParams }) => {
    const attackerIds = (actionParams?.attackerInstanceIds as string[] | undefined) ?? [];
    const attackers = attackerIds.map((id) => state.cards[id]).filter((c): c is CardInstance => !!c);
    if (attackers.length === 0) return;
    const target = attackers.reduce((lowest, c) => (c.currentHp < lowest.currentHp ? c : lowest));
    // destroyUnit (nie moveToDiscard) — jednostka zabita retaliacją wciąż powinna odpalić swoje
    // on_death (np. Przywołanie Emisariusza, gdyby dwóch zginęło tą drogą w tej samej turze).
    destroyUnit(state, catalog, target, emit, { destroyedByOpponent: true });
  },

  // Szarża (Elf Mroczny, Minotaur, Centaur — on_enemy_destroyed): drugi atak natychmiast, potem odrzucona.
  // Rozpatrywane strukturalnie w reducer.ts (ATTACK) — tu tylko ustawiamy flagę udostępniającą dodatkowy atak.
  extraAttackThenDiscard: ({ sourceCard }) => {
    sourceCard.status.hasAttacked = false;
  },

  // Powstanie z popiołów (Feniks, on_death, tylko gdy odrzucony przez przeciwnika)
  replaceWithNextStartingDeckCardOnEnemyDiscard: ({ state, catalog, ownerMatchPlayerId, actionParams }) => {
    if (!actionParams?.destroyedByOpponent) return;
    // Uwaga: NIE sprawdzać sourceCard.slotIndex tutaj — destroyUnit() wywołuje moveToDiscard PRZED
    // odpaleniem on_death, więc slotIndex Feniksa jest już `null` w tym momencie (dawny warunek
    // "if (slotIndex === null) return" był martwy i zawsze przerywał efekt). drawAndPlaceFromStartingDeck
    // i tak sam znajduje wolne miejsce przez findFreeSlotIndex, więc ten odczyt nie był w ogóle potrzebny.
    drawAndPlaceFromStartingDeck(state, catalog, ownerMatchPlayerId, 0);
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

  // Harpii Zryw / Galop (activated) — przenosi tę jednostkę do dowolnej posiadanej strefy
  // (play_area albo Wieża/Kopalnia/Koszary/Warownia) — zob. simulator_v3.py try_reposition_unit,
  // które pozwala na dokładnie to samo (nie tylko przesunięcie w obrębie play_area).
  relocateSelf: ({ state, catalog, sourceCard, ownerMatchPlayerId, actionParams }) => {
    const targetZone = (actionParams?.targetZone as Zone | undefined) ?? "play_area";
    relocateUnitToZone(state, catalog, sourceCard, ownerMatchPlayerId, targetZone);
    sourceCard.status.activatedAbilityUsedThisTurn = true;
  },

  // Powietrzny Transport (Pegaz, activated) — przenosi INNĄ sojuszniczą jednostkę do dowolnej
  // posiadanej strefy (zob. simulator_v3.py try_pegaz_transport — Wieża dla każdej jednostki,
  // Kopalnia/Warownia/Koszary tylko jeśli nie infrastructureForbidden, weryfikowane w relocateUnitToZone).
  relocateAllyOncePerTurn: ({ state, catalog, sourceCard, ownerMatchPlayerId, actionParams }) => {
    const targetId = String(actionParams?.targetInstanceId ?? "");
    const targetZone = (actionParams?.targetZone as Zone | undefined) ?? "play_area";
    const ally = state.cards[targetId];
    if (
      !ally ||
      ally.instanceId === sourceCard.instanceId ||
      ally.ownerMatchPlayerId !== ownerMatchPlayerId ||
      !BATTLEFIELD_ZONES.includes(ally.zone) ||
      ally.zone === "stronghold"
    ) {
      throw new GameRuleError("Nieprawidłowa sojusznicza jednostka do przeniesienia.", "INVALID_ALLY_TARGET");
    }
    relocateUnitToZone(state, catalog, ally, ownerMatchPlayerId, targetZone);
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
    // v4: Trening z Gráfeldr'em zastępuje Trening z Wojownikiem Srebrnych Głów, z nowym zestawem
    // wyborów (Szał Bitewny / Zręczność / Znawca Ścieżek / Szarża — Uzdrowienie usunięte). Szał
    // Bitewny i Znawca Ścieżek nie mają natychmiastowego efektu do rozpatrzenia — to zdolności
    // reaktywne/pasywne, więc zamiast resolveEffect ustawiamy jednorazową flagę konsumowaną przy
    // najbliższej okazji (śmierć celu / najbliższy zakup) — zob. combat.ts destroyUnit i reducer.ts.
    if (chosen === "szal_bitewny") {
      target.status.oneShotSzalBitewnyPending = true;
      return;
    }
    if (chosen === "znawca_sciezek") {
      getPlayer(state, ownerMatchPlayerId).oneShotPathExpertPending = true;
      return;
    }
    const oneShotEffects: Record<string, { effectKey: string; params?: Record<string, unknown> }> = {
      zrecznosc: { effectKey: "drawFromStartingDeck", params: { count: 1 } },
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
    for (const player of state.players) {
      if (!player.eliminated) player.kingdomHp = Math.min(player.kingdomHp + amount, player.maxKingdomHp);
    }
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

  // Przysługa dla Księcia — v4: pominięta tura jest też NIETYKALNA (PDF: "Pomiń następną turę
  // (nietykalny), potem dobierz darmową kartę z Talii Królestwa").
  skipTurnThenFreeUnitDraw: ({ state, ownerMatchPlayerId }) => {
    const player = getPlayer(state, ownerMatchPlayerId);
    player.turnsToSkip += 1;
    player.untargetableTurnsRemaining = Math.max(player.untargetableTurnsRemaining, 1);
    player.scheduledTurnEffects.push({ id: nanoid(), effectKey: "freeKingdomDeckDraw", turnsUntil: 0 });
  },

  // Zaraźliwa Plaga
  discardOwnUnitsOrPassEffect: ({ state, catalog, ownerMatchPlayerId, params, emit }) => {
    const amount = Number(params?.amount ?? 2);
    let currentOwner = ownerMatchPlayerId;
    for (let hop = 0; hop < state.players.length; hop++) {
      const units = battlefieldUnitsOf(state, catalog, currentOwner);
      if (units.length > 0) {
        // destroyUnit, nie moveToDiscard — inne on_death (np. Przywołanie Emisariusza) muszą
        // zadziałać nawet przy wymuszonym odrzuceniu własnych jednostek (Feniks NIE odradza się
        // tutaj — to nie zniszczenie "przez przeciwnika", zgodnie z opisem jego karty).
        units.slice(0, amount).forEach((u) => destroyUnit(state, catalog, u, emit));
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
  destroyLowestHpEnemyInInfrastructure: ({ state, catalog, emit, actionParams }) => {
    const targetPlayerId = String(actionParams?.targetPlayerId ?? "");
    const infraZones: CardInstance["zone"][] = ["tower", "mine", "barracks"];
    const candidates = Object.values(state.cards).filter(
      (c) => c.ownerMatchPlayerId === targetPlayerId && infraZones.includes(c.zone) && catalog.get(c.definitionId)?.type === "unit",
    );
    if (candidates.length === 0) return;
    const lowest = candidates.reduce((min, c) => (c.currentHp < min.currentHp ? c : min));
    // Musi iść przez destroyUnit (nie moveToDiscard bezpośrednio), inaczej on_death celu
    // (Powstanie z Popiołów Feniksa, Przywołanie Emisariusza...) po cichu się nie uruchomi.
    destroyUnit(state, catalog, lowest, emit, { destroyedByOpponent: true });
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
  // Zamieszanie — przenosi WŁASNĄ jednostkę z dowolnej strefy obszaru gry (play_area/Wieża/
  // Kopalnia/Koszary) do dowolnej innej posiadanej strefy, zob. simulator_v3.py try_zamieszanie
  // (przenosi też np. z Kopalni na planszę albo z planszy do Kopalni, nie tylko w obrębie play_area).
  relocateOwnUnitThenDiscard: ({ state, catalog, ownerMatchPlayerId, actionParams }) => {
    const cardId = String(actionParams?.cardInstanceId ?? "");
    const targetZone = (actionParams?.targetZone as Zone | undefined) ?? "play_area";
    const card = state.cards[cardId];
    if (!card || card.ownerMatchPlayerId !== ownerMatchPlayerId || !BATTLEFIELD_ZONES.includes(card.zone) || card.zone === "stronghold") {
      throw new GameRuleError("Nieprawidłowa jednostka do przeniesienia.", "INVALID_RELOCATE_TARGET");
    }
    relocateUnitToZone(state, catalog, card, ownerMatchPlayerId, targetZone);
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

  // Natchnienie (Abzugud, Czarodziej) — v4: to teraz ŻYWA, CIĄGŁA aura (nie jednorazowy zryw),
  // trigger "passive_aura" / effectKey "auraAtkAllOwnUnits", przeliczana w auras.ts recomputeAuras.
  // Nie ma tu osobnej funkcji — nigdy nie jest wywoływana przez resolveEffect.

  // Siostrzana Przysięga (Amazonka, on_turn_start, v4: próg 1 sztuki) — podejrzyj wierzch talii
  // startowej, zagraj/dobierz najlepszą kartę, jedną odrzuć, jedną odłóż z powrotem na WIERZCH
  // talii (zob. simulator_v3 (1) 2.py amazon_sisterly_oath: `self.deck.append(c)`, gdzie draw()
  // dobiera przez `.pop()` z końca listy — "koniec listy" = wierzch talii).
  // Uproszczenie: nasz silnik nie ma interaktywnego "podejrzyj i wybierz" dla gracza — użyto tej
  // samej heurystyki wartości co w cards.py priority_score (uproszczonej, bez bonusów per-zdolność).
  amazonSisterlyOath: ({ state, catalog, ownerMatchPlayerId, params }) => {
    const requiredCount = Number(params?.requiredCount ?? 1);
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
      // Wraca na WIERZCH talii startowej (najbliższa do dobrania) — czyli najniższy slotIndex
      // spośród pozostałych kart w tej strefie, pomniejszony o 1.
      const remaining = cardsInZone(state, ownerMatchPlayerId, "starting_deck");
      const minIndex = remaining.reduce((min, c) => Math.min(min, c.slotIndex ?? 0), 0);
      rest[1].zone = "starting_deck";
      rest[1].slotIndex = minIndex - 1;
    }
  },

  // Katapulta (Krasnolud, activated) — trwałe, opcjonalne połączenie dwóch Krasnoludów w obszarze
  // gry w jedną kartę Katapulty (4 HP / 6 ATK / lądowe i powietrzne). Partner jest CAŁKOWICIE
  // USUWANY ze stanu gry (nie odrzucany jako osobna karta!) — PDF: "przy odrzuceniu [Katapulty]
  // wraca jako 2 osobne Krasnoludy" opisuje TYLKO odrzucenie GOTOWEJ Katapulty (zob. zones.ts
  // moveToDiscard), nie sam moment połączenia. Odrzucenie partnera TUTAJ (zamiast usunięcia)
  // podwajałoby liczbę kart w obiegu — 1 prawdziwa karta trafiałaby na odrzucone przy merge, a
  // POTEM przy ewentualnym odrzuceniu samej Katapulty moveToDiscard i tak odtwarza 2 nowe karty
  // Krasnoluda, tworząc fantomową 3. kartę znikąd (znalezione i naprawione przy izolowanym teście
  // tej samej logiki dla nowego Kolczana Prawilności).
  mergeIntoKatapulta: ({ state, catalog, sourceCard, ownerMatchPlayerId, actionParams, emit }) => {
    const partnerId = String(actionParams?.partnerInstanceId ?? "");
    const partner = state.cards[partnerId];
    // nowe-polecenia.pdf #6: dwa Krasnoludy łączą się w Katapultę niezależnie od tego, czy stoją
    // w zwykłych slotach czy w Wieży/Kopalni/Koszarach (Warownia wykluczona dla OBU stron — jej
    // jednostka jest nietykalna i ma osobny licznik działań, więc merge w trakcie tego okna byłby
    // niejednoznaczny; wcześniej ten zakaz obejmował tylko partnera, nie sourceCard).
    const eligibleMergeZones = ["play_area", "tower", "mine", "barracks"];
    if (
      !partner ||
      partner.ownerMatchPlayerId !== ownerMatchPlayerId ||
      partner.instanceId === sourceCard.instanceId ||
      !eligibleMergeZones.includes(partner.zone) ||
      !eligibleMergeZones.includes(sourceCard.zone)
    ) {
      throw new GameRuleError("Nieprawidłowy partner do połączenia.", "INVALID_MERGE_PARTNER");
    }
    const partnerDef = getUnitDefinition(catalog, partner.definitionId);
    const sourceDef = getUnitDefinition(catalog, sourceCard.definitionId);
    if (partnerDef.name !== "Krasnolud" || sourceDef.name !== "Krasnolud") {
      throw new GameRuleError("Do połączenia potrzeba dwóch Krasnoludów.", "INVALID_MERGE_PARTNER");
    }
    const katapultaDef = getUnitDefinition(catalog, "unit-katapulta");
    delete state.cards[partner.instanceId];
    sourceCard.definitionId = "unit-katapulta";
    // nowe-polecenia.pdf #6: jeśli sourceCard stoi w Wieży (permanentHpBonus) lub korzysta z aktywnej
    // aury (Płatnerz/Śpiew Natury -> auraHpBonus/auraAtkBonus), oba muszą przetrwać — nadpisanie
    // samą bazową wartością Katapulty by je zgubiło. recomputeAuras (wywoływane po każdej akcji)
    // liczy różnicowo względem JUŻ zapisanego auraHpBonus/auraAtkBonus, więc ten bonus trzeba
    // uwzględnić już tutaj, inaczej różnica wobec niezmienionego auraHpBonus wyszłaby na zero.
    sourceCard.currentHp = katapultaDef.hp + (sourceCard.status.permanentHpBonus ?? 0) + (sourceCard.status.auraHpBonus ?? 0);
    sourceCard.currentAtk = katapultaDef.atk + (sourceCard.status.permanentAtkBonus ?? 0) + (sourceCard.status.auraAtkBonus ?? 0);
    sourceCard.status.isKrasnoludMerge = true;
    emit("KRASNOLUD_MERGED_INTO_KATAPULTA", { cardInstanceId: sourceCard.instanceId, discardedPartnerId: partner.instanceId });
  },

  // Kolczan Prawilności (Doświadczony Łucznik, activated) — v4: analogiczne, trwałe, opcjonalne
  // połączenie dwóch Doświadczonych Łuczników w jedną kartę (2 HP / 2 ATK / lądowe i powietrzne),
  // zob. mergeIntoKatapulta powyżej (ta sama logika stref/aur, zob. też zones.ts moveToDiscard —
  // przy ewentualnym odrzuceniu wraca jako 2 karty Doświadczonego Łucznika).
  mergeIntoKolczan: ({ state, catalog, sourceCard, ownerMatchPlayerId, actionParams, emit }) => {
    const partnerId = String(actionParams?.partnerInstanceId ?? "");
    const partner = state.cards[partnerId];
    const eligibleMergeZones = ["play_area", "tower", "mine", "barracks"];
    if (
      !partner ||
      partner.ownerMatchPlayerId !== ownerMatchPlayerId ||
      partner.instanceId === sourceCard.instanceId ||
      !eligibleMergeZones.includes(partner.zone) ||
      !eligibleMergeZones.includes(sourceCard.zone)
    ) {
      throw new GameRuleError("Nieprawidłowy partner do połączenia.", "INVALID_MERGE_PARTNER");
    }
    const partnerDef = getUnitDefinition(catalog, partner.definitionId);
    const sourceDef = getUnitDefinition(catalog, sourceCard.definitionId);
    if (partnerDef.name !== "Doświadczony Łucznik" || sourceDef.name !== "Doświadczony Łucznik") {
      throw new GameRuleError("Do połączenia potrzeba dwóch Doświadczonych Łuczników.", "INVALID_MERGE_PARTNER");
    }
    const kolczanDef = getUnitDefinition(catalog, "unit-kolczan-prawilnosci");
    // Partner CAŁKOWICIE USUWANY (nie odrzucany) — zob. identyczne uzasadnienie w mergeIntoKatapulta.
    delete state.cards[partner.instanceId];
    sourceCard.definitionId = "unit-kolczan-prawilnosci";
    sourceCard.currentHp = kolczanDef.hp + (sourceCard.status.permanentHpBonus ?? 0) + (sourceCard.status.auraHpBonus ?? 0);
    sourceCard.currentAtk = kolczanDef.atk + (sourceCard.status.permanentAtkBonus ?? 0) + (sourceCard.status.auraAtkBonus ?? 0);
    sourceCard.status.isLucznikMerge = true;
    emit("LUCZNIK_MERGED_INTO_KOLCZAN", { cardInstanceId: sourceCard.instanceId, discardedPartnerId: partner.instanceId });
  },

  // Przywołanie (Munmaa, on_death) — v4: jeśli Munmaa zostanie odrzucona (z JAKIEGOKOLWIEK
  // powodu, bez wymogu pary), odzyskaj JEDNĄ LOSOWĄ kartę ze stosu odrzuconych do ręki, następnie
  // odrzuć najsłabszą kartę z ręki (zob. simulator_v3 (1) 2.py try_munmaa_summon).
  recycleRandomFromDiscardOnOwnDeath: ({ state, catalog, sourceCard, ownerMatchPlayerId }) => {
    const discard = cardsInZone(state, ownerMatchPlayerId, "discard").filter(
      (c) => c.instanceId !== sourceCard.instanceId,
    );
    if (discard.length === 0) return;
    const recovered = discard[Math.floor(Math.random() * discard.length)];
    moveToHand(recovered);
    // Ręka może zawierać też trzymane karty Wydarzeń (nie tylko jednostki) — unitValueHeuristic
    // wymaga definicji jednostki, więc licząc "najsłabszą" kartę bierzemy pod uwagę tylko
    // jednostki; jeśli ręka nie ma żadnej, odrzucamy dowolną (pierwszą), tak jak Przywołanie Emisariusza.
    const hand = cardsInZone(state, ownerMatchPlayerId, "hand");
    if (hand.length === 0) return;
    const handUnits = hand.filter((c) => catalog.get(c.definitionId)?.type === "unit");
    const worst =
      handUnits.length > 0
        ? handUnits.reduce((min, c) =>
            unitValueHeuristic(getUnitDefinition(catalog, c.definitionId)) < unitValueHeuristic(getUnitDefinition(catalog, min.definitionId)) ? c : min,
          )
        : hand[0];
    moveToDiscard(state, catalog, worst);
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
