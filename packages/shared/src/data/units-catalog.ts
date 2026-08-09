import type { Ability, TargetDomain } from "../types/card.js";

/**
 * Szablony jednostek — v3 (zob. cards.py / simulator_v3.py dostarczone przez użytkownika,
 * traktowane jako źródło prawdy nadrzędne względem oryginalnej instrukcja.pdf tam, gdzie się
 * różnią). Zmiany względem pierwotnej transkrypcji PDF udokumentowane przy każdej jednostce.
 *
 * DWA NIEZALEŻNE POLA KIERUNKOWE (to rozróżnienie było błędnie scalone w pierwszej wersji):
 * - `canTarget`: co ta jednostka MOŻE atakować (ofensywnie).
 * - `targetCategory`: czym ta jednostka JEST jako cel — kto może ją trafić (defensywnie).
 *   Wyprowadzone z broni na karcie fizycznej: miecz→land, skrzydła→air, miecz i skrzydła→both.
 *   Przykład: Gryf atakuje lądowe i powietrzne (`canTarget: both`), ale sam jest wyłącznie
 *   celem powietrznym (`targetCategory: air`) — ma tylko skrzydła, bez miecza.
 */
export interface UnitTemplate {
  name: string;
  hp: number;
  atk: number;
  canTarget: TargetDomain;
  targetCategory: TargetDomain;
  /** Zakaz Wieży/Kopalni/Warowni — zob. cards.py NON_HUMANOID (Koszary bez ograniczeń). */
  infrastructureForbidden: boolean;
  abilities: Ability[];
}

const LAND: TargetDomain = "land";
const AIR: TargetDomain = "air";
const BOTH: TargetDomain = "land_and_air";

