# -*- coding: utf-8 -*-
"""
Baza kart wyekstrahowana z instrukcji gry.
type: "land" (atakuje tylko lądowe), "air" (tylko powietrzne), "both" (lądowe i powietrzne)
abilities: lista tagów używanych przez silnik statystyk/symulatora
"""

UNITS = {
    "Faun": dict(hp=1, atk=0, dtype="land",
                 abilities=["dexterity", "buff_hp_1"]),
    "Elf Lesny": dict(hp=3, atk=3, dtype="both",
                       abilities=["initiative", "synergy_faun_elf_hp1"]),
    "Gryf": dict(hp=5, atk=3, dtype="both",
                 abilities=["initiative"]),
    "Ludzie": dict(hp=2, atk=0, dtype="land",
                    abilities=["dexterity", "synergy_2ludzie_atk1"]),
    "Druid": dict(hp=1, atk=0, dtype="land",
                  abilities=["heal_2", "buff_hp_1"]),
    "Najemnik": dict(hp=2, atk=2, dtype="land", abilities=[]),
    "Lesny Tropiciel": dict(hp=1, atk=0, dtype="land", abilities=["path_expert"]),
    "Abzugud": dict(hp=6, atk=5, dtype="land", abilities=["team_atk_buff_1"]),
    "Ent": dict(hp=4, atk=3, dtype="land",
                abilities=["extra_slot_self", "combo_2_8dmg"]),
    "Ork": dict(hp=2, atk=2, dtype="land",
                abilities=["death_kill_attacker", "horde_3_double_combo"]),
    "Harpia": dict(hp=3, atk=3, dtype="both", abilities=["reposition_end_turn"]),
    "Cyklop": dict(hp=5, atk=3, dtype="land", abilities=["combo_2_8dmg"]),
    "Czarodziej": dict(hp=3, atk=3, dtype="both", abilities=["initiative"]),
    "Dosw. Krolewski Gwardzista": dict(hp=3, atk=2, dtype="land", abilities=[]),
    "Elf Mroczny": dict(hp=4, atk=4, dtype="both",
                         abilities=["initiative", "rampage_extra_attack_on_kill"]),
    "Feniks": dict(hp=1, atk=0, dtype="air",
                   abilities=["rebirth_on_discard", "heal_1", "buff_hp_1"]),
    "Mlody Smok": dict(hp=6, atk=5, dtype="both", abilities=[]),
    "Wyvern": dict(hp=8, atk=3, dtype="air", abilities=["venom_spray_infra_or_direct"]),
    "Nagual": dict(hp=2, atk=3, dtype="land", abilities=[]),
    "Emisariusz En-sukud": dict(hp=2, atk=1, dtype="land",
                                 abilities=["dexterity", "summon_on_2_discard", "tax_collector_infra"]),
    "Minotaur": dict(hp=5, atk=4, dtype="land", abilities=["rampage_extra_attack_on_kill"]),
    "Krasnolud": dict(hp=3, atk=3, dtype="land",
                       abilities=["krasnolud_katapulta", "miner_bonus_gold"]),
    "Katapulta": dict(hp=4, atk=6, dtype="both", abilities=[]),
    "Mag": dict(hp=2, atk=2, dtype="both", abilities=["heal_1", "buff_hp_1"]),
    "Wlocznik Fianna": dict(hp=2, atk=2, dtype="land", abilities=[]),
    "Centaur": dict(hp=4, atk=3, dtype="land",
                     abilities=["rampage_extra_attack_on_kill", "reposition_end_turn"]),
    "Elf Swietlisty": dict(hp=4, atk=2, dtype="land",
                            abilities=["initiative", "buff_hp_1"]),
    "Pegaz": dict(hp=4, atk=1, dtype="air",
                  abilities=["dexterity", "transport_ally"]),
    "Lucznik": dict(hp=2, atk=1, dtype="both", abilities=[]),
    "Medjayet": dict(hp=1, atk=1, dtype="land", abilities=["tax_collector_infra"]),
    "Amazonka": dict(hp=2, atk=3, dtype="both", abilities=["amazon_sisterly_oath"]),
}

# Kompozycja talii każdego królestwa: nazwa jednostki -> liczba kart
KINGDOMS = {
    "Skograriki": {
        "Faun": 6, "Elf Lesny": 7, "Gryf": 3, "Druid": 3,
        "Najemnik": 5, "Abzugud": 3, "Ent": 4, "Lesny Tropiciel": 4,
    },
    "Uru-Gal": {
        "Ork": 9, "Harpia": 6, "Cyklop": 5,
        "Czarodziej": 4, "Mlody Smok": 2,
        "Amazonka": 5, "Ludzie": 5,
        "Dosw. Krolewski Gwardzista": 3,
    },
    "Mictlancalli": {
        "Elf Mroczny": 9, "Feniks": 3, "Wyvern": 2, "Mlody Smok": 3,
        "Czarodziej": 4, "Nagual": 7, "Emisariusz En-sukud": 5,
        "Lucznik": 3,
    },
    "Sliabh Dun": {
        "Minotaur": 7, "Krasnolud": 9, "Mlody Smok": 4, "Gryf": 5,
        "Ludzie": 4, "Mag": 4, "Wlocznik Fianna": 4,
    },
    "Pr-Djed": {
        "Centaur": 9, "Gryf": 5, "Mlody Smok": 2, "Elf Swietlisty": 9,
        "Feniks": 4, "Pegaz": 3, "Lucznik": 3, "Medjayet": 3,
    },
}

