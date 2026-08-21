import type { EventCardDefinition, UnitCardDefinition } from "../types/card.js";

/**
 * Talia Wydarzeń (wspólna) — v4 (zob. `cards (1) 2.py` / `simulator_v3 (1) 2.py` / The-Five-Crowns-
 * Kompendium-Gracza.pdf dostarczone przez użytkownika). Zmiany względem poprzedniej wersji tego
 * pliku udokumentowane przy każdej karcie.
 *  - Koszt KAŻDEJ karty Wydarzenia jest jednolity (EVENT_COST=3).
 *  - "Munmaa" nie jest jednostką umieszczoną bezpośrednio w talii Wydarzeń — to karta Wydarzenia,
 *    której natychmiastowy efekt dodaje jednostkę Munmaa do ręki (zob. Munmaa poniżej).
 */
const EVENT_COST = 3;

export const EVENT_CARD_DEFINITIONS: EventCardDefinition[] = [
  {
    id: "event-cearta",
    type: "event",
    // v4: przemianowana z "Płatnerz" na "Cearta" (efekt bez zmian).
    name: "Cearta",
    cost: EVENT_COST,
    timing: "permanent",
    effectKey: "permanentAuraHpAllOwnUnits",
    params: { amount: 1 },
    description: "Do końca rozgrywki wszystkie jednostki w Twoim obszarze gry otrzymują +1 HP.",
    deckCount: 1,
    polarity: "positive",
  },
  {
    id: "event-trening-z-grafeldrem",
    type: "event",
    // v4: przemianowana z "Trening z Wojownikiem Srebrnych Głów"; deckCount 3→7; wybór zdolności
    // zmieniony z [Uzdrowienie/Zręczność/Inicjatywa/Szarża] na [Szał Bitewny/Zręczność/Znawca
    // Ścieżek/Szarża] (zob. PDF sekcja 8 i effect-resolver.ts grantOneShotAbilityToUnit).
    name: "Trening z Gráfeldr'em",
    cost: EVENT_COST,
    timing: "held_one_shot",
    effectKey: "grantOneShotAbilityToUnit",
    params: { choices: ["szal_bitewny", "zrecznosc", "znawca_sciezek", "szarza"] },
    description:
      "W najbliższej swojej turze wybierz jedną jednostkę w swoim obszarze gry. Może jednorazowo wykorzystać jedną z umiejętności: Szał Bitewny, Zręczność, Znawca Ścieżek lub Szarża.",
    deckCount: 7,
    polarity: "positive",
  },
  {
    id: "event-wizyta-bohatera-srebrnych-glow",
    type: "event",
    // v4: przemianowana z "Wizyta Generała Szarych Płaszczy"; deckCount 4→2; timing "instant"→
    // "held_one_shot" (trzymana na ręce, zagrywana jednorazowo w wybranej turze — zob. PDF sekcja 8:
    // "trzymane | Gdy zagrywasz tę kartę: ATK wszystkich Twoich jednostek zostaje podwojony w tej turze").
    name: "Wizyta Bohatera Srebrnych Głów",
    cost: EVENT_COST,
    timing: "held_one_shot",
    effectKey: "doubleAtkAllOwnUnitsThisTurn",
    description: "Zachowaj tę kartę na ręce. Gdy ją zagrasz, do końca tej tury wartość ATK wszystkich Twoich jednostek w obszarze gry zostaje podwojona.",
    deckCount: 2,
    polarity: "positive",
  },
  {
    id: "event-kopalnia-goblinow",
    type: "event",
    name: "Kopalnia Goblinów",
    cost: EVENT_COST,
    timing: "permanent",
    effectKey: "grantPermanentCoinProducer",
    // v3: kwota 2→3.
    params: { amount: 3, requiresUnit: false },
    description:
      "Umieść przed sobą Kopalnię Goblinów. Pozostaje w grze do końca rozgrywki. Na początku każdej swojej tury otrzymujesz 3 monety. Nie wymaga umieszczania jednostki.",
    deckCount: 2,
    polarity: "positive",
  },
  {
    id: "event-warownia",
    type: "event",
    name: "Warownia",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "grantInfrastructureCard",
    params: { kind: "stronghold" },
    description: "Po zakupie otrzymujesz kartę Warowni.",
    deckCount: 1,
    polarity: "positive",
  },
  {
    id: "event-koszary",
    type: "event",
    name: "Koszary",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "grantInfrastructureCard",
    params: { kind: "barracks" },
    description: "Po zakupie otrzymujesz kartę Koszar.",
    deckCount: 1,
    polarity: "positive",
  },
  {
    id: "event-kopalnia",
    type: "event",
    name: "Kopalnia",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "grantInfrastructureCard",
    params: { kind: "mine" },
    description: "Po zakupie otrzymujesz kartę Kopalni.",
    deckCount: 1,
    polarity: "positive",
  },
  {
    id: "event-sekrety-hrabiny",
    type: "event",
    name: "Sekrety Hrabiny",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "collectCoinFromEachOpponentOrSkipTurn",
    // v3: kwota 1→2.
    params: { amount: 2 },
    description:
      "Każdy z pozostałych graczy musi natychmiast zapłacić Ci 2 monety. Gracz, który nie może tego zrobić, pomija swoją następną turę.",
    // v4: deckCount 3→6.
    deckCount: 6,
    polarity: "positive",
  },
  {
    id: "event-sprzyjajaca-pogoda",
    type: "event",
    name: "Sprzyjająca Pogoda",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "healAllKingdoms",
    // v3: kwota 1→3.
    params: { amount: 3 },
    description: "Każdy gracz przywraca swojemu Królestwu 3 HP.",
    deckCount: 2,
    polarity: "positive",
  },
  {
    id: "event-zachodni-wiatr",
    type: "event",
    name: "Zachodni Wiatr",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "skipNextPlayerTurn",
    description: "Następny gracz po Twojej lewej pomija swoją następną turę.",
    // v4: deckCount 3→5.
    deckCount: 5,
    polarity: "positive",
  },
  {
    id: "event-mixtli",
    type: "event",
    // v4: przemianowana z "Mgła" na "Mixtli" (efekt bez zmian).
    name: "Mixtli",
    cost: EVENT_COST,
    timing: "held_one_shot",
    effectKey: "untargetableSelfThisTurn",
    description:
      "Zachowaj tę kartę na ręce. Na początku jednej ze swoich tur możesz ją zagrać. Twoje Królestwo oraz wszystkie Twoje jednostki nie mogą być celem ataków AŻ DO nadejścia Twojej następnej tury (chroni przez pełną kolejkę przeciwników, nie tylko do końca bieżącej tury).",
    deckCount: 4,
    polarity: "positive",
  },
  {
    id: "event-dlugie-zacmienie-slonca",
    type: "event",
    name: "Długie Zaćmienie Słońca",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "damageAllKingdoms",
    // v3: kwota 2→5.
    params: { amount: 5 },
    description: "Wszystkie Królestwa tracą 5 HP.",
    deckCount: 1,
    polarity: "negative",
  },
  {
    id: "event-spotkanie-przyjaznego-trolla",
    type: "event",
    name: "Spotkanie Przyjaznego Trolla",
    cost: EVENT_COST,
    timing: "held_one_shot",
    effectKey: "doubleMineProductionNextTurn",
    // v3: podwojenie→POTROJENIE (zob. cards.py "triple_mine_next_turn", kod mnoży x3).
    params: { multiplier: 3 },
    description: "W najbliższej swojej turze produkcja monet ze wszystkich Twoich Kopalni zostaje POTROJONA.",
    deckCount: 4,
    polarity: "positive",
  },
  {
    id: "event-spotkanie-alchemika",
    type: "event",
    name: "Spotkanie Alchemika",
    cost: EVENT_COST,
    timing: "held_one_shot",
    effectKey: "drawAndPlayUnitWithBonusHp",
    // v3: bonus HP 3→4.
    params: { hpBonus: 4 },
    description:
      "Zachowaj tę kartę na ręce. W wybranej przez siebie turze możesz ją zagrać. Dobierz 1 kartę ze swojej talii i natychmiast zagraj ją do obszaru gry. Dopóki pozostaje w grze, otrzymuje +4 HP.",
    deckCount: 2,
    polarity: "positive",
  },
  {
    id: "event-przysluga-dla-ksiecia",
    type: "event",
    name: "Przysługa dla Księcia",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "skipTurnThenFreeUnitDraw",
    // v4: pominięta tura jest też NIETYKALNA (zob. effect-resolver.ts skipTurnThenFreeUnitDraw).
    description:
      "Pomiń swoją następną turę (podczas niej jesteś nietykalny). Na początku kolejnej dobierz wierzchnią kartę ze swojej Talii Królestwa i dodaj ją na rękę, nie ponosząc kosztu jej zakupu.",
    deckCount: 5,
    polarity: "negative",
  },
  {
    id: "event-zarazliwa-plaga",
    type: "event",
    name: "Zaraźliwa Plaga",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "discardOwnUnitsOrPassEffect",
    params: { amount: 2 },
    description:
      "Odrzuć 2 jednostki ze swojego obszaru gry. Jeżeli nie posiadasz żadnej jednostki, efekt tej karty przechodzi na następnego gracza zgodnie z kolejnością tur.",
    // v4: deckCount 3→5.
    deckCount: 5,
    polarity: "negative",
  },
  {
    id: "event-munmaa",
    type: "event",
    name: "Munmaa",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "grantSpecificUnitToHand",
    params: { unitDefinitionId: "event-unit-munmaa" },
    description: "Dodaje unikalną jednostkę Munmaa bezpośrednio do Twojej ręki.",
    deckCount: 1,
    polarity: "positive",
  },
  {
    id: "event-zasadzka-banitow",
    type: "event",
    name: "Zasadzka Banitów",
    cost: EVENT_COST,
    timing: "held_one_shot",
    effectKey: "destroyLowestHpEnemyInInfrastructure",
    params: { returnToBottomOfEventDeck: true },
    description:
      "Zachowaj tę kartę na ręce. W dowolnej swojej turze możesz ją zagrać. Wybierz jednostkę przeciwnika znajdującą się w infrastrukturze o najniższym HP i zniszcz ją, ignorując jej HP. Zniszczona jednostka trafia na stos kart odrzuconych swojego właściciela, a karta wraca pod spód Talii Wydarzeń.",
    deckCount: 6,
    polarity: "positive",
  },
  {
    id: "event-utkniecie-w-grzezawisku",
    type: "event",
    name: "Utknięcie w Grzęzawisku",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "skipNextOwnTurn",
    description: "Pomiń swoją następną turę.",
    deckCount: 3,
    polarity: "negative",
  },
  {
    id: "event-wedrowna-trupa-artystyczna",
    type: "event",
    name: "Wędrowna Trupa Artystyczna",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "skipTwoTurnsUntargetableThenCoins",
    // v3: nagroda po pominięciu 3→6.
    params: { skipTurns: 2, coinsAfter: 6 },
    description:
      "Pomiń swoje dwie następne tury. W tym czasie Twoje Królestwo oraz jednostki nie mogą być celem ataków. Na początku swojej trzeciej tury otrzymujesz 6 monet.",
    deckCount: 1,
    polarity: "mixed",
  },
  {
    id: "event-zamieszanie",
    type: "event",
    name: "Zamieszanie",
    cost: EVENT_COST,
    timing: "held_one_shot",
    effectKey: "relocateOwnUnitThenDiscard",
    // v4: zawsze konsumowana po jednej próbie i wraca pod SPÓD Talii Wydarzeń (nie na odrzucone) —
    // zob. simulator_v3 (1) 2.py: `active.event_deck_ref.insert(0, ev)`, oraz identyczny mechanizm
    // `returnToBottomOfEventDeck` już użyty przez Zasadzkę Banitów (reducer.ts PLAY_EVENT_FROM_HAND).
    params: { returnToBottomOfEventDeck: true },
    description:
      "Zachowaj tę kartę na ręce. W dowolnej swojej turze możesz przemieścić jedną jednostkę na dowolne wolne miejsce w swoim obszarze gry. Karta wraca pod spód Talii Wydarzeń.",
    // v4: deckCount 8→5.
    deckCount: 5,
    polarity: "positive",
  },
  {
    id: "event-goranowe-szczescie",
    type: "event",
    name: "Goranowe Szczęście",
    cost: EVENT_COST,
    timing: "instant",
    effectKey: "forceNextPlayerDrawEventWithConsequence",
    // v3: nagroda 8→10.
    params: { rewardIfBeneficial: 10 },
    description:
      "Następny gracz zgodnie z ruchem wskazówek zegara dobiera kartę Wydarzenia bez ponoszenia kosztu i natychmiast rozpatruje jej efekt. Jeżeli efekt tej karty jest dla niego korzystny, otrzymujesz 10 monet. Jeżeli efekt tej karty jest dla niego niekorzystny, pomija swoją następną turę i może być celem ataków innych graczy.",
    deckCount: 2,
    polarity: "mixed",
  },
];

