import { ALL_UNIT_DEFINITIONS, EVENT_DECK_UNIT_DEFINITIONS, TOWER_DEFINITIONS } from "@dudacastle/shared";

/**
 * Wygenerowane (Higgsfield) ilustracje kart. Pliki leżą w apps/web/public/cards/, więc Vite
 * serwuje je pod ścieżką /cards/*.png bez przechodzenia przez bundler.
 *
 * Jednostki są mapowane PO NAZWIE (nie po definitionId), bo ten sam szablon jednostki (np. Gryf,
 * Czarodziej, Młody Smok, Ludzie, Feniks, Łucznik) występuje w kilku różnych królestwach z różnymi
 * definitionId, ale to fizycznie ta sama karta — jeden wygenerowany obraz obsługuje wszystkie
 * jej wystąpienia.
 */
const UNIT_ART_BY_NAME: Record<string, string> = {
  Faun: "/cards/faun.png",
  "Elf Leśny": "/cards/elf-lesny.png",
  Gryf: "/cards/gryf.png",
  Ludzie: "/cards/ludzie.png",
  Druid: "/cards/druid.png",
  Najemnik: "/cards/najemnik.png",
  "Leśny Tropiciel": "/cards/lesny-tropiciel.png",
  Abzugud: "/cards/abzugud.png",
  Ent: "/cards/ent.png",
  Ork: "/cards/ork-uru-gal.png",
  Harpia: "/cards/harpia.png",
  Cyklop: "/cards/cyklop.png",
  Czarodziej: "/cards/czarodziej.png",
  "Doświadczony Królewski Gwardzista": "/cards/doswiadczony-krolewski-gwardzista.png",
  "Elf Mroczny": "/cards/elf-mroczny.png",
  Feniks: "/cards/feniks.png",
  "Młody Smok": "/cards/mlody-smok.png",
  "Legendarny Wyvern": "/cards/legendarny-wyvern.png",
  Nagual: "/cards/nagual.png",
  "Emisariusz En-šukud": "/cards/emisariusz-en-sukud.png",
  Minotaur: "/cards/minotaur.png",
  Krasnolud: "/cards/krasnolud.png",
  Katapulta: "/cards/katapulta.png",
  Mag: "/cards/mag.png",
  "Włócznik Fianna": "/cards/wlocznik-fianna.png",
  Centaur: "/cards/centaur.png",
  "Elf Świetlisty": "/cards/elf-swietlisty.png",
  Pegaz: "/cards/pegaz.png",
  Łucznik: "/cards/lucznik.png",
  Medjayet: "/cards/medjayet.png",
  Amazonka: "/cards/amazonka.png",
  Munmaa: "/cards/munmaa.png",
};

const EVENT_ART: Record<string, string> = {
  "event-platnerz": "/cards/event-platnerz.png",
  "event-trening-z-wojownikiem-srebrnych-glow": "/cards/event-trening-wojownik.png",
  "event-wizyta-generala-szarych-plaszczy": "/cards/event-general-szarych-plaszczy.png",
  "event-kopalnia-goblinow": "/cards/event-kopalnia-goblinow.png",
  // Tańsze warianty infrastruktury z talii Wydarzeń — dzielą grafikę z samą infrastrukturą.
  "event-warownia": "/cards/warownia.png",
  "event-koszary": "/cards/koszary.png",
  "event-kopalnia": "/cards/kopalnia.png",
  "event-sekrety-hrabiny": "/cards/event-sekrety-hrabiny.png",
  "event-sprzyjajaca-pogoda": "/cards/event-sprzyjajaca-pogoda.png",
  "event-zachodni-wiatr": "/cards/event-zachodni-wiatr.png",
  "event-mgla": "/cards/event-mgla.png",
  "event-dlugie-zacmienie-slonca": "/cards/dlugie-zacmienie-slonca.png",
  "event-spotkanie-przyjaznego-trolla": "/cards/event-trolla.png",
  "event-spotkanie-alchemika": "/cards/event-alchemika.png",
  "event-przysluga-dla-ksiecia": "/cards/event-przysluga-dla-ksiecia.png",
  "event-zarazliwa-plaga": "/cards/event-zarazliwa-plaga.png",
  // Munmaa (karta Wydarzenia) dzieli grafikę z samą jednostką Munmaa, którą przyznaje.
  "event-munmaa": "/cards/munmaa.png",
  "event-zasadzka-banitow": "/cards/event-zasadzka-banitow.png",
  "event-utkniecie-w-grzezawisku": "/cards/event-utkniecie-w-grzezawisku.png",
  "event-wedrowna-trupa-artystyczna": "/cards/event-wedrowna-trupa.png",
  "event-zamieszanie": "/cards/event-zamieszanie.png",
  "event-goranowe-szczescie": "/cards/event-goranowe-szczescie.png",
};

const INFRA_ART: Record<string, string> = {
  "infra-mine": "/cards/kopalnia.png",
  "infra-barracks": "/cards/koszary.png",
  "infra-stronghold": "/cards/warownia.png",
};

const CARD_ART: Record<string, string> = { ...EVENT_ART, ...INFRA_ART };

// Wieża jest wspólna wizualnie dla wszystkich królestw — ten sam obraz pod każdym z 5 id.
for (const tower of TOWER_DEFINITIONS) {
  CARD_ART[tower.id] = "/cards/wieza.png";
}

// Jednostki: rozpisz mapę nazwa->plik na każdy konkretny definitionId (per królestwo + Munmaa).
for (const unit of [...ALL_UNIT_DEFINITIONS, ...EVENT_DECK_UNIT_DEFINITIONS]) {
  const art = UNIT_ART_BY_NAME[unit.name];
  if (art) CARD_ART[unit.id] = art;
}

export function getCardArt(definitionId: string): string | undefined {
  return CARD_ART[definitionId];
}
