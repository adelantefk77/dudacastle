import type { Ability, TargetDomain } from "../types/card.js";

/**
 * Szablony jednostek — v4 (zob. `cards (1) 2.py` / `simulator_v3 (1) 2.py` / The-Five-Crowns-
 * Kompendium-Gracza.pdf dostarczone przez użytkownika, traktowane jako źródło prawdy nadrzędne
 * względem poprzedniej wersji tego pliku). Zmiany udokumentowane przy każdej jednostce.
 *
 * DWA NIEZALEŻNE POLA KIERUNKOWE:
 * - `canTarget`: co ta jednostka MOŻE atakować (ofensywnie).
 * - `targetCategory`: czym ta jednostka JEST jako cel — kto może ją trafić (defensywnie).
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
        trigger: "on_turn_start",
        effectKey: "drawFromStartingDeck",
        params: { count: 1 },
        description: "Na początku każdej swojej tury, dopóki ta jednostka żyje, dobierz 1 dodatkową kartę z talii startowej.",
      },
      {
        // v4: Wzmocnienie to ŻYWA, CIĄGŁA aura (nie jednorazowa mutacja) — zob. auras.ts.
        // Obowiązuje dopóki ta jednostka pozostaje w obszarze gry, znika natychmiast po jej odejściu,
        // i NIGDY nie wzmacnia samej siebie.
        key: "wzmocnienie",
        trigger: "passive_aura",
        effectKey: "wzmocnienieAura",
        params: { amount: 1 },
        description: "Dopóki ta jednostka pozostaje w obszarze gry, wszystkie INNE Twoje jednostki otrzymują +1 HP.",
      },
      {
        // Śpiew Natury sprawdzany przy on_play OBU kart pary (Faun i Elf Leśny) — niezależnie od
        // tego, która z nich dopełnia parę jako druga, zob. identyczna zdolność u Elfa Leśnego.
        key: "spiew_natury",
        trigger: "on_play",
        effectKey: "faunElfSongBurst",
        params: {},
        description:
          "Gdy w obszarze gry masz jednocześnie Fauna i Elfa Leśnego: wszystkie Twoje jednostki (włącznie z nimi) otrzymują jednorazowo +2 ATK, po czym obie karty (Faun i Elf Leśny) trafiają na stos kart odrzuconych.",
      },
    ],
  },
  "Elf Leśny": {
    name: "Elf Leśny",
    // v4: HP 3→2.
    hp: 2,
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
        // v4: Śpiew Natury przestał być trwałą aurą — to JEDNORAZOWY, samo-konsumujący się zryw:
        // gdy w obszarze gry są jednocześnie Faun i Elf Leśny, wszystkie jednostki (wliczając ich)
        // dostają +2 ATK, po czym OBIE karty trafiają na stos odrzuconych.
        key: "spiew_natury",
        trigger: "on_play",
        effectKey: "faunElfSongBurst",
        params: {},
        description:
          "Gdy w obszarze gry masz jednocześnie Fauna i Elfa Leśnego: wszystkie Twoje jednostki (włącznie z nimi) otrzymują jednorazowo +2 ATK, po czym obie karty (Faun i Elf Leśny) trafiają na stos kart odrzuconych.",
      },
    ],
  },
  Gryf: {
    name: "Gryf",
    // v4: HP 5→4, ATK 3→2, Inicjatywa USUNIĘTA (Gryf nie ma już żadnej zdolności).
    hp: 4,
    atk: 2,
    canTarget: BOTH,
    targetCategory: AIR,
    infrastructureForbidden: true,
    abilities: [],
  },
  Ludzie: {
    name: "Ludzie",
    // v4: HP 2→1.
    hp: 1,
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
        trigger: "passive_aura",
        effectKey: "wzmocnienieAura",
        params: { amount: 1 },
        description: "Dopóki ta jednostka pozostaje w obszarze gry, wszystkie INNE Twoje jednostki otrzymują +1 HP.",
      },
    ],
  },
  Najemnik: {
    name: "Najemnik",
    // v4: HP 2→1, ATK 2→1.
    hp: 1,
    atk: 1,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [],
  },
  "Leśny Tropiciel": {
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
    // v4: HP 6→5, ATK 5→4.
    hp: 5,
    atk: 4,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: true,
    abilities: [
      {
        // v4: Natchnienie to ŻYWA, CIĄGŁA aura (nie jednorazowy zryw) — dopóki ta jednostka
        // pozostaje w obszarze gry, wszystkie Twoje jednostki (WLICZAJĄC ją samą) mają +1 ATK.
        // Zob. auras.ts — sumuje się niezależnie per każda kopia tej zdolności w grze.
        key: "natchnienie",
        trigger: "passive_aura",
        effectKey: "auraAtkAllOwnUnits",
        params: { amount: 1 },
        description: "Dopóki ta jednostka pozostaje w obszarze gry, wszystkie Twoje jednostki (wliczając ją) otrzymują +1 ATK.",
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
    // v4: ATK 2→1.
    hp: 2,
    atk: 1,
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
        // v4: PDF/simulator_v3 (1) 2.py potwierdzają jednoznacznie próg 3 Orków I potrojenie
        // (poprzednia wersja katalogu zachowywała próg 3 z podwojeniem — mnożnik był błędny).
        params: { unitName: "Ork", requiredCount: 3, multiplier: 3, splittable: true },
        description: "Jeżeli w obszarze gry masz 3 Orki, ich wspólny atak zostaje potrojony i może zostać podzielony pomiędzy kilka celów.",
      },
    ],
  },
  Harpia: {
    name: "Harpia",
    // v4: HP 3→2, ATK 3→2.
    hp: 2,
    atk: 2,
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
    // v4: HP 5→4.
    hp: 4,
    atk: 3,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "rzut_glazem",
        trigger: "on_attack",
        effectKey: "jointAttack",
        params: { unitName: "Cyklop", requiredCount: 2, totalAtk: 8, splittable: true, canTarget: BOTH },
        description: "Jeżeli w obszarze gry masz 2 Cyklopy mogą wykonać wspólny atak o sile 8 ATK przeciw jednostkom lądowym lub powietrznym. Atak można podzielić pomiędzy kilka celów.",
      },
    ],
  },
  Czarodziej: {
    name: "Czarodziej",
    // v4: HP 3→2.
    hp: 2,
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
      {
        // v4: Czarodziej zyskuje Natchnienie (ta sama ciągła aura co Abzugud).
        key: "natchnienie",
        trigger: "passive_aura",
        effectKey: "auraAtkAllOwnUnits",
        params: { amount: 1 },
        description: "Dopóki ta jednostka pozostaje w obszarze gry, wszystkie Twoje jednostki (wliczając ją) otrzymują +1 ATK.",
      },
    ],
  },
  "Doświadczony Królewski Gwardzista": {
    // v4: HP 3→1. Nieobecna w żadnej kompozycji talii królestwa (zastąpiona przez "Królewski
    // Gwardzista Ninurty" w Uru-Gal) — zachowana w katalogu jako martwy, niekupowalny wpis.
    name: "Doświadczony Królewski Gwardzista",
    hp: 1,
    atk: 2,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [],
  },
  "Królewski Gwardzista Ninurty": {
    // NOWA jednostka (v4) — Uru-Gal, zastępuje "Doświadczony Królewski Gwardzista" w tej talii.
    name: "Królewski Gwardzista Ninurty",
    hp: 1,
    atk: 1,
    canTarget: LAND,
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
    ],
  },
  "Elf Mroczny": {
    name: "Elf Mroczny",
    // v4: HP 4→3.
    hp: 3,
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
        trigger: "passive_aura",
        effectKey: "wzmocnienieAura",
        params: { amount: 1 },
        description: "Dopóki ta jednostka pozostaje w obszarze gry, wszystkie INNE Twoje jednostki otrzymują +1 HP.",
      },
    ],
  },
  "Młody Smok": {
    name: "Młody Smok",
    // v4: HP 6→5, ATK 5→4, ZYSKUJE Inicjatywę (poprzednio brak zdolności).
    hp: 5,
    atk: 4,
    canTarget: BOTH,
    targetCategory: BOTH,
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
  Wyvern: {
    // v4: przemianowany z "Legendarny Wyvern" na "Wyvern" (zgodnie z cards.py/PDF); HP 8→6.
    name: "Wyvern",
    hp: 6,
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
    // v4: ATK 3→1.
    hp: 2,
    atk: 1,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [],
  },
  "Emisariusz En-šukud": {
    name: "Emisariusz En-šukud",
    // v4: HP 2→1, ATK 1→0.
    hp: 1,
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
    // v4: HP 5→3.
    hp: 3,
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
    // v4: HP 3→2, ATK 3→2 (Codex audit — poprzednia wartość była pozostałością z v3, cards (1) 2.py
    // i PDF jednoznacznie podają 2/2).
    name: "Krasnolud",
    hp: 2,
    atk: 2,
    canTarget: LAND,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
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
    // Produkt połączenia 2 Krasnoludów, nigdy nie kupowana bezpośrednio.
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
        // v4: Mag jest jedynym nosicielem Wzmocnienia o wartości +2 HP (nie +1) — zob. PDF
        // "Podsumowanie zdolności" ("Mag: +2 HP") oraz cards.py tag "buff_hp_2".
        key: "wzmocnienie",
        trigger: "passive_aura",
        effectKey: "wzmocnienieAura",
        params: { amount: 2 },
        description: "Dopóki ta jednostka pozostaje w obszarze gry, wszystkie INNE Twoje jednostki otrzymują +2 HP.",
      },
    ],
  },
  "Włócznik Fianna": {
    name: "Włócznik Fianna",
    // v4: HP 2→1, ZYSKUJE Znawcę Ścieżek (poprzednio brak zdolności).
    hp: 1,
    atk: 2,
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
  Centaur: {
    name: "Centaur",
    // v4: HP 4→3, ATK 3→4.
    hp: 3,
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
      {
        // v4: Galop zastąpiony przez Powietrzny Transport Pegaza — Centaur teraz przenosi
        // SOJUSZNICZĄ jednostkę (nie samego siebie), dokładnie jak Pegaz.
        key: "galop",
        trigger: "activated",
        effectKey: "relocateAllyOncePerTurn",
        params: {},
        description: "Raz na turę możesz przenieść jedną sojuszniczą jednostkę na dowolne wolne miejsce w swoim obszarze gry (w tym do infrastruktury).",
      },
    ],
  },
  "Elf Świetlisty": {
    name: "Elf Świetlisty",
    // v4: HP 4→3.
    hp: 3,
    atk: 2,
    canTarget: BOTH,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        // v4: Elf Świetlisty to JEDYNA jednostka, której Inicjatywa daje +3 ATK zamiast +2
        // (potwierdzone w simulator_v3 (1) 2.py resolve_attack i w PDF "Podsumowanie zdolności").
        key: "inicjatywa",
        trigger: "on_play",
        effectKey: "buffSelfAtkNextAttack",
        params: { amount: 3 },
        description: "Po ustawieniu w obszarze gry pierwszy atak tej jednostki otrzymuje +3 ATK.",
      },
      {
        key: "wzmocnienie",
        trigger: "passive_aura",
        effectKey: "wzmocnienieAura",
        params: { amount: 1 },
        description: "Dopóki ta jednostka pozostaje w obszarze gry, wszystkie INNE Twoje jednostki otrzymują +1 HP.",
      },
    ],
  },
  Pegaz: {
    name: "Pegaz",
    // v4: HP 4→2.
    hp: 2,
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
  "Doświadczony Łucznik": {
    // v4: przemianowany z "Łucznik"; HP 2→1. Zyskuje zdolność łączenia w Kolczan Prawilności.
    name: "Doświadczony Łucznik",
    hp: 1,
    atk: 1,
    canTarget: BOTH,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        key: "lucznik_kolczan",
        trigger: "activated",
        effectKey: "mergeIntoKolczan",
        params: {},
        description: "Możesz połączyć dwóch Doświadczonych Łuczników w obszarze gry w jedną kartę Kolczana Prawilności (2 HP, 2 ATK, atak lądowy i powietrzny).",
      },
    ],
  },
  "Kolczan Prawilności": {
    // NOWA jednostka (v4) — produkt połączenia 2 Doświadczonych Łuczników, nigdy nie kupowana
    // bezpośrednio (nie występuje w żadnej kompozycji talii królestwa).
    name: "Kolczan Prawilności",
    hp: 2,
    atk: 2,
    canTarget: BOTH,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [],
  },
  Medjayet: {
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
    name: "Amazonka",
    // v4: HP 2→1, ATK 3→1.
    hp: 1,
    atk: 1,
    canTarget: BOTH,
    targetCategory: LAND,
    infrastructureForbidden: false,
    abilities: [
      {
        // v4: próg 2→1 Amazonek (potwierdzone w simulator_v3 (1) 2.py: `count("Amazonka") >= 1`).
        key: "siostrzana_przysiega",
        trigger: "on_turn_start",
        effectKey: "amazonSisterlyOath",
        params: { requiredCount: 1 },
        description:
          "Gdy Amazonka jest w grze: na początku swojej tury spójrz na 3 wierzchnie karty talii startowej, jedną dobierz/zagraj od razu, jedną odrzuć na stos kart odrzuconych, jedną odłóż z powrotem na wierzch talii.",
      },
    ],
  },
};
