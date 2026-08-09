import type { InfrastructureCardDefinition } from "../types/card.js";
import { KINGDOMS } from "./kingdoms/index.js";

/**
 * Mechaniki infrastruktury jako dane — silnik czyta te liczby zamiast
 * hardkodować "Wieża daje +2 slot" w wielu miejscach kodu.
 */
export interface InfrastructureMechanics {
  unitSlotBonus?: number;
  unitHpBonus?: number;
  targetOverride?: "land" | "air" | "land_and_air";
  indestructible?: boolean;
  baseCoinProduction?: number;
  humanoidCoinProduction?: number;
  maxUnits?: number;
  /** Liczba (własnych) tur oczekiwania zanim jednostka może działać po umieszczeniu */
  delayTurns?: number;
  actionsGrantedAfterDelay?: number;
  grantsCrossTrainingOnExit?: boolean;
  untargetableWhileInside?: boolean;
  discardOnExit?: boolean;
}

export interface InfrastructureCardDefinitionWithMechanics extends InfrastructureCardDefinition {
  mechanics: InfrastructureMechanics;
}

/**
 * Wieża — v3 (zob. cards.py/simulator_v3.py): NIE jest już darmowym prezentem startowym, tylko
 * zwykłą kupowalną infrastrukturą (koszt INFRA_COST, bez limitu wspólnej puli — każdy gracz może
 * kupić dokładnie jedną własną Wieżę, niezależnie od liczby graczy). Zob. reducer.ts BUY_INFRASTRUCTURE.
 */
export const TOWER_DEFINITIONS: InfrastructureCardDefinitionWithMechanics[] = KINGDOMS.map(
  (kingdom) => ({
    id: kingdom.towerCardId,
    type: "infrastructure",
    kind: "tower",
    name: `Wieża (${kingdom.name})`,
    cost: 7, // INFRA_COST (v3) — jednakowy koszt dla Wieży/Kopalni/Koszar/Warowni
    description:
      "Zwiększa liczbę dostępnych miejsc na jednostki z 3 do 5. Jednostki w Wieży otrzymują +2 HP i mogą atakować cele lądowe i powietrzne. Wieża sama nie może zostać zniszczona.",
    mechanics: {
      unitSlotBonus: 2,
      unitHpBonus: 2,
      targetOverride: "land_and_air",
      indestructible: true,
      // Interpretacja: instrukcja mówi "+2 miejsca" (3→5) I OSOBNO opisuje bonusy dla
      // "jednostek znajdujących się w Wieży" jako odrębne miejsce od play_area — przyjmujemy,
      // że te dodatkowe 2 miejsca TO fizycznie sloty "w Wieży" (stąd maxUnits=2 tutaj),
      // a play_area pozostaje przy swoich 3 bazowych. Niejednoznaczne w źródle, do weryfikacji.
      maxUnits: 2,
    },
  }),
);

/**
 * Kopalnia/Koszary/Warownia pochodzą ze wspólnej puli infrastruktury
 * (odpowiednio: graczy-1 sztuk każda) — nie są przypisane do królestwa.
 * Koszt zakupu: INFRA_COST=7 (v3 — zob. cards.py), jednakowy dla wszystkich typów
 * infrastruktury łącznie z Wieżą. Tańsze warianty (1 moneta) pochodzą z talii Wydarzeń.
 */
export const MINE_DEFINITION: InfrastructureCardDefinitionWithMechanics = {
  id: "infra-mine",
  type: "infrastructure",
  kind: "mine",
  name: "Kopalnia",
  cost: 7,
  description:
    "Na początku każdej swojej tury właściciel otrzymuje dodatkową monetę (3 monety, jeżeli na Kopalni znajduje się jednostka humanoidalna). Jednostka na Kopalni może zostać zaatakowana.",
  mechanics: {
    baseCoinProduction: 1,
    humanoidCoinProduction: 3,
    maxUnits: 1,
  },
};

export const BARRACKS_DEFINITION: InfrastructureCardDefinitionWithMechanics = {
  id: "infra-barracks",
  type: "infrastructure",
  kind: "barracks",
  name: "Koszary",
  cost: 7,
  description:
    "Maksymalnie dwie jednostki. Jednostki w Koszarach nie mogą działać do początku swojej następnej tury, po czym opuszczają Koszary, aktywują efekt Cross Training i trafiają na stos kart odrzuconych. Mogą być celem ataków.",
  mechanics: {
    maxUnits: 2,
    delayTurns: 1,
    grantsCrossTrainingOnExit: true,
    discardOnExit: true,
  },
};

export const STRONGHOLD_DEFINITION: InfrastructureCardDefinitionWithMechanics = {
  id: "infra-stronghold",
  type: "infrastructure",
  kind: "stronghold",
  name: "Warownia",
  cost: 7,
  description:
    "Przechowuje jedną jednostkę. Nie może ona działać do początku swojej następnej tury, po czym może wykonać dwa działania (atak lub zdolność), po czym trafia na stos kart odrzuconych. Nie może być celem ataków, chyba że efekt karty stanowi inaczej.",
  mechanics: {
    maxUnits: 1,
    delayTurns: 1,
    actionsGrantedAfterDelay: 2,
    untargetableWhileInside: true,
    discardOnExit: true,
  },
};

export const SHARED_INFRASTRUCTURE_DEFINITIONS: InfrastructureCardDefinitionWithMechanics[] = [
  MINE_DEFINITION,
  BARRACKS_DEFINITION,
  STRONGHOLD_DEFINITION,
];

export const ALL_INFRASTRUCTURE_DEFINITIONS: InfrastructureCardDefinitionWithMechanics[] = [
  ...TOWER_DEFINITIONS,
  ...SHARED_INFRASTRUCTURE_DEFINITIONS,
];

/** Liczba egzemplarzy każdego typu infrastruktury do przygotowania wg liczby graczy (sekcja 1) */
export function infrastructurePoolSize(playerCount: number): {
  towers: number;
  mines: number;
  barracks: number;
  strongholds: number;
} {
  return {
    towers: playerCount, // każdy gracz posiada wyłącznie swoją Wieżę
    mines: playerCount - 1,
    barracks: playerCount - 1,
    strongholds: playerCount - 1,
  };
}
