import { ALL_UNIT_DEFINITIONS, EVENT_DECK_UNIT_DEFINITIONS, TOWER_DEFINITIONS } from "@dudacastle/shared";

/**
 * Wygenerowane (Higgsfield) ilustracje kart. Pliki leżą w apps/web/public/cards/, więc Vite
 * serwuje je pod ścieżką /cards/*.webp bez przechodzenia przez bundler.
 *
 * Jednostki są mapowane PO NAZWIE (nie po definitionId), bo ten sam szablon jednostki (np. Gryf,
 * Czarodziej, Młody Smok, Ludzie, Feniks, Łucznik) występuje w kilku różnych królestwach z różnymi
 * definitionId, ale to fizycznie ta sama karta — jeden wygenerowany obraz obsługuje wszystkie
 * jej wystąpienia.
 */
const UNIT_ART_BY_NAME: Record<string, string> = {
  Faun: "/cards/faun.webp",
  "Elf Leśny": "/cards/elf-lesny.webp",
  Gryf: "/cards/gryf.webp",
  Ludzie: "/cards/ludzie.webp",
  Druid: "/cards/druid.webp",
  Najemnik: "/cards/najemnik.webp",
  "Leśny Tropiciel": "/cards/lesny-tropiciel.webp",
  Abzugud: "/cards/abzugud.webp",
  Ent: "/cards/ent.webp",
  Ork: "/cards/ork-uru-gal.webp",
  Harpia: "/cards/harpia.webp",
  Cyklop: "/cards/cyklop.webp",
  Czarodziej: "/cards/czarodziej.webp",
  "Doświadczony Królewski Gwardzista": "/cards/doswiadczony-krolewski-gwardzista.webp",
  "Elf Mroczny": "/cards/elf-mroczny.webp",
  Feniks: "/cards/feniks.webp",
  "Młody Smok": "/cards/mlody-smok.webp",
  "Legendarny Wyvern": "/cards/legendarny-wyvern.webp",
  Nagual: "/cards/nagual.webp",
  "Emisariusz En-šukud": "/cards/emisariusz-en-sukud.webp",
  Minotaur: "/cards/minotaur.webp",
  Krasnolud: "/cards/krasnolud.webp",
  Katapulta: "/cards/katapulta.webp",
  Mag: "/cards/mag.webp",
  "Włócznik Fianna": "/cards/wlocznik-fianna.webp",
  Centaur: "/cards/centaur.webp",
  "Elf Świetlisty": "/cards/elf-swietlisty.webp",
  Pegaz: "/cards/pegaz.webp",
  Łucznik: "/cards/lucznik.webp",
  Medjayet: "/cards/medjayet.webp",
  Amazonka: "/cards/amazonka.webp",
  Munmaa: "/cards/munmaa.webp",
};

const EVENT_ART: Record<string, string> = {
  "event-platnerz": "/cards/event-platnerz.webp",
  "event-trening-z-wojownikiem-srebrnych-glow": "/cards/event-trening-wojownik.webp",
  "event-wizyta-generala-szarych-plaszczy": "/cards/event-general-szarych-plaszczy.webp",
  "event-kopalnia-goblinow": "/cards/event-kopalnia-goblinow.webp",
  // Tańsze warianty infrastruktury z talii Wydarzeń — dzielą grafikę z samą infrastrukturą.
  "event-warownia": "/cards/warownia.webp",
  "event-koszary": "/cards/koszary.webp",
  "event-kopalnia": "/cards/kopalnia.webp",
  "event-sekrety-hrabiny": "/cards/event-sekrety-hrabiny.webp",
  "event-sprzyjajaca-pogoda": "/cards/event-sprzyjajaca-pogoda.webp",
  "event-zachodni-wiatr": "/cards/event-zachodni-wiatr.webp",
  "event-mgla": "/cards/event-mgla.webp",
  "event-dlugie-zacmienie-slonca": "/cards/dlugie-zacmienie-slonca.webp",
  "event-spotkanie-przyjaznego-trolla": "/cards/event-trolla.webp",
  "event-spotkanie-alchemika": "/cards/event-alchemika.webp",
  "event-przysluga-dla-ksiecia": "/cards/event-przysluga-dla-ksiecia.webp",
  "event-zarazliwa-plaga": "/cards/event-zarazliwa-plaga.webp",
  // Munmaa (karta Wydarzenia) dzieli grafikę z samą jednostką Munmaa, którą przyznaje.
  "event-munmaa": "/cards/munmaa.webp",
  "event-zasadzka-banitow": "/cards/event-zasadzka-banitow.webp",
  "event-utkniecie-w-grzezawisku": "/cards/event-utkniecie-w-grzezawisku.webp",
  "event-wedrowna-trupa-artystyczna": "/cards/event-wedrowna-trupa.webp",
  "event-zamieszanie": "/cards/event-zamieszanie.webp",
  "event-goranowe-szczescie": "/cards/event-goranowe-szczescie.webp",
};

const INFRA_ART: Record<string, string> = {
  "infra-mine": "/cards/kopalnia.webp",
  "infra-barracks": "/cards/koszary.webp",
  "infra-stronghold": "/cards/warownia.webp",
};

const CARD_ART: Record<string, string> = { ...EVENT_ART, ...INFRA_ART };

// Wieża jest wspólna wizualnie dla wszystkich królestw — ten sam obraz pod każdym z 5 id.
for (const tower of TOWER_DEFINITIONS) {
  CARD_ART[tower.id] = "/cards/wieza.webp";
}

// Jednostki: rozpisz mapę nazwa->plik na każdy konkretny definitionId (per królestwo + Munmaa).
for (const unit of [...ALL_UNIT_DEFINITIONS, ...EVENT_DECK_UNIT_DEFINITIONS]) {
  const art = UNIT_ART_BY_NAME[unit.name];
  if (art) CARD_ART[unit.id] = art;
}

export function getCardArt(definitionId: string): string | undefined {
  return CARD_ART[definitionId];
}