/**
 * Munmaa to unikalna jednostka NIEOBECNA w żadnej talii królestwa — zdobywana wyłącznie przez
 * zagranie karty Wydarzenia "Munmaa" (zob. wyżej, effectKey "grantSpecificUnitToHand"), która
 * tworzy nowy egzemplarz tej jednostki bezpośrednio na ręce gracza. Definicja żyje tutaj (nie w
 * talii Wydarzeń jako osobna karta w `event_deck`) wyłącznie jako wpis w katalogu kart, do
 * którego odwołuje się `grantSpecificUnitToHand`.
 */
export const EVENT_DECK_UNIT_DEFINITIONS: UnitCardDefinition[] = [
  {
    id: "event-unit-munmaa",
    type: "unit",
    kingdomId: "event", // sentinel: karta nie należy do puli żadnego królestwa
    name: "Munmaa",
    cost: 1,
    hp: 3,
    atk: 2,
    canTarget: "land_and_air",
    // v4: TARGET_CATEGORY w cards.py mówi "land" (Munmaa sama jako cel jest wyłącznie lądowa).
    targetCategory: "land",
    infrastructureForbidden: false,
    abilities: [
      {
        key: "inicjatywa",
        trigger: "on_play",
        effectKey: "buffSelfAtkNextAttack",
        params: { amount: 2 },
        description: "Po ustawieniu w obszarze gry pierwszy atak tej jednostki otrzymuje +2 ATK.",
      },
      {
        // NOWA zdolność (v4) — Munmaa zyskuje Wzmocnienie (ta sama żywa, ciągła aura HP co
        // Faun/Druid/Feniks/Mag/Elf Świetlisty, zob. cards.py "buff_hp_1").
        key: "wzmocnienie",
        trigger: "passive_aura",
        effectKey: "wzmocnienieAura",
        params: { amount: 1 },
        description: "Dopóki ta jednostka pozostaje w obszarze gry, wszystkie INNE Twoje jednostki otrzymują +1 HP.",
      },
      {
        // NOWA zdolność (v4) — Przywołanie: gdy Munmaa zostanie odrzucona (z jakiegokolwiek
        // powodu), odzyskaj jedną losową kartę ze stosu odrzuconych do ręki, następnie odrzuć
        // najsłabszą kartę z ręki (zob. simulator_v3 (1) 2.py try_munmaa_summon).
        key: "munmaa_summon",
        trigger: "on_death",
        effectKey: "recycleRandomFromDiscardOnOwnDeath",
        params: {},
        description:
          "Po odrzuceniu tej jednostki odzyskaj jedną losową kartę ze stosu odrzuconych do ręki, następnie odrzuć najsłabszą kartę z ręki.",
      },
      {
        // Nieobecne w cards.py (silnik symulacyjny nie modeluje pozycji na planszy — zob.
        // uproszczenie "Zamieszanie" tamże), ale jest to jawna zdolność z instrukcji źródłowej;
        // zachowana tutaj, bo nasz silnik śledzi realne pozycje slotów.
        key: "harmonia",
        trigger: "activated",
        effectKey: "swapTwoOwnUnitsOncePerTurn",
        params: {},
        description: "Raz na turę możesz zamienić miejscami dwie dowolne jednostki w swoim obszarze gry.",
      },
    ],
  },
];
