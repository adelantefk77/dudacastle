/**
 * Definicje kart są danymi, nie kodem: silnik gry interpretuje `abilities`/`effect`
 * przez rejestr efektów (zob. apps/server/src/engine/effect-resolver.ts).
 * Dzięki temu dodanie/poprawienie karty nie wymaga zmian w logice silnika.
 */

export type CardType = "unit" | "event" | "infrastructure";

export type TargetDomain = "land" | "air" | "land_and_air";

export type AbilityTrigger =
  | "on_play" // po ustawieniu w obszarze gry (np. Inicjatywa)
  | "on_turn_start" // na początku tury właściciela (np. Uzdrowienie)
  | "on_attack" // w trakcie ataku (np. wspólne ataki)
  | "on_death" // po zniszczeniu tej jednostki (np. Szał Bitewny Orka)
  | "on_ally_destroyed" // po odrzuceniu sojuszniczej kopii (np. Przywołanie Emisariusza)
  | "on_enemy_destroyed" // po pokonaniu wrogiej jednostki (np. Szarża)
  | "passive_aura" // stały efekt warunkowy (np. Śpiew Natury, Zbrojne Pospolite Ruszenie)
  | "activated"; // aktywowana raz na turę z ręki/planszy (np. Harmonia Munmaa)

export interface Ability {
  /** Unikalny w ramach karty klucz zdolności, np. "inicjatywa", "horda" */
  key: string;
  trigger: AbilityTrigger;
  /** Klucz funkcji w rejestrze efektów silnika */
  effectKey: string;
  params?: Record<string, unknown>;
  /** Tekst z instrukcji, do wyświetlenia graczowi */
  description: string;
}

export interface UnitCardDefinition {
  id: string;
  type: "unit";
  kingdomId: string;
  name: string;
  /** Koszt zakupu z talii królestwa (5 wg silnika v3 — zob. UNIT_COST w cards.py) */
  cost: number;
  hp: number;
  atk: number;
  /** Co ta jednostka MOŻE atakować (zdolność ofensywna) — np. Elf Leśny: "miecz" (broń), ale attackuje "lądowe i powietrzne". */
  canTarget: TargetDomain;
  /**
   * Czym ta jednostka JEST jako cel (kto może ją trafić) — niezależne od `canTarget`.
   * Wyprowadzone z broni na karcie fizycznej (miecz→land, skrzydła→air, miecz i skrzydła→both),
   * zob. cards.py TARGET_CATEGORY. Przykład rozbieżności: Gryf ma `canTarget: both` (atakuje
   * lądowe i powietrzne), ale `targetCategory: air` (sam jest wyłącznie celem powietrznym —
   * ma tylko skrzydła, bez miecza).
   */
  targetCategory: TargetDomain;
  /** Symbol zakazu infrastruktury: nie można umieścić w Wieży/Warowni/Kopalni (Koszary bez ograniczeń) — zob. cards.py NON_HUMANOID */
  infrastructureForbidden: boolean;
  abilities: Ability[];
}

export type EventEffectTiming =
  | "instant" // rozpatrywane natychmiast po zakupie/zagraniu
  | "held_one_shot" // trzymana na ręce, zagrywana jednorazowo w wybranej turze
  | "permanent"; // trwały efekt do końca rozgrywki

export interface EventCardDefinition {
  id: string;
  type: "event";
  name: string;
  cost: number;
  timing: EventEffectTiming;
  effectKey: string;
  params?: Record<string, unknown>;
  description: string;
  /** Liczba egzemplarzy w talii Wydarzeń */
  deckCount: number;
  /**
   * Czy efekt jest generalnie korzystny/niekorzystny dla gracza, który go rozpatruje.
   * Potrzebne przez efekty typu "Goranowe Szczęście" (sekcja 9: "Efekty kart mogą być
   * pozytywne, negatywne"). Klasyfikacja subiektywna tam, gdzie karta ma efekt mieszany.
   */
  polarity: "positive" | "negative" | "mixed";
}

export type InfrastructureKind = "tower" | "mine" | "barracks" | "stronghold";

export interface InfrastructureCardDefinition {
  id: string;
  type: "infrastructure";
  kind: InfrastructureKind;
  name: string;
  /** Wieża jest wydawana każdemu graczowi za darmo na starcie; pozostałe mają cenę zakupu */
  cost: number | null;
  description: string;
}

export type CardDefinition =
  | UnitCardDefinition
  | EventCardDefinition
  | InfrastructureCardDefinition;

export interface KingdomDefinition {
  id: string;
  name: string;
  towerCardId: string;
  /** Instrukcja nie podaje wartości wprost — do skonfigurowania przed startem sezonu */
  startingHpByPlayerCount: Record<number, number>;
}