# Stale ekonomiczne z instrukcji (UWAGA: poczatkowa liczba zlota nie jest
# podana w dostarczonym tekscie - "ustalona liczba monet" - przyjmuje 10
# jako zalozenie startowe, latwe do zmiany ponizej).
# Kategoria CELU jednostki (czym jednostka JEST, wplywa na to kto moze ja
# zaatakowac) - wyprowadzone z opisu bron/skrzydla w instrukcji:
# miecz -> "land", skrzydla -> "air", miecz i skrzydla -> "both".
# Atakujacy typu "land" moze bic tylko cele "land"/"both".
# Atakujacy typu "air" moze bic tylko cele "air"/"both".
# Atakujacy typu "both" bije wszystko. Jesli PRZECIWNIK MA JAKIEKOLWIEK
# jednostki w grze, nie mozna atakowac Krolestwa bezposrednio (nawet jesli
# zaden z jego atakow nie trafia w zaden cel z powodu niezgodnosci typow -
# taki atak jest wtedy zmarnowany).
TARGET_CATEGORY = {
    "Faun": "land", "Elf Lesny": "land", "Gryf": "air", "Ludzie": "land",
    "Druid": "land", "Najemnik": "land", "Abzugud": "land", "Ent": "land",
    "Ork": "land", "Harpia": "both", "Cyklop": "land", "Czarodziej": "both",
    "Dosw. Krolewski Gwardzista": "land", "Elf Mroczny": "both", "Feniks": "air",
    "Mlody Smok": "both", "Wyvern": "air", "Nagual": "land",
    "Emisariusz En-sukud": "land", "Minotaur": "land", "Krasnolud": "land",
    "Mag": "land", "Wlocznik Fianna": "land", "Centaur": "land",
    "Elf Swietlisty": "land", "Pegaz": "air", "Lucznik": "land", "Munmaa": "both",
    "Medjayet": "land", "Katapulta": "land", "Amazonka": "land",
    "Lesny Tropiciel": "land",
}
STARTING_GOLD = 3
UNIT_COST = 5
INFRA_COST = 7      # Wieza / Kopalnia / Koszary / Warownia (zakup normalny)
EVENT_COST = 3
CASTLE_HP_BY_PLAYERS = {2: 25, 3: 20, 4: 15, 5: 12}

# Jednostki, ktore NIE moga wejsc do Wiezy / Kopalni / Warowni (symbol zakazu
# infrastruktury = te same co "niehumanoidalne" wg wyjasnienia). Koszary bez
# ograniczen.
NON_HUMANOID = {"Gryf", "Abzugud", "Feniks", "Mlody Smok", "Wyvern", "Minotaur", "Centaur",
                 "Ent", "Pegaz"}

# Munmaa - unikalna jednostka zdobywana WYLACZNIE przez kupno karty Wydarzenia
# "Munmaa". Zdolnosc Harmonia (przemieszczenie) nie ma wplywu na walke w tym
# modelu (nie modelujemy pozycji na planszy) - pomijamy funkcjonalnie.
UNITS["Munmaa"] = dict(hp=3, atk=2, dtype="both", abilities=["initiative"])

# Talia Wydarzen: name -> (liczba_kopii, polaryzacja, tag_efektu)
# polaryzacja = czy efekt jest generalnie korzystny/niekorzystny dla osoby,
# KTORA GO ROZPATRUJE (potrzebne do Goranowego Szczescia). Domyslna
# klasyfikacja przyjeta zgodnie z ustaleniami.
EVENTS = {
    "Platnerz": (1, "positive", "buff_hp_all_permanent_1"),
    "Trening z Wojownikiem Srebrnych Glow": (3, "positive", "silver_head_warrior"),
    "Wizyta Generala Szarych Plaszczy": (4, "positive", "double_atk_this_turn"),
    "Kopalnia Goblinow": (2, "positive", "goblin_mine_plus3"),
    "Warownia_event": (1, "positive", "get_fortress_cheap"),
    "Koszary_event": (1, "positive", "get_barracks_cheap"),
    "Kopalnia_event": (1, "positive", "get_mine_cheap"),
    "Sekrety Hrabiny": (3, "positive", "opponents_pay_you_2"),
    "Sprzyjajaca Pogoda": (2, "positive", "heal_all_3"),
    "Zachodni Wiatr": (3, "positive", "skip_next_player"),
    "Mgla": (4, "positive", "noop_fog"),
    "Dlugie Zacmienie Slonca": (1, "negative", "aoe_castle_dmg_5"),
    "Spotkanie Przyjaznego Trolla": (4, "positive", "triple_mine_next_turn"),
    "Spotkanie Alchemika": (2, "positive", "alchemist_free_unit_buff4"),
    "Przysluga dla Ksiecia": (5, "negative", "skip_turn_then_free_card"),
    "Zarazliwa Plaga": (3, "negative", "discard_2_units"),
    "Munmaa": (1, "positive", "gain_munmaa"),
    "Zasadzka Banitow": (6, "positive", "destroy_weakest_enemy_infra"),
    "Utkniecie w Grzezawisku": (3, "negative", "skip_turn_plain"),
    "Wedrowna Trupa Artystyczna": (1, "negative", "skip_2_turns_then_gold6"),
    "Zamieszanie": (8, "positive", "noop_reposition"),
    "Goranowe Szczescie": (2, "positive", "goranowe_szczescie"),
}