export const UNIT_TEMPLATES: Record<string, UnitTemplate> = {
  Faun: {
    name: "Faun",
    hp: 1,
    atk: 0,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "zrecznosc",
        // v3: Zręczność to efekt REKURENCYJNY — dopóki jednostka żyje, KAŻDĄ własną turę
        // dobierasz +1 kartę (poprzednio błędnie jednorazowe, tylko przy zagraniu).
        trigger: "on_turn_start",
        effectKey: "drawFromStartingDeck",
        params: { count: 1 },
        description: "Na początku każdej swojej tury, dopóki ta jednostka żyje, dobierz 1 dodatkową kartę z talii startowej.",
      },
      {
        // Faun w cards.py ma WYŁĄCZNIE ["dexterity", "buff_hp_1"] — "uzdrowienie" z pierwotnej
        // transkrypcji PDF zostało usunięte w v3 (znalezione i naprawione w audycie Gemini).
        key: "wzmocnienie",
        trigger: "on_play",
        effectKey: "buffOwnUnitsHp",
        params: { amount: 1 },
        description: "Po wejściu do gry zwiększ HP jednostek w obszarze gry o +1 HP.",
      },
    ],
  },
  "Elf Leśny": {
    name: "Elf Leśny",
    hp: 3,
    atk: 3,
    canTarget: BOTH,
    targetCategory: LAND,
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
        key: "spiew_natury",
        trigger: "passive_aura",
        effectKey: "conditionalAuraHpIfUnitsPresent",
        params: { requiresUnitNames: ["Faun", "Elf Leśny"], amount: 1 },
        description: "Jeżeli w obszarze gry masz Fauna i Elfa Leśnego, wszystkie Twoje jednostki otrzymują +1 HP.",
      },
    ],
  },
  Gryf: {
    name: "Gryf",
    hp: 5,
    atk: 3,
    canTarget: BOTH,
    targetCategory: AIR,
    infrastructureForbidden: true,
    abilities: [
      {
        key: "inicjatywa",
        trigger: "on_play",
        effectKey: "buffSelfAtkNextAttack",
        params: { amount: 2 },
        description: "Po ustawieniu w obszarze gry pierwszy atak tej jednostki otrzymuje +2 ATK.",
      },
    ],
  },
  Ludzie: {
    name: "Ludzie",
    hp: 2,
    atk: 0,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "zrecznosc",
        trigger: "on_turn_start",
        effectKey: "drawFromStartingDeck",
        params: { count: 1 },
        description: "Na początku każdej swojej tury, dopóki ta jednostka żyje, dobierz 1 dodatkową kartę z talii startowej.",
      },
      {
        key: "zbrojne_pospolite_ruszenie",
        trigger: "passive_aura",
        effectKey: "conditionalAuraAtkIfUnitCount",
        params: { unitName: "Ludzie", requiredCount: 2, amount: 1 },
        description: "Jeżeli w obszarze gry masz 2 karty Ludzi, wszystkie Twoje jednostki otrzymują +1 ATK.",
      },
    ],
  },
  Druid: {
    name: "Druid",
    hp: 1,
    atk: 0,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "uzdrowienie",
        trigger: "on_turn_start",
        effectKey: "healKingdom",
        params: { amount: 2 },
        description: "Na początku swojej tury napraw 2 obrażenia Królestwa.",
      },
      {
        key: "wzmocnienie",
        trigger: "on_play",
        effectKey: "buffOwnUnitsHp",
        params: { amount: 1 },
        description: "Po wejściu do gry zwiększ HP jednostek w obszarze gry o +1 HP.",
      },
    ],
  },
  Najemnik: {
    name: "Najemnik",
    hp: 2,
    atk: 2,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [],
  },
  "Leśny Tropiciel": {
    // NOWA jednostka (v3) — Skógarríki.
    name: "Leśny Tropiciel",
    hp: 1,
    atk: 0,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "path_expert",
        trigger: "passive_aura",
        effectKey: "pathExpertPeekAndKeepBest",
        params: {},
        description:
          "Dopóki masz tę jednostkę w obszarze gry: przy zakupie jednostki z talii królestwa spójrz na 2 wierzchnie karty i zachowaj lepszą (druga wraca pod spód talii); przy zakupie karty Wydarzenia spójrz na 2 wierzchnie karty i zachowaj tę o pozytywnej polaryzacji (druga wraca pod spód talii).",
      },
    ],
  },
  Abzugud: {
    name: "Abzugud",
    hp: 6,
    atk: 5,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: true,
    abilities: [
      {
        key: "natchnienie",
        // v3: jednorazowy zryw przy wejściu do gry (dotyczy jednostek AKTUALNIE w grze),
        // nie trwała aura — nie działa na jednostki zagrane później i nie znika, gdy Abzugud pada.
        trigger: "on_play",
        effectKey: "buffUnitsCurrentlyInPlayAtkOnce",
        params: { amount: 1 },
        description: "Po wejściu do gry wszystkie Twoje jednostki AKTUALNIE w obszarze gry otrzymują jednorazowo +1 ATK.",
      },
    ],
  },
  Ent: {
    name: "Ent",
    hp: 4,
    atk: 3,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: true,
    abilities: [
      {
        key: "zakorzenienie",
        trigger: "passive_aura",
        effectKey: "extraUnitSlotOnHost",
        params: { extraSlots: 1 },
        description: "Możesz umieścić 1 dodatkową jednostkę na Encie.",
      },
      {
        key: "lesny_szal",
        trigger: "on_attack",
        effectKey: "jointAttack",
        params: { unitName: "Ent", requiredCount: 2, totalAtk: 8, splittable: true, canTarget: BOTH },
        description: "Dwa Enty mogą wykonać wspólny atak o sile 8 ATK przeciw jednostkom lądowym lub powietrznym. Atak można podzielić pomiędzy kilka celów.",
      },
    ],
  },
  Ork: {
    name: "Ork",
    hp: 2,
    atk: 2,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "szal_bitewny",
        trigger: "on_death",
        effectKey: "retaliateKillAttacker",
        params: { onlyLowerHpIfJointAttack: true },
        description: "Po zniszczeniu Orka wyeliminuj jednostkę, która go zaatakowała, ignorując jej HP (jeżeli atak był łączony, tylko jednostkę o niższym HP).",
      },
      {
        key: "horda",
        trigger: "passive_aura",
        effectKey: "jointAttackThreshold",
        // UWAGA: simulator_v3.py nazywa ten tag "horde_3_double_combo" i tak opisuje zasadę
        // (zgodnie z instrukcją: próg 3 Orków), ale JEGO WŁASNY kod (`combo_attacks`) sprawdza
        // tylko `len(orks) >= 2` i bierze grupę 2-osobową — rozbieżność między nazwą/opisem a
        // faktycznym kodem referencyjnym. Zachowujemy próg 3 (zgodny z nazwą tagu i instrukcją
        // źródłową) — do potwierdzenia w audycie.
        params: { unitName: "Ork", requiredCount: 3, multiplier: 2, splittable: true },
        description: "Jeżeli w obszarze gry masz 3 Orki, ich wspólny atak zostaje podwojony i może zostać podzielony pomiędzy kilka celów.",
      },
    ],
  },
  Harpia: {
    name: "Harpia",
    hp: 3,
    atk: 3,
    canTarget: BOTH,
    targetCategory: BOTH,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "harpii_zryw",
        trigger: "activated",
        effectKey: "relocateSelf",
        params: {},
        description: "Po zakończeniu swojej tury możesz przenieść Harpię na dowolne wolne pole w swoim obszarze gry.",
      },
    ],
  },
  Cyklop: {
    name: "Cyklop",
    hp: 5,
    atk: 3,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "rzut_glazem",
        trigger: "on_attack",
        effectKey: "jointAttack",
        // v3 ujednolica ten tag z Leśnym Szałem Enta (ten sam "combo_2_8dmg") — podział między
        // kilka celów jest tu dozwolony tak samo jak u Enta (w oryginalnej instrukcji tekst przy
        // Cyklopie nie wspominał o podziale wprost — ujednolicenie przyjęte z nowego silnika).
        params: { unitName: "Cyklop", requiredCount: 2, totalAtk: 8, splittable: true, canTarget: BOTH },
        description: "Jeżeli w obszarze gry masz 2 Cyklopy mogą wykonać wspólny atak o sile 8 ATK przeciw jednostkom lądowym lub powietrznym. Atak można podzielić pomiędzy kilka celów.",
      },
    ],
  },
  Czarodziej: {
    name: "Czarodziej",
    hp: 3,
    atk: 3,
    canTarget: BOTH,
    targetCategory: BOTH,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "inicjatywa",
        trigger: "on_play",
        effectKey: "buffSelfAtkNextAttack",
        params: { amount: 2 },
        description: "Po ustawieniu w obszarze gry pierwszy atak tej jednostki otrzymuje +2 ATK.",
      },
    ],
  },
  "Doświadczony Królewski Gwardzista": {
    name: "Doświadczony Królewski Gwardzista",
    hp: 3,
    atk: 2,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [],
  },
  "Elf Mroczny": {
    name: "Elf Mroczny",
    hp: 4,
    atk: 4,
    canTarget: BOTH,
    targetCategory: BOTH,
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
        key: "szarza",
        trigger: "on_enemy_destroyed",
        effectKey: "extraAttackThenDiscard",
        params: {},
        description: "Po pokonaniu wrogiej jednostki, karta może natychmiast wykonać drugi atak po czym musi zostać odrzucona na stos kart odrzuconych.",
      },
    ],
  },
  Feniks: {
    name: "Feniks",
    hp: 1,
    atk: 0,
    canTarget: AIR,
    targetCategory: AIR,
    infrastructureForbidden: true,
    abilities: [
      {
        key: "powstanie_z_popiolow",
        trigger: "on_death",
        effectKey: "replaceWithNextStartingDeckCardOnEnemyDiscard",
        params: {},
        description: "Po odrzuceniu przez przeciwnika natychmiast dobierz następną kartę z talii startowej i umieść ją na miejscu Feniksa.",
      },
      {
        key: "uzdrowienie",
        trigger: "on_turn_start",
        effectKey: "healKingdom",
        params: { amount: 1 },
        description: "Na początku swojej tury napraw 1 obrażenie Królestwa.",
      },
      {
        key: "wzmocnienie",
        trigger: "on_play",
        effectKey: "buffOwnUnitsHp",
        params: { amount: 1 },
        description: "Po wejściu do gry zwiększ HP jednostek w obszarze gry o +1 HP.",
      },
    ],
  },
  "Młody Smok": {
    name: "Młody Smok",
    hp: 6,
    atk: 5,
    canTarget: BOTH,
    targetCategory: BOTH,
    infrastructureForbidden: true,
    abilities: [],
  },
  "Legendarny Wyvern": {
    name: "Legendarny Wyvern",
    hp: 8,
    atk: 3,
    canTarget: AIR,
    targetCategory: AIR,
    infrastructureForbidden: true,
    abilities: [
      {
        key: "jadowity_prysk",
        trigger: "on_attack",
        effectKey: "directOrInfraKillInsteadOfAttack",
        params: { discardAfterUse: true },
        description: "Zamiast zwykłego ataku może wyeliminować jednostkę znajdującą się w infrastrukturze ignorując HP celu lub zadać obrażenie bezpośrednio Królestwu pomijając jednostki, po czym karta musi trafić na stos kart odrzuconych.",
      },
    ],
  },
  Nagual: {
    name: "Nagual",
    hp: 2,
    atk: 3,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [],
  },
  "Emisariusz En-šukud": {
    name: "Emisariusz En-šukud",
    hp: 2,
    atk: 1,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        // v3 dodaje Zręczność do tej jednostki (nieobecna w pierwotnej transkrypcji PDF).
        key: "zrecznosc",
        trigger: "on_turn_start",
        effectKey: "drawFromStartingDeck",
        params: { count: 1 },
        description: "Na początku każdej swojej tury, dopóki ta jednostka żyje, dobierz 1 dodatkową kartę z talii startowej.",
      },
      {
        key: "przywolanie",
        trigger: "on_death",
        effectKey: "recycleFromDiscardOnPairDeath",
        params: { pairUnitName: "Emisariusz En-šukud" },
        description: "Jeżeli dwaj Emisariusze En-šukud zostaną odrzuceni w tej samej turze, możesz odzyskać jedną dowolną kartę ze stosu odrzuconych i dodać ją do ręki, następnie odrzuć jedną kartę z ręki.",
      },
      {
        key: "poborca",
        trigger: "passive_aura",
        effectKey: "flatCoinOnInfra",
        params: { amount: 4, infra: ["tower", "mine"] },
        description: "Umieszczenie tej jednostki w Wieży lub Kopalni sprawi, że co turę uzyskasz 4 złota.",
      },
    ],
  },
  Minotaur: {
    name: "Minotaur",
    hp: 5,
    atk: 4,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: true,
    abilities: [
      {
        key: "szarza",
        trigger: "on_enemy_destroyed",
        effectKey: "extraAttackThenDiscard",
        params: {},
        description: "Po pokonaniu wrogiej jednostki, karta może natychmiast wykonać drugi atak po czym musi zostać odrzucona na stos kart odrzuconych.",
      },
    ],
  },
  Krasnolud: {
    // Staty zmienione w v3: HP 4→3, ATK 2→3.
    name: "Krasnolud",
    hp: 3,
    atk: 3,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        // v3: Katapulta to już nie wspólny atak dzielący slot, lecz TRWAŁE, opcjonalne
        // połączenie dwóch Krasnoludów w jedną kartę Katapulty (4 HP, 6 ATK, lądowe+powietrzne).
        // Aktywowane ręcznie, gdy gracz ma 2 Krasnoludy w obszarze gry.
        key: "krasnolud_katapulta",
        trigger: "activated",
        effectKey: "mergeIntoKatapulta",
        params: {},
        description: "Możesz połączyć dwa Krasnoludy w obszarze gry w jedną kartę Katapulty (4 HP, 6 ATK, atak lądowy i powietrzny).",
      },
      {
        key: "gornik",
        trigger: "passive_aura",
        effectKey: "mineProductionOverride",
        params: { amount: 5 },
        description: "Jeżeli Krasnolud znajduje się w Kopalni, generuje 5 monet zamiast standardowej wartości.",
      },
    ],
  },
  Katapulta: {
    // NOWA jednostka (v3) — produkt połączenia 2 Krasnoludów, nigdy nie kupowana bezpośrednio
    // (nie występuje w żadnej kompozycji talii królestwa).
    name: "Katapulta",
    hp: 4,
    atk: 6,
    canTarget: BOTH,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [],
  },
  Mag: {
    name: "Mag",
    hp: 2,
    atk: 2,
    canTarget: BOTH,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "uzdrowienie",
        trigger: "on_turn_start",
        effectKey: "healKingdom",
        params: { amount: 1 },
        description: "Na początku swojej tury napraw 1 obrażenie Królestwa.",
      },
      {
        key: "wzmocnienie",
        trigger: "on_play",
        effectKey: "buffOwnUnitsHp",
        params: { amount: 1 },
        description: "Po wejściu do gry zwiększ HP jednostek w obszarze gry o +1 HP.",
      },
    ],
  },
  "Włócznik Fianna": {
    name: "Włócznik Fianna",
    hp: 2,
    atk: 2,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [],
  },
  Centaur: {
    name: "Centaur",
    hp: 4,
    atk: 3,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: true,
    abilities: [
      {
        key: "szarza",
        trigger: "on_enemy_destroyed",
        effectKey: "extraAttackThenDiscard",
        params: {},
        description: "Po pokonaniu wrogiej jednostki, karta może natychmiast wykonać drugi atak po czym musi zostać odrzucona na stos kart odrzuconych.",
      },
      {
        key: "galop",
        trigger: "activated",
        effectKey: "relocateSelf",
        params: {},
        description: "Po zakończeniu swojej tury możesz przenieść Centaura na dowolne wolne pole w swoim obszarze gry.",
      },
    ],
  },
  "Elf Świetlisty": {
    // ATK zmienione w v3: 3→2.
    name: "Elf Świetlisty",
    hp: 4,
    atk: 2,
    canTarget: BOTH,
    targetCategory: LAND,
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
        key: "wzmocnienie",
        trigger: "on_play",
        effectKey: "buffOwnUnitsHp",
        params: { amount: 1 },
        description: "Po wejściu do gry zwiększ HP jednostek w obszarze gry o +1 HP.",
      },
    ],
  },
  Pegaz: {
    name: "Pegaz",
    hp: 4,
    atk: 1,
    canTarget: AIR,
    targetCategory: AIR,
    infrastructureForbidden: true,
    abilities: [
      {
        key: "zrecznosc",
        trigger: "on_turn_start",
        effectKey: "drawFromStartingDeck",
        params: { count: 1 },
        description: "Na początku każdej swojej tury, dopóki ta jednostka żyje, dobierz 1 dodatkową kartę z talii startowej.",
      },
      {
        key: "powietrzny_transport",
        trigger: "activated",
        effectKey: "relocateAllyOncePerTurn",
        params: {},
        description: "Raz na turę możesz przenieść jedną sojuszniczą jednostkę na dowolne wolne pole w swoim obszarze gry.",
      },
    ],
  },
  Łucznik: {
    name: "Łucznik",
    hp: 2,
    atk: 1,
    canTarget: BOTH,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [],
  },
  Medjayet: {
    // NOWA jednostka (v3) — Pr-Djed.
    name: "Medjayet",
    hp: 1,
    atk: 1,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "poborca",
        trigger: "passive_aura",
        effectKey: "flatCoinOnInfra",
        params: { amount: 4, infra: ["tower", "mine"] },
        description: "Umieszczenie tej jednostki w Wieży lub Kopalni sprawi, że co turę uzyskasz 4 złota.",
      },
    ],
  },
  Amazonka: {
    // NOWA jednostka (v3) — Uru-Gal.
    name: "Amazonka",
    hp: 2,
    atk: 3,
    canTarget: BOTH,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "siostrzana_przysiega",
        trigger: "on_turn_start",
        effectKey: "amazonSisterlyOath",
        params: { requiredCount: 2 },
        description:
          "Jeżeli masz 2 Amazonki w obszarze gry: na początku swojej tury spójrz na wierzchnie karty talii startowej, zagraj/dobierz najlepszą, resztę rozdziel między odrzucone i spód talii.",
      },
    ],
  },
};
