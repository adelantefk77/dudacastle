# -*- coding: utf-8 -*-
"""
Symulator v3 - pelny model ekonomii + infrastruktury + wydarzen.

KLUCZOWE ZASADY (potwierdzone przez uzytkownika):
- Wieza: WLASNE 2 sloty (nie konkuruja z 3 bojowymi). Tylko jednostki w tych
  2 slotach: +2 HP, atak lad+powietrze (to drugie bez znaczenia w tym modelu,
  bo nie rozroznamy celow lad/powietrze).
- Kopalnia: WLASNY 1 slot, tylko jednostki humanoidalne (NON_HUMANOID zakazane).
  Produkcja: puste=1, humanoid bez specjalnej zdolnosci=3, Krasnolud(Gornik)=5,
  Emisariusz(Poborca, w Wiezy LUB Kopalni)=4. Zdolnosc jednostki nadpisuje baze.
- Koszary: WLASNE 2 sloty, kazda jednostka: brak akcji w turze wejscia, w
  nastepnej turze WLASCICIELA wykonuje 1 atak + 1 aktywacje zdolnosci (jesli ma
  aktywowalna zdolnosc, inaczej 2 atak-akcje), moze byc atakowana, potem
  odrzucona.
- Warownia: WLASNY 1 slot (zakaz dla NON_HUMANOID), brak akcji w turze wejscia,
  w nastepnej turze 2 dowolne akcje (atak i/lub zdolnosc, swobodnie), NIE moze
  byc atakowana, potem odrzucona.
- Start: 3 zlota. Jednostka 5 zl. Infrastruktura 7 zl (Wieza nieograniczona per
  gracz, Kopalnia/Koszary/Warownia: wspolna pula = liczba_graczy - 1).
- Wydarzenia: talia wspolna, 61 kart, kazda kosztuje 3 zl, tasowana zakryta.

UPROSZCZENIA (patrz komentarze przy kodzie): Mgla i Zamieszanie sa w tym
modelu efektywnie no-op (nie majace wplywu na wynik walki), "aktywacja
zdolnosci" w Koszarach/Warowni jest uproszczona do jednorazowego triggera
istniejacych efektow (heal/buff/draw), Goranowe Szczescie nie w pelni
rekurencyjnie rozpatruje efekt wymuszonej karty (tylko jej polaryzacje).
"""
import random
from cards import (UNITS, KINGDOMS, STARTING_GOLD, UNIT_COST, INFRA_COST,
                    EVENT_COST, CASTLE_HP_BY_PLAYERS, NON_HUMANOID, EVENTS,
                    TARGET_CATEGORY)

MAX_SLOTS_BASE = 3
STARTING_DECK_SIZE = 12  # domyslnie 12, testujemy tez wariant z 8
TOWER_SLOTS = 2
TOWER_HP_BONUS = 2
MAX_TURNS_TOTAL = 500
ACTIVATABLE_ABILITIES = ("dexterity", "heal_1", "heal_2", "buff_hp_1", "buff_hp_2", "team_atk_buff_1")


class UnitInstance:
    def __init__(self, name, hp_bonus=0, override_dtype=None):
        self.name = name
        base = UNITS[name]
        self.max_hp = base["hp"] + hp_bonus
        self.hp = base["hp"] + hp_bonus
        self.base_atk = base["atk"]
        self.dtype = override_dtype if override_dtype is not None else base["dtype"]  # co ta jednostka MOZE atakowac
        self.target_category = TARGET_CATEGORY.get(name, "land")  # czym jednostka JEST (kto moze ja trafic)
        self.abilities = list(base["abilities"])
        self.used_initiative = False
        self.temp_atk_bonus = 0
        self.passenger = None  # Zakorzenienie: jednostka "na Encie", dzieli slot

    def effective_atk(self, extra_temp=0):
        return self.base_atk + self.temp_atk_bonus + extra_temp

    def can_hit_category(self, target_cat):
        if self.dtype == "both":
            return True
        return self.dtype == target_cat or target_cat == "both"


class StoredUnit:
    """Jednostka w Koszarach lub Warowni (osobny cykl aktywacji)."""
    def __init__(self, unit, kind):
        self.unit = unit
        self.kind = kind          # "barracks" | "fortress"
        self.turns_here = 0        # 0 = tura wejscia (brak akcji)


class PlayerState:
    def __init__(self, kingdom_name, castle_hp, event_deck_ref, event_discard_ref, strategy="balanced"):
        self.kingdom_name = kingdom_name
        self.strategy = strategy   # "balanced" | "kingdom" | "event" | "infra"
        self.n_units_bought = 0
        self.n_events_bought = 0
        self.n_infra_bought = 0
        comp = KINGDOMS[kingdom_name]
        pool = []
        for unit, n in comp.items():
            pool.extend([unit] * n)
        random.shuffle(pool)
        self.deck = pool[:STARTING_DECK_SIZE]
        self.kingdom_buy_deck = pool[STARTING_DECK_SIZE:]
        random.shuffle(self.kingdom_buy_deck)
        self.discard = []
        self.hand = []
        self.board = [None] * MAX_SLOTS_BASE
        self.castle_hp = castle_hp
        self.max_castle_hp = castle_hp
        self.gold = STARTING_GOLD
        self.alive = True
        self.hp_bonus_permanent = 0   # Platnerz

        # infrastruktura - wlasne sloty
        self.tower = None            # None lub lista [UnitInstance|None]*2
        self.mine = None             # None lub [UnitInstance|None]
        self.barracks = None         # None lub [StoredUnit|None]*2
        self.fortress = None         # None lub [StoredUnit|None]

        self.mine_double_next_turn = False
        self.skip_turns = 0
        self.invulnerable_turns = 0
        self.pending_free_card = False
        self.held_events = []        # karty Wydarzen trzymane na reke do zagrania
        self.fog_shield = False      # Mgla - ochrona do wlasnej nastepnej tury
        self.last_attacked_by = None  # Msciciel - kto ostatnio zaatakowal (nazwa krolestwa)
        self.elim_turn = None  # w ktorej (globalnej) turze gracz zostal wyeliminowany
        self.ent_slot_granted = False       # Zakorzenienie - +1 slot raz na cala gre
        self.faun_elf_synergy_applied = False  # Spiew Natury
        self.emisariusz_discards_this_turn = 0  # Przywolanie
        self.pegaz_transport_used_this_turn = False  # Powietrzny Transport

        self.event_deck_ref = event_deck_ref
        self.event_discard_ref = event_discard_ref

    # ---------- pomocnicze ----------
    def board_units(self):
        return [u for u in self.board if u is not None]

    def total_deck_value(self):
        """Suma (HP+ATK) wszystkich kart jednostek, ktore gracz posiada
        (talia startowa + talia krolestwa + odrzucone + reka + plansza +
        infrastruktura) - proxy 'wartosci koncowej talii'."""
        total = 0
        for name in self.deck + self.kingdom_buy_deck + self.discard + self.hand:
            b = UNITS[name]
            total += b["hp"] + b["atk"]
        for u in self.board_units():
            total += u.max_hp + u.base_atk
        if self.tower:
            for u in self.tower:
                if u is not None:
                    total += u.max_hp + u.base_atk
        if self.mine and self.mine[0] is not None:
            total += self.mine[0].max_hp + self.mine[0].base_atk
        if self.barracks:
            for s in self.barracks:
                if s is not None:
                    total += s.unit.max_hp + s.unit.base_atk
        if self.fortress and self.fortress[0] is not None:
            total += self.fortress[0].unit.max_hp + self.fortress[0].unit.base_atk
        return total

    def all_combat_units(self):
        """Wszystkie jednostki mogace atakowac/byc atakowane w normalnym trybie
        (plansza + Wieza + Kopalnia). Koszary/Warownia obslugiwane osobno."""
        units = self.board_units()
        if self.tower:
            units += [u for u in self.tower if u is not None]
        if self.mine and self.mine[0] is not None:
            units += [self.mine[0]]
        return units

    def attackable_units(self):
        """To co przeciwnik moze wybrac jako cel (bez Warowni - niedostepna)."""
        units = self.board_units()
        if self.tower:
            units += [u for u in self.tower if u is not None]
        if self.mine and self.mine[0] is not None:
            units += [self.mine[0]]
        if self.barracks:
            units += [s.unit for s in self.barracks if s is not None]
        return units

    def has_any_units_anywhere(self):
        """Czy Krolestwo jest 'chronione' przed atakiem na zamek - liczy sie
        KAZDA jednostka, w tym w Warowni (ktora sama nie jest atakowalna, ale
        wg zasad WCIAZ blokuje atak na zamek: 'przeciwnik nie posiada zadnej
        jednostki w swoim obszarze gry ANI W INFRASTRUKTURZE')."""
        if self.attackable_units():
            return True
        if self.fortress and any(s is not None for s in self.fortress):
            return True
        return False

    def make_unit(self, name, in_tower=False):
        return UnitInstance(name, hp_bonus=(TOWER_HP_BONUS if in_tower else 0) + self.hp_bonus_permanent,
                             override_dtype=("both" if in_tower else None))

    def draw(self, n=1):
        for _ in range(n):
            if not self.deck:
                if not self.discard:
                    return
                self.deck = self.discard[:]
                random.shuffle(self.deck)
                self.discard = []
            self.hand.append(self.deck.pop())

    def empty_board_slot(self):
        for i, s in enumerate(self.board):
            if s is None:
                return i
        return None

    def priority_score(self, unit_name):
        u = UNITS[unit_name]
        score = u["atk"] * 1.5 + u["hp"] * 0.5
        board_size = len(self.board_units())
        for ab in u["abilities"]:
            if ab == "initiative":
                score += 3
            elif ab == "heal_1":
                score += 2
            elif ab == "heal_2":
                score += 3.5
            elif ab in ("buff_hp_1", "buff_hp_2"):
                score += 1 + board_size * 0.5
            elif ab == "team_atk_buff_1":
                score += 1 + board_size * 0.8
            elif ab == "rampage_extra_attack_on_kill":
                score += 2.5
            elif ab in ("combo_2_8dmg", "horde_3_double_combo"):
                score += 2
            elif ab == "krasnolud_katapulta":
                score += 2.5
            elif ab == "dexterity":
                score += 1.5
            elif ab == "death_kill_attacker":
                score += 1.5
            elif ab == "rebirth_on_discard":
                score += 1
            elif ab in ("synergy_faun_elf_hp1", "synergy_2ludzie_atk1"):
                score += 1
            elif ab == "path_expert":
                score += 1.5
        return score

    # ---------- ekonomia / dobor ----------
    def draw_or_gold_choice(self):
        if not self.hand:
            # Reka pusta - dobieramy zawsze, niezaleznie od strategii. Bez tego
            # gracz moze utkniac w petli: bierz zloto -> wydaj na jednostke
            # (ktora idzie na ODRZUCONE, nie na reke) -> zloto znow nizej progu
            # -> bierz zloto... i nigdy nie dobrac karty do zagrania.
            self.draw(2)
            return
        if self.strategy == "hazardzista":
            if random.random() < 0.5:
                self.gold += 2
            else:
                self.draw(2)
            return
        threshold = {"balanced": UNIT_COST, "kingdom": UNIT_COST + 2,
                     "event": EVENT_COST + 2, "infra": INFRA_COST,
                     "sabotage": UNIT_COST + 2, "protection": INFRA_COST,
                     "tank": INFRA_COST,
                     "zdobywca": UNIT_COST + 2, "architekt": INFRA_COST,
                     "kat": 0, "lowca_lidera": UNIT_COST,
                     "msciciel": UNIT_COST}.get(self.strategy, UNIT_COST)
        if self.gold < threshold:
            self.gold += 2
        else:
            self.draw(2)

    def start_turn_income(self):
        active_units = self.all_combat_units()
        for u in self.board_units():
            if u.passenger is not None:
                active_units.append(u.passenger)

        heal = 0
        dexterity_draws = 0
        for u in active_units:
            if "heal_1" in u.abilities:
                heal += 1
            if "heal_2" in u.abilities:
                heal += 2
            if "dexterity" in u.abilities:
                dexterity_draws += 1
        self.castle_hp = min(self.max_castle_hp, self.castle_hp + heal)
        if dexterity_draws:
            # Zreecznosc to REKURENCYJNY efekt: dopoki jednostka zyje w grze,
            # KAZDA swoja ture dobierasz +1 karte z talii startowej, NIEZALEZNIE
            # od normalnego wyboru dobierz2/wez2zlota. Poprzednio bylo to
            # blednie jednorazowe (tylko przy zagraniu), co realnie zubazalo
            # ekonomie kart kingdom-ow opartych na Faun/Ludzie/Pegaz.
            self.draw(dexterity_draws)

        names = [u.name for u in active_units]
        if names.count("Amazonka") >= 2:
            self.amazon_sisterly_oath()

        if self.mine and self.mine[0] is not None:
            u = self.mine[0]
            if "miner_bonus_gold" in u.abilities:
                income = 5
            elif "tax_collector_infra" in u.abilities:
                income = 4
            else:
                income = 3
        elif self.mine is not None:
            income = 1
        else:
            income = 0
        if self.mine_double_next_turn:
            income *= 3
            self.mine_double_next_turn = False
        self.gold += income

    def amazon_sisterly_oath(self):
        """Siostrzana Przysiega: przy 2 Amazonkach w grze - spojrz na 3
        wierzchnie karty talii startowej (koniec listy self.deck = wierzch,
        bo draw() robi .pop()). Najlepsza karte: NATYCHMIAST zagraj na
        plansze (jesli jest wolny slot), inaczej na reke. 1 odrzuc, 1
        z powrotem na wierzch."""
        if not self.deck:
            return
        n = min(3, len(self.deck))
        top_cards = self.deck[-n:]
        del self.deck[-n:]
        top_cards.sort(key=lambda c: self.priority_score(c), reverse=True)
        if top_cards:
            best = top_cards.pop(0)
            idx = self.empty_board_slot()
            if idx is not None:
                self.board[idx] = self.make_unit(best)
                self.on_play_effects(self.board[idx])
            else:
                self.hand.append(best)
        if top_cards:
            self.discard.append(top_cards.pop())
        for c in top_cards:
            self.deck.append(c)  # reszta (jesli byla) z powrotem na wierzch

    def play_phase(self):
        progressed = True
        while progressed:
            progressed = False
            idx = self.empty_board_slot()
            if idx is not None and self.hand:
                self.hand.sort(key=lambda c: self.priority_score(c), reverse=True)
                card = self.hand.pop(0)
                inst = self.make_unit(card)
                self.board[idx] = inst
                progressed = True
                self.on_play_effects(inst)
                continue
            # brak wolnego slotu - Zakorzenienie: dostaw pasazera na wolnego Enta
            if self.hand:
                host = next((u for u in self.board_units()
                             if u.name == "Ent" and u.passenger is None), None)
                if host is not None:
                    self.hand.sort(key=lambda c: self.priority_score(c), reverse=True)
                    card = self.hand.pop(0)
                    passenger = self.make_unit(card)
                    host.passenger = passenger
                    progressed = True
                    self.on_play_effects(passenger)

    def merge_krasnolud_pairs(self):
        """Katapulta: 2 Krasnoludy NA PLANSZY MOGA polaczyc sily w 1 jednostke
        (4 HP, 6 ATK, atak ladowy+powietrzny) - to jest OPCJONALNE ('MOGA'),
        nie automatyczne. Oplaca sie tylko gdy zwalnia potrzebny slot (plansza
        pelna) - inaczej 2 osobne Krasnoludy maja wiecej HP w sumie (6 vs 4)
        i moga atakowac 2 rozne cele, co jest lepsze gdy miejsca nie brakuje."""
        if len(self.board_units()) < MAX_SLOTS_BASE:
            return  # jest wolne miejsce - nie oplaca sie tracic HP/elastycznosci
        while True:
            idxs = [i for i, u in enumerate(self.board)
                    if u is not None and u.name == "Krasnolud"]
            if len(idxs) < 2:
                break
            i1, i2 = idxs[0], idxs[1]
            self.board[i1] = self.make_unit("Katapulta")
            self.board[i2] = None

    def all_units_in_play(self):
        """Jednostki na planszy + pasazerowie 'na Encie' (Zakorzenienie) -
        do synergii/buffow, ktore dotycza WSZYSTKICH jednostek w grze."""
        units = list(self.board_units())
        for u in self.board_units():
            if u.passenger is not None:
                units.append(u.passenger)
        return units

    def on_play_effects(self, inst):
        for ab in inst.abilities:
            if ab == "dexterity":
                self.draw(1)
            elif ab == "buff_hp_1":
                for u in self.all_units_in_play():
                    u.hp += 1
                    u.max_hp += 1
            elif ab == "buff_hp_2":
                for u in self.all_units_in_play():
                    u.hp += 2
                    u.max_hp += 2
            elif ab == "team_atk_buff_1":
                for u in self.all_units_in_play():
                    u.temp_atk_bonus += 1
        self.check_faun_elf_synergy()

    def check_faun_elf_synergy(self):
        """Spiew Natury (Elf Lesny): jesli Faun i Elf Lesny sa razem w grze,
        wszystkie jednostki dostaja +1 HP. Nie stackuje sie przy powtornym
        sprawdzeniu (flaga), ale moze ponownie zadzialac jesli warunek
        zniknie i wroci (np. po odrodzeniu)."""
        names = [u.name for u in self.all_units_in_play()]
        condition = "Faun" in names and "Elf Lesny" in names
        if condition and not self.faun_elf_synergy_applied:
            for u in self.all_units_in_play():
                u.hp += 1
                u.max_hp += 1
            self.faun_elf_synergy_applied = True
        elif not condition:
            self.faun_elf_synergy_applied = False

    def try_emisariusz_summon(self, unit_name):
        """Przywolanie: jesli dwaj Emisariusze En-sukud odrzuceni w tej samej
        turze, odzyskaj 1 karte z odrzuconych do reki, potem odrzuc 1 karte
        z reki."""
        if unit_name != "Emisariusz En-sukud":
            return
        self.emisariusz_discards_this_turn += 1
        if self.emisariusz_discards_this_turn == 2 and self.discard:
            self.discard.sort(key=lambda c: self.priority_score(c), reverse=True)
            recovered = self.discard.pop(0)
            self.hand.append(recovered)
            if self.hand:
                self.hand.sort(key=lambda c: self.priority_score(c))
                worst = self.hand.pop(0)
                self.discard.append(worst)

    def _backfill_mine_from_hand(self):
        """Po zwolnieniu Kopalni przez Zamieszanie: wsadz najslabsza karte
        z reki jako nowego 'ekonomiste' (dowolna - Kopalnia i tak da bazowa
        produkcje albo wiecej jesli akurat humanoid)."""
        if self.hand and self.mine is not None and self.mine[0] is None:
            self.hand.sort(key=lambda c: self.priority_score(c))
            card = self.hand.pop(0)
            self.mine[0] = self.make_unit(card)

    def try_reposition_unit(self, u):
        """Harpii Zryw / Galop: po zakonczeniu swojej tury jednostka moze
        przeniesc sie na dowolne wolne miejsce w obszarze gry - DOKLADNIE
        TA SAMA logika co Zamieszanie (przeniesienie do Wiezy/Koszar/
        Warowni jesli to korzystne), tylko ograniczona do JEDNEJ konkretnej
        jednostki i darmowa (bez karty z reki)."""
        board_idx = next((i for i, s in enumerate(self.board) if s is u), None)
        if board_idx is None:
            return False

        # -> Wieza (uniwersalny atak + 2 HP, jesli sie oplaca i nie NON_HUMANOID)
        if self.tower and u.name not in NON_HUMANOID:
            empty_tower = next((i for i, s in enumerate(self.tower) if s is None), None)
            if empty_tower is not None and self.priority_score(u.name) >= 3:
                self.board[board_idx] = None
                u.hp += TOWER_HP_BONUS
                u.max_hp += TOWER_HP_BONUS
                u.dtype = "both"
                self.tower[empty_tower] = u
                return True

        # -> Koszary (Cross Training, jesli jednostka ma uzyteczna zdolnosc)
        useful_abilities = set(ACTIVATABLE_ABILITIES) | {"rampage_extra_attack_on_kill",
                                                            "venom_spray_infra_or_direct"}
        if self.barracks is not None and any(a in useful_abilities for a in u.abilities):
            for i, slot in enumerate(self.barracks):
                if slot is None:
                    self.board[board_idx] = None
                    self.barracks[i] = StoredUnit(u, "barracks")
                    return True

        # -> Warownia (ochrona + 2 akcje za ture, jesli sie oplaca)
        if self.fortress is not None and self.fortress[0] is None and u.name not in NON_HUMANOID:
            if self.priority_score(u.name) >= 2:
                self.board[board_idx] = None
                self.fortress[0] = StoredUnit(u, "fortress")
                return True

        return False

    def try_zamieszanie(self):
        """Zamieszanie: w KAZDYM przypadku, gdzie gracz ma z tego realna
        korzysc, przemieszcza jednostke miedzy plansza/Kopalnia/Wieza/
        Koszarami/Warownia (zamieniajac ja z karta z reki lub inna
        jednostka). Sprawdzane w kolejnosci wartosci oczekiwanej:
        1) silny atakujacy z planszy -> wolny slot Wiezy (+2 HP, atak
           uniwersalny - najwieksza pojedyncza korzysc w grze),
        2) Krasnolud w Kopalni + Krasnolud na planszy -> zwolnij do merge,
        3) jednostka z uzyteczna zdolnoscia w Kopalni -> Koszary (Cross
           Training podwaja jej ATK i dzieli zdolnosci),
        4) dobry atakujacy zamarowany w Kopalni -> plansza,
        5) bezuzyteczny filler na planszy -> Kopalnia (pusta), zwalniajac
           slot na plansze pod lepsza karte,
        6) solidna jednostka na planszy -> wolna Warownia (ochrona +
           podwojna akcja za ture, gdy nie jest potrzebna do obrony teraz).
        """
        if "Zamieszanie" not in self.held_events:
            return False

        # 1) plansza -> Wieza (jesli jest wolny slot i cos wartego przeniesc)
        if self.tower:
            empty_tower = next((i for i, s in enumerate(self.tower) if s is None), None)
            if empty_tower is not None:
                board_candidates = [u for u in self.board_units()
                                     if u.name not in NON_HUMANOID and self.priority_score(u.name) >= 3]
                if board_candidates:
                    best = max(board_candidates, key=lambda u: self.priority_score(u.name))
                    for bi, s in enumerate(self.board):
                        if s is best:
                            self.board[bi] = None
                            break
                    best.hp += TOWER_HP_BONUS
                    best.max_hp += TOWER_HP_BONUS
                    best.dtype = "both"
                    self.tower[empty_tower] = best
                    self.held_events.remove("Zamieszanie")
                    return True

        if self.mine and self.mine[0] is not None:
            u = self.mine[0]

            # 2) Krasnolud w Kopalni + Krasnolud na planszy -> zwolnij do merge
            if u.name == "Krasnolud" and any(b is not None and b.name == "Krasnolud" for b in self.board):
                idx = self.empty_board_slot()
                if idx is not None:
                    self.board[idx] = u
                    self.mine[0] = None
                    self._backfill_mine_from_hand()
                    self.held_events.remove("Zamieszanie")
                    return True

            # 3) jednostka z uzyteczna zdolnoscia -> Koszary (Cross Training)
            useful_abilities = set(ACTIVATABLE_ABILITIES) | {"rampage_extra_attack_on_kill",
                                                                "venom_spray_infra_or_direct"}
            if self.barracks is not None and any(a in useful_abilities for a in u.abilities):
                for i, slot in enumerate(self.barracks):
                    if slot is None:
                        self.barracks[i] = StoredUnit(u, "barracks")
                        self.mine[0] = None
                        self._backfill_mine_from_hand()
                        self.held_events.remove("Zamieszanie")
                        return True

            # 4) dobry atakujacy zamarowany w Kopalni -> uwolnij na plansze
            if self.priority_score(u.name) >= 3:
                idx = self.empty_board_slot()
                if idx is not None:
                    self.board[idx] = u
                    self.mine[0] = None
                    self._backfill_mine_from_hand()
                    self.held_events.remove("Zamieszanie")
                    return True

        # 5) bezuzyteczny filler na planszy -> pusta Kopalnia (zysk ekonomii)
        if self.mine is not None and self.mine[0] is None:
            weak_board = [u for u in self.board_units()
                          if u.name not in NON_HUMANOID and self.priority_score(u.name) <= 1]
            if weak_board:
                u = min(weak_board, key=lambda u: self.priority_score(u.name))
                for bi, s in enumerate(self.board):
                    if s is u:
                        self.board[bi] = None
                        break
                self.mine[0] = u
                self.held_events.remove("Zamieszanie")
                return True

        # 6) solidna jednostka z planszy -> wolna Warownia (ochrona + 2 akcje)
        if self.fortress is not None and self.fortress[0] is None:
            board_candidates = [u for u in self.board_units()
                                 if u.name not in NON_HUMANOID and self.priority_score(u.name) >= 2]
            if board_candidates:
                best = max(board_candidates, key=lambda u: self.priority_score(u.name))
                for bi, s in enumerate(self.board):
                    if s is best:
                        self.board[bi] = None
                        break
                self.fortress[0] = StoredUnit(best, "fortress")
                self.held_events.remove("Zamieszanie")
                return True

        return False

    def try_pegaz_transport(self, mine_pool, fortress_pool):
        """Powietrzny Transport (Pegaz): raz na ture przenosi jedna wlasna
        jednostke z planszy do wolnego slotu infrastruktury (Wieza - kazda
        jednostka; Kopalnia/Warownia - tylko humanoidalna). Uzywane gdy jest
        sensowny cel i wolny slot."""
        if self.pegaz_transport_used_this_turn:
            return
        if not any(u.name == "Pegaz" for u in self.board_units()):
            return
        candidates = [u for u in self.board_units() if u.name != "Pegaz"]
        if not candidates:
            return
        candidates.sort(key=lambda u: u.base_atk + u.max_hp, reverse=True)

        def move_to(dest_list_getter, needs_humanoid, wrap_stored=False):
            for u in candidates:
                if needs_humanoid and u.name in NON_HUMANOID:
                    continue
                slot_list = dest_list_getter()
                if slot_list is None:
                    continue
                for i, occ in enumerate(slot_list):
                    if occ is None:
                        for bi, s in enumerate(self.board):
                            if s is u:
                                self.board[bi] = None
                        if slot_list is self.tower:
                            u.hp += TOWER_HP_BONUS
                            u.max_hp += TOWER_HP_BONUS
                            u.dtype = "both"
                        slot_list[i] = StoredUnit(u, "fortress") if wrap_stored else u
                        self.pegaz_transport_used_this_turn = True
                        return True
            return False

        if move_to(lambda: self.tower, True):
            return
        if move_to(lambda: self.mine, True):
            return
        if move_to(lambda: self.fortress, True, wrap_stored=True):
            return

    def conditional_synergy_atk_bonus(self):
        names = [u.name for u in self.all_units_in_play()]
        bonus = 0
        if names.count("Ludzie") >= 2:
            bonus += 1
        return bonus

    def _discard_name(self, name):
        if name == "Katapulta":
            self.discard.append("Krasnolud")
            self.discard.append("Krasnolud")
        else:
            self.discard.append(name)
            self.try_emisariusz_summon(name)

    def _maybe_rebirth(self, unit_inst, by_opponent):
        """Powstanie z popiolow: jesli jednostka z rebirth_on_discard zostala
        odrzucona PRZEZ PRZECIWNIKA, natychmiast dobierz nastepna karte z
        talii startowej i zwroc nowa jednostke do umieszczenia na jej
        miejscu. Dziala niezaleznie od tego, GDZIE jednostka stala (plansza,
        Wieza, Kopalnia, Koszary) - karta nie mowi, ze to dotyczy tylko
        planszy."""
        if not (by_opponent and "rebirth_on_discard" in unit_inst.abilities):
            return None
        if not self.deck and self.discard:
            self.deck = self.discard[:]
            random.shuffle(self.deck)
            self.discard = []
        if self.deck:
            newcard = self.deck.pop()
            return self.make_unit(newcard)
        return None

    def remove_unit_from_board(self, unit_inst, by_opponent=True):
        for i, s in enumerate(self.board):
            if s is unit_inst:
                self.board[i] = None
                self._discard_name(unit_inst.name)
                if unit_inst.passenger is not None:
                    # Zakorzenienie: gdy pada Ent, pasazer idzie na odrzucone razem z nim
                    self._discard_name(unit_inst.passenger.name)
                    unit_inst.passenger = None
                reborn = self._maybe_rebirth(unit_inst, by_opponent)
                if reborn is not None:
                    self.board[i] = reborn
                return True
        return False

    def remove_unit_anywhere(self, unit_inst, by_opponent=True):
        """Usuwa jednostke z planszy / Wiezy / Kopalni / Koszar (nie Warowni)."""
        if self.remove_unit_from_board(unit_inst, by_opponent=by_opponent):
            return
        for host in self.board_units():
            if host.passenger is unit_inst:
                self._discard_name(unit_inst.name)
                host.passenger = None
                return
        if self.tower:
            for i, u in enumerate(self.tower):
                if u is unit_inst:
                    self.tower[i] = None
                    self._discard_name(unit_inst.name)
                    reborn = self._maybe_rebirth(unit_inst, by_opponent)
                    if reborn is not None:
                        reborn.hp += TOWER_HP_BONUS
                        reborn.max_hp += TOWER_HP_BONUS
                        reborn.dtype = "both"
                        self.tower[i] = reborn
                    return
        if self.mine and self.mine[0] is unit_inst:
            self.mine[0] = None
            self._discard_name(unit_inst.name)
            reborn = self._maybe_rebirth(unit_inst, by_opponent)
            if reborn is not None:
                self.mine[0] = reborn
            return
        if self.barracks:
            for i, s in enumerate(self.barracks):
                if s is not None and s.unit is unit_inst:
                    self.barracks[i] = None
                    self._discard_name(unit_inst.name)
                    reborn = self._maybe_rebirth(unit_inst, by_opponent)
                    if reborn is not None:
                        self.barracks[i] = StoredUnit(reborn, "barracks")
                    return

    # ---------- kupowanie ----------
    def _try_buy_infra(self, mine_pool, barracks_pool, fortress_pool):
        if self.gold < INFRA_COST:
            return False
        if self.tower is None:
            self.gold -= INFRA_COST
            self.tower = [None, None]
            self.n_infra_bought += 1
            return True
        if self.mine is None and mine_pool[0] > 0:
            self.gold -= INFRA_COST
            self.mine = [None]
            mine_pool[0] -= 1
            self.n_infra_bought += 1
            return True
        if self.fortress is None and fortress_pool[0] > 0:
            self.gold -= INFRA_COST
            self.fortress = [None]
            fortress_pool[0] -= 1
            self.n_infra_bought += 1
            return True
        if self.barracks is None and barracks_pool[0] > 0:
            self.gold -= INFRA_COST
            self.barracks = [None, None]
            barracks_pool[0] -= 1
            self.n_infra_bought += 1
            return True
        return False

    def _try_buy_infra_protective(self, mine_pool, barracks_pool, fortress_pool):
        """Wariant dla strategii 'ochrona' - Warownia (jednostka niedostepna
        dla atakow przeciwnika) ma najwyzszy priorytet, potem Wieza."""
        if self.fortress is None and fortress_pool[0] > 0 and self.gold >= INFRA_COST:
            self.gold -= INFRA_COST
            self.fortress = [None]
            fortress_pool[0] -= 1
            self.n_infra_bought += 1
            return True
        tower_cost = INFRA_COST
        if self.tower is None and self.gold >= tower_cost:
            self.gold -= tower_cost
            self.tower = [None, None]
            self.n_infra_bought += 1
            return True
        if self.gold < INFRA_COST:
            return False
        if self.mine is None and mine_pool[0] > 0:
            self.gold -= INFRA_COST
            self.mine = [None]
            mine_pool[0] -= 1
            self.n_infra_bought += 1
            return True
        if self.barracks is None and barracks_pool[0] > 0:
            self.gold -= INFRA_COST
            self.barracks = [None, None]
            barracks_pool[0] -= 1
            self.n_infra_bought += 1
            return True
        return False

    def _has_tropiciel(self):
        return any(u.name == "Lesny Tropiciel" for u in self.board_units())

    def _try_buy_unit(self):
        if self.gold >= UNIT_COST and self.kingdom_buy_deck:
            self.gold -= UNIT_COST
            if self._has_tropiciel() and len(self.kingdom_buy_deck) >= 2:
                c1 = self.kingdom_buy_deck.pop()
                c2 = self.kingdom_buy_deck.pop()
                if self.priority_score(c1) >= self.priority_score(c2):
                    bought_card, other = c1, c2
                else:
                    bought_card, other = c2, c1
                self.kingdom_buy_deck.insert(0, other)  # na spod talii
            else:
                bought_card = self.kingdom_buy_deck.pop()
            self.discard.append(bought_card)
            self.n_units_bought += 1
            return True
        return False

    def _try_buy_event(self):
        if self.gold >= EVENT_COST and self.event_deck_ref:
            self.gold -= EVENT_COST
            self.buy_event()
            self.n_events_bought += 1
            return True
        return False

    def buy_phase(self, mine_pool, barracks_pool, fortress_pool):
        # Kolejnosc priorytetow zalezna od forsowanej strategii. Gracze
        # forsujacy strategie NIE kupuja innych kategorii (maksymalizacja
        # kosztem krotkoterminowej optymalizacji), poza przypadkiem gdy pula
        # ich kategorii sie wyczerpala (wowczas po prostu przestaja kupowac).
        bought = True
        while bought:
            bought = False
            if self.strategy == "kingdom":
                bought = self._try_buy_unit()
            elif self.strategy == "event":
                bought = self._try_buy_event()
            elif self.strategy == "infra":
                bought = self._try_buy_infra(mine_pool, barracks_pool, fortress_pool)
            elif self.strategy == "sabotage":
                # buduje armie jak 'kingdom' - jego przewaga jest w tym, KOGO
                # i CO atakuje (patrz pick_target_for_unit), nie w zakupach
                bought = self._try_buy_unit()
            elif self.strategy == "protection":
                bought = self._try_buy_infra_protective(mine_pool, barracks_pool, fortress_pool)
            elif self.strategy == "tank":
                # stackowanie sie tankami: Wieza (+2 HP) i Warownia (ochrona)
                # najwyzszy priorytet zakupowy, dla przetrwania - ale ATAKUJE
                # NORMALNIE jak kazdy inny (tankowanie != pasywnosc)
                bought = (self._try_buy_infra_protective(mine_pool, barracks_pool, fortress_pool)
                          or self._try_buy_unit())
            elif self.strategy == "zdobywca":
                # bezwzgledny zdobywca: caly zlot na jednostki, nigdy nie
                # oszczedza na pozniej
                bought = self._try_buy_unit()
            elif self.strategy == "architekt":
                # cierpliwy strateg: ekonomia/infrastruktura ponad wszystko
                bought = self._try_buy_infra(mine_pool, barracks_pool, fortress_pool)
            elif self.strategy == "kat":
                # kat startowy: nigdy nie dokupuje kart z talii krolestwa
                # (ani infry, ani wydarzen) - czysta presja z reki
                bought = False
            elif self.strategy in ("lowca_lidera", "msciciel"):
                # neutralne zakupy - ich przewaga jest w CELOWANIU, nie zakupach
                bought = (self._try_buy_infra(mine_pool, barracks_pool, fortress_pool)
                          or self._try_buy_unit()
                          or self._try_buy_event())
            elif self.strategy == "hazardzista":
                # nieprzewidywalne zakupy - losowa kategoria kazda tura
                choice = random.choice(["infra", "unit", "event"])
                if choice == "infra":
                    bought = self._try_buy_infra(mine_pool, barracks_pool, fortress_pool)
                elif choice == "unit":
                    bought = self._try_buy_unit()
                else:
                    bought = self._try_buy_event()
            else:  # balanced
                bought = (self._try_buy_infra(mine_pool, barracks_pool, fortress_pool)
                          or self._try_buy_unit()
                          or self._try_buy_event())

    def assign_infra_from_hand(self):
        if not self.hand:
            return
        self.hand.sort(key=lambda c: self.priority_score(c), reverse=True)
        # Wieza (2 sloty, zakaz NON_HUMANOID jak Kopalnia/Warownia)
        if self.tower is not None:
            for i in range(TOWER_SLOTS):
                if self.tower[i] is None and self.hand:
                    for idx, card in enumerate(self.hand):
                        if card not in NON_HUMANOID:
                            self.tower[i] = self.make_unit(self.hand.pop(idx), in_tower=True)
                            self.on_play_effects(self.tower[i])
                            break
        # Kopalnia (1 slot, tylko humanoid)
        if self.mine is not None and self.mine[0] is None:
            for idx, card in enumerate(self.hand):
                if card not in NON_HUMANOID:
                    self.mine[0] = self.make_unit(card)
                    self.hand.pop(idx)
                    break
        # Warownia (1 slot, tylko humanoid)
        if self.fortress is not None and self.fortress[0] is None:
            for idx, card in enumerate(self.hand):
                if card not in NON_HUMANOID:
                    self.fortress[0] = StoredUnit(self.make_unit(card), "fortress")
                    self.hand.pop(idx)
                    break
        # Koszary (2 sloty, dowolna jednostka)
        if self.barracks is not None:
            for i in range(2):
                if self.barracks[i] is None and self.hand:
                    card = self.hand.pop(0)
                    self.barracks[i] = StoredUnit(self.make_unit(card), "barracks")

    def buy_event(self):
        if self._has_tropiciel() and len(self.event_deck_ref) >= 2:
            c1 = self.event_deck_ref.pop()
            c2 = self.event_deck_ref.pop()
            pol1, pol2 = EVENTS[c1][1], EVENTS[c2][1]
            if pol1 == "positive" and pol2 != "positive":
                name, other = c1, c2
            elif pol2 == "positive" and pol1 != "positive":
                name, other = c2, c1
            else:
                name, other = c1, c2
            self.event_deck_ref.insert(0, other)  # na spod talii
        else:
            name = self.event_deck_ref.pop()
        polarity, tag = EVENTS[name][1], EVENTS[name][2]
        if tag in ("noop_fog", "noop_reposition", "alchemist_free_unit_buff4",
                   "destroy_weakest_enemy_infra"):
            self.held_events.append(name)
        else:
            self.event_discard_ref.append(name)
            resolve_event_immediate(self, name, tag)


def resolve_event_immediate(owner, name, tag):
    """Efekty rozpatrywane natychmiast po kupieniu (nie trzymane na reke)."""
    if tag == "buff_hp_all_permanent_1":
        owner.hp_bonus_permanent += 1
        for u in owner.all_combat_units():
            u.hp += 1
            u.max_hp += 1
    elif tag == "silver_head_warrior":
        # Wojownik Srebrnych Glow: wybierz jednostke W OBSZARZE GRY (plansza,
        # Wieza, Koszary, Warownia - wszedzie gdzie jednostka moze atakowac),
        # moze JEDNORAZOWO skorzystac z Uzdrowienia/Zrecznosci/Inicjatywy/
        # Szarzy (nawet jesli normalnie tej zdolnosci nie ma). Szczegolnie
        # silne na jednostce w Koszarach (Cross Training juz podwaja ATK -
        # dodatkowa Szarza to kolejny darmowy atak na wierzchu tego).
        # Priorytet: Szarza (najwiekszy zysk bojowy) > Inicjatywa (jesli
        # jednostka jeszcze nie atakowala) > Zrecznosc+Uzdrowienie (fallback).
        candidates = list(owner.board_units())
        if owner.tower:
            candidates += [u for u in owner.tower if u is not None]
        if owner.barracks:
            candidates += [s.unit for s in owner.barracks if s is not None]
        if owner.fortress:
            candidates += [s.unit for s in owner.fortress if s is not None]
        if candidates:
            best = max(candidates, key=lambda u: owner.priority_score(u.name))
            if "rampage_extra_attack_on_kill" not in best.abilities:
                best.abilities = list(best.abilities) + ["rampage_extra_attack_on_kill"]
            elif not best.used_initiative and "initiative" not in best.abilities:
                best.abilities = list(best.abilities) + ["initiative"]
            else:
                owner.draw(1)
                owner.castle_hp = min(owner.max_castle_hp, owner.castle_hp + 1)
    elif tag == "double_atk_this_turn":
        owner._double_atk_flag = True
    elif tag == "goblin_mine_plus3":
        owner._goblin_income = getattr(owner, "_goblin_income", 0) + 3
    elif tag == "get_fortress_cheap":
        owner._pending_infra_grant = "fortress"
    elif tag == "get_barracks_cheap":
        owner._pending_infra_grant = "barracks"
    elif tag == "get_mine_cheap":
        owner._pending_infra_grant = "mine"
    elif tag == "opponents_pay_you_2":
        owner._pending_tax = True
    elif tag == "heal_all_3":
        owner._pending_heal_all = True
    elif tag == "skip_next_player":
        owner._pending_skip_next_player = True
    elif tag == "aoe_castle_dmg_5":
        owner._pending_aoe_dmg = True
    elif tag == "triple_mine_next_turn":
        owner.mine_double_next_turn = True
    elif tag == "skip_turn_then_free_card":
        owner.skip_turns = max(owner.skip_turns, 1)
        owner.pending_free_card = True
    elif tag == "discard_2_units":
        units = owner.board_units()
        for u in units[:2]:
            owner.remove_unit_from_board(u, by_opponent=False)
    elif tag == "gain_munmaa":
        owner.hand.append("Munmaa")
    elif tag == "skip_turn_plain":
        owner.skip_turns = max(owner.skip_turns, 1)
    elif tag == "skip_2_turns_then_gold6":
        owner.skip_turns = max(owner.skip_turns, 2)
        owner.invulnerable_turns = max(owner.invulnerable_turns, 2)
        owner._pending_gold3_after_skip = True
    elif tag == "goranowe_szczescie":
        owner._pending_goranowe = True
    # noop_fog / noop_reposition / alchemist / zasadzka -> trzymane na reke


def resolve_held_event(owner, name, players, active_target):
    tag = EVENTS[name][2]
    if tag == "noop_fog":
        # POPRAWKA: Mgla realnie chroni - zagrana na starcie swojej tury,
        # chroni Krolestwo i jednostki wlasciciela przed atakami wszystkich
        # przeciwnikow AZ DO momentu, gdy znow nadejdzie jego wlasna tura
        # (pelny "obieg" stolu, jak w Monopoly - nie tylko biezaca akcja).
        owner.fog_shield = True
        return
    if tag == "noop_reposition":
        return  # bez wplywu na wynik walki w tym modelu (brak pozycji)
    if tag == "alchemist_free_unit_buff4":
        if owner.deck or owner.discard:
            if not owner.deck:
                owner.deck = owner.discard[:]
                random.shuffle(owner.deck)
                owner.discard = []
            if owner.deck:
                card = owner.deck.pop()
                idx = owner.empty_board_slot()
                if idx is not None:
                    inst = owner.make_unit(card)
                    inst.hp += 4
                    inst.max_hp += 4
                    owner.board[idx] = inst
                    owner.on_play_effects(inst)
    elif tag == "destroy_weakest_enemy_infra":
        alive_opp = [p for p in players if p is not owner and p.alive]
        candidates = []
        for p in alive_opp:
            if p.tower:
                candidates += [(u, p) for u in p.tower if u is not None]
            if p.mine and p.mine[0] is not None:
                candidates.append((p.mine[0], p))
            if p.barracks:
                candidates += [(s.unit, p) for s in p.barracks if s is not None]
        if candidates:
            unit, owner_p = min(candidates, key=lambda t: t[0].hp)
            owner_p.remove_unit_anywhere(unit)


def apply_pending_flags(active, players, active_idx, mine_pool, barracks_pool, fortress_pool):
    """Rozpatruje efekty odlozone (natychmiastowe eventy oddzialujace na innych)."""
    if getattr(active, "_pending_tax", False):
        for p in players:
            if p is not active and p.alive:
                if p.gold >= 2:
                    p.gold -= 2
                    active.gold += 2
                else:
                    p.skip_turns = max(p.skip_turns, 1)
        active._pending_tax = False

    if getattr(active, "_pending_heal_all", False):
        for p in players:
            if p.alive:
                p.castle_hp = min(p.max_castle_hp, p.castle_hp + 3)
        active._pending_heal_all = False

    if getattr(active, "_pending_skip_next_player", False):
        n = len(players)
        for offset in range(1, n + 1):
            nxt = players[(active_idx + offset) % n]
            if nxt.alive:
                nxt.skip_turns = max(nxt.skip_turns, 1)
                break
        active._pending_skip_next_player = False

    if getattr(active, "_pending_aoe_dmg", False):
        for p in players:
            if p.alive:
                p.castle_hp -= 5
        active._pending_aoe_dmg = False

    if getattr(active, "_pending_infra_grant", None):
        kind = active._pending_infra_grant
        if kind == "fortress" and active.fortress is None and fortress_pool[0] > 0:
            active.fortress = [None]
            fortress_pool[0] -= 1
        elif kind == "barracks" and active.barracks is None and barracks_pool[0] > 0:
            active.barracks = [None, None]
            barracks_pool[0] -= 1
        elif kind == "mine" and active.mine is None and mine_pool[0] > 0:
            active.mine = [None]
            mine_pool[0] -= 1
        active._pending_infra_grant = None

    if getattr(active, "_pending_gold3_after_skip", False) and active.skip_turns == 0:
        active.gold += 6
        active._pending_gold3_after_skip = False

    if getattr(active, "pending_free_card", False) and active.skip_turns == 0:
        if active.kingdom_buy_deck:
            active.hand.append(active.kingdom_buy_deck.pop())
        active.pending_free_card = False

    if getattr(active, "_pending_goranowe", False):
        n = len(players)
        for offset in range(1, n + 1):
            nxt = players[(active_idx + offset) % n]
            if nxt.alive:
                if active.event_deck_ref:
                    drawn = active.event_deck_ref.pop()
                    polarity = EVENTS[drawn][1]
                    active.event_discard_ref.append(drawn)
                    if polarity == "positive":
                        active.gold += 10
                    else:
                        active.skip_turns = max(active.skip_turns, 1)
                break
        active._pending_goranowe = False


def resolve_attack(attacker_unit, target_state, extra_atk_bonus=0, attacker_kingdom=None):
    all_targets = target_state.attackable_units()
    protected_by_fortress = (not all_targets) and target_state.has_any_units_anywhere()
    atk_value = attacker_unit.effective_atk(extra_atk_bonus)
    if not attacker_unit.used_initiative and "initiative" in attacker_unit.abilities:
        atk_value += 2
        attacker_unit.used_initiative = True

    if protected_by_fortress:
        return False  # jednostka bezpieczna w Warowni wciaz chroni zamek

    if all_targets:
        # jesli przeciwnik MA jednostki w grze, nie mozna bic zamku - nawet
        # jesli zaden cel nie jest kompatybilny typem (atak wtedy przepada)
        targets = [t for t in all_targets if attacker_unit.can_hit_category(t.target_category)]
        if not targets:
            return False  # atak zmarnowany - brak kompatybilnego celu
        if attacker_kingdom is not None:
            target_state.last_attacked_by = attacker_kingdom
        killable = [t for t in targets if t.hp <= atk_value]
        if killable:
            def kill_priority(t):
                # sabotaz ekonomiczny: priorytet dobicia jednostki boostujacej
                # zlot przeciwnika w Kopalni (denial dochodu przed jego tura)
                is_econ_miner = (target_state.mine and target_state.mine[0] is t
                                  and any(a in t.abilities for a in ("miner_bonus_gold", "tax_collector_infra")))
                return (0 if is_econ_miner else 1, t.hp)
            target = min(killable, key=kill_priority)
        else:
            target = max(targets, key=lambda t: t.effective_atk())
        target.hp -= atk_value
        killed = target.hp <= 0
        if killed:
            if "death_kill_attacker" in target.abilities:
                attacker_unit.hp = 0
            target_state.remove_unit_anywhere(target)
        return killed and "rampage_extra_attack_on_kill" in attacker_unit.abilities
    else:
        if attacker_kingdom is not None:
            target_state.last_attacked_by = attacker_kingdom
        target_state.castle_hp -= atk_value
        return False


def combo_attacks(state, target_state):
    units = state.board_units()
    used = set()

    def apply_combo_damage(attackers, dmg):
        target_state.last_attacked_by = state.kingdom_name
        targets = target_state.attackable_units()
        if targets:
            # obrazenia MOZNA podzielic miedzy kilka celow - dobijamy od
            # najslabszego, zeby zmaksymalizowac liczbe zabitych jednostek
            remaining = dmg
            ordered = sorted(targets, key=lambda t: t.hp)
            alive_attackers = list(attackers)
            for t in ordered:
                if remaining <= 0:
                    break
                spend = min(remaining, t.hp)
                t.hp -= spend
                remaining -= spend
                if t.hp <= 0:
                    if "death_kill_attacker" in t.abilities and alive_attackers:
                        # Szal Bitewny dziala rowniez przy atakach lączonych -
                        # ginie TYLKO jednostka o nizszym HP z grupy atakujacej
                        retaliated = min(alive_attackers, key=lambda a: a.hp)
                        retaliated.hp = 0
                        alive_attackers.remove(retaliated)
                    target_state.remove_unit_anywhere(t)
        elif not target_state.has_any_units_anywhere():
            target_state.castle_hp -= dmg
        # inaczej: ktos bezpieczny w Warowni, atak zmarnowany

    def should_use_combo(group):
        """Combo jest OPCJONALNE (karty mowia 'MOGA'). Uzywamy go tylko gdy
        daje realna wartosc: przeciwnik nie ma jednostek (bezpieczne
        obrazenia w zamek) LUB co najmniej jedna jednostka z grupy nie
        mialaby czym trafic indywidualnie (typ celu) - combo zawsze trafia
        (dziala jak 'oba'). W przeciwnym razie lepiej zaatakowac
        indywidualnie (wiecej celow, wiecej elastycznosci) niz wiazac sie
        jednym, skoncentrowanym atakiem. Hazardzista: zawsze probuje."""
        if state.strategy == "hazardzista":
            return True
        targets = target_state.attackable_units()
        if not targets:
            return not target_state.has_any_units_anywhere()
        return any(not any(u.can_hit_category(t.target_category) for t in targets)
                   for u in group)

    def try_combo(ability, need, dmg):
        cands = [u for u in units if ability in u.abilities and id(u) not in used]
        if len(cands) >= need:
            group = cands[:need]
            if should_use_combo(group):
                for u in group:
                    used.add(id(u))
                apply_combo_damage(group, dmg)

    try_combo("combo_2_8dmg", 2, 8)
    orks = [u for u in units if "horde_3_double_combo" in u.abilities and id(u) not in used]
    if len(orks) >= 2:
        group = orks[:2]
        if should_use_combo(group):
            for u in group:
                used.add(id(u))
            dmg = sum(u.effective_atk() for u in group) * 2
            apply_combo_damage(group, dmg)
    return used


def _do_single_action_attack(u, active, players, abilities_override=None, double=False):
    """Wykonuje 1 atak jednostki u, opcjonalnie z podmienionym zestawem
    zdolnosci (Cross Training - wspolna pula zdolnosci pary) i/lub podwojonym
    ATK (Cross Training). Zwraca True jesli doszlo do rampage (Szarzy)."""
    original_abilities = u.abilities
    if abilities_override is not None:
        u.abilities = list(abilities_override)
    try:
        if u.hp <= 0:
            return False
        tgt = pick_target_for_unit(u, active, players)
        if tgt is None:
            return False
        if "venom_spray_infra_or_direct" in u.abilities and try_venom_spray(active, u, tgt):
            return False
        extra = u.effective_atk() if double else 0  # podwojenie: dodajemy raz jeszcze wlasny ATK
        rampage = resolve_attack(u, tgt, extra, attacker_kingdom=active.kingdom_name)
        if rampage and u.hp > 0 and should_use_rampage(u, active, players):
            tgt2 = pick_target_for_unit(u, active, players)
            if tgt2 is not None:
                resolve_attack(u, tgt2, extra, attacker_kingdom=active.kingdom_name)
            active.remove_unit_anywhere(u, by_opponent=False)
        return rampage
    finally:
        u.abilities = original_abilities


def activate_stored_units(active, players, atk_bonus):
    """Warownia: jednostka czeka 1 ture, potem wykonuje 2 DOWOLNE-TEGO-SAMEGO-
    TYPU akcje: 2x zdolnosc (jesli ma aktywowalna) ALBO 2 ataki (bez mieszania).
    Niedostepna dla atakow przeciwnika.

    Koszary: 2 sloty, KAZDY moze byc atakowany przez przeciwnika. Gdy OBIE
    jednostki sa jednoczesnie gotowe (po turze wejscia), aktywuje sie Cross
    Training: kazda z nich atakuje z PODWOJONYM wlasnym ATK i ma dostep do
    WSPOLNEJ PULY zdolnosci obu kart (np. Lucznik moze skorzystac z Szarzy
    Centaura, Nagual moze uzyc Jadowitego Prysku Wyverna) - a nastepnie OBIE
    trafiaja na odrzucone RAZEM (jednoczesnie, w tej samej turze - to ma
    znaczenie np. dla Przywolania Emisariusza En-sukud). Jesli w Koszarach
    jest tylko JEDNA gotowa jednostka (brak partnera), dziala normalnie -
    bez podwojenia ATK i bez wspoldzielenia zdolnosci."""
    # --- Warownia ---
    if active.fortress:
        for i, stored in enumerate(active.fortress):
            if stored is None:
                continue
            stored.turns_here += 1
            if stored.turns_here == 1:
                continue  # tura wejscia - brak akcji
            u = stored.unit
            activatable = [a for a in u.abilities if a in ACTIVATABLE_ABILITIES]
            if activatable:
                active.on_play_effects(u)
                if u.hp > 0:
                    active.on_play_effects(u)  # 2x zdolnosc
            else:
                for _ in range(2):
                    if u.hp <= 0:
                        break
                    tgt = pick_target_for_unit(u, active, players)
                    if tgt is None:
                        break
                    if "venom_spray_infra_or_direct" in u.abilities and try_venom_spray(active, u, tgt):
                        break
                    resolve_attack(u, tgt, 0, attacker_kingdom=active.kingdom_name)
            active.fortress[i] = None
            active._discard_name(u.name)

    # --- Koszary (Cross Training) ---
    if active.barracks:
        occupied = [(i, s) for i, s in enumerate(active.barracks) if s is not None]
        for _, stored in occupied:
            stored.turns_here += 1
        ready = [(i, s) for i, s in occupied if s.turns_here >= 2]

        if len(ready) == 2:
            (i1, s1), (i2, s2) = ready
            u1, u2 = s1.unit, s2.unit
            shared = set(u1.abilities) | set(u2.abilities)
            _do_single_action_attack(u1, active, players, abilities_override=shared, double=True)
            _do_single_action_attack(u2, active, players, abilities_override=shared, double=True)
            # Cross Training: obie karty odrzucane RAZEM, w tej samej turze
            active.barracks[i1] = None
            active.barracks[i2] = None
            active._discard_name(u1.name)
            active._discard_name(u2.name)
        elif len(ready) == 1:
            i, stored = ready[0]
            u = stored.unit
            _do_single_action_attack(u, active, players)  # brak partnera - bez CT
            active.barracks[i] = None
            active._discard_name(u.name)


def try_venom_spray(active, wyvern, target_player):
    """Jadowity Prysk: zamiast zwyklego ataku, Wyvern moze:
    (A) zniszczyc jednostke przeciwnika w infrastrukturze ignorujac jej HP, LUB
    (B) uderzyc Krolestwo z pominieciem jednostek (przelamuje kazdy 'mur').
    Zawsze konczy sie odrzuceniem Wyverna. Zwraca True jesli zdolnosc zostala
    uzyta (wtedy pomijamy zwykly atak)."""
    infra_targets = []
    if target_player.tower:
        infra_targets += [u for u in target_player.tower if u is not None]
    if target_player.mine and target_player.mine[0] is not None:
        infra_targets.append(target_player.mine[0])
    if target_player.barracks:
        infra_targets += [s.unit for s in target_player.barracks if s is not None]

    if infra_targets:
        best = max(infra_targets, key=lambda u: active.priority_score(u.name))
        if active.priority_score(best.name) >= 3:
            target_player.remove_unit_anywhere(best)
            target_player.last_attacked_by = active.kingdom_name
            active.remove_unit_anywhere(wyvern, by_opponent=False)
            return True

    if target_player.attackable_units():
        # przeciwnik ma jednostki blokujace zamek - Wyvern je ignoruje
        target_player.castle_hp -= wyvern.effective_atk()
        target_player.last_attacked_by = active.kingdom_name
        active.remove_unit_anywhere(wyvern, by_opponent=False)
        return True

    return False  # przeciwnik i tak nie ma zadnych jednostek - zwykly atak wystarczy


def should_use_rampage(u, active, players):
    """Szarza jest OPCJONALNA: uzywamy drugiego ataku (i tracimy jednostke -
    trafia na odrzucone) TYLKO jesli faktycznie cos to daje - dobicie kolejnej
    jednostki albo bezposrednie trafienie w zamek (przeciwnik bez jednostek).
    W przeciwnym razie oplaca sie zostawic jednostke zywa na planszy.
    Hazardzista: zawsze probuje (wysokie ryzyko/wysoki potencjalny zysk,
    nieoplacalna decyzja jest OK)."""
    if active.strategy == "hazardzista":
        return True
    tgt = pick_target_for_unit(u, active, players)
    if tgt is None:
        return False
    all_targets = tgt.attackable_units()
    if not all_targets:
        return not tgt.has_any_units_anywhere()  # castle-hit tylko gdy naprawde pusto (nie Warownia)
    compatible = [t for t in all_targets if u.can_hit_category(t.target_category)]
    if not compatible:
        return False  # atak i tak by przepadl - nie oplaca sie poswiecac jednostki
    atk_value = u.effective_atk()
    return any(t.hp <= atk_value for t in compatible)  # tylko jesli moze kogos dobic


def pick_target_player(active, players):
    alive_opponents = [p for p in players if p is not active and p.alive
                        and p.invulnerable_turns == 0 and not p.fog_shield]
    if not alive_opponents:
        alive_opponents = [p for p in players if p is not active and p.alive]
    if not alive_opponents:
        return None
    return min(alive_opponents, key=lambda p: p.castle_hp)


def pick_target_for_unit(attacker, active, players):
    """Wybiera cel DLA KONKRETNEJ jednostki: preferuje najslabszego (najnizsze
    HP zamku) osiagalnego przeciwnika, ale jesli ten przeciwnik ma jednostki
    niekompatybilne typem (np. samotny powietrzny tank), a atakujacy nie moze
    ich trafic, PRZEKIEROWUJE atak na kolejnego, strategicznie slabszego, ale
    faktycznie dosiegalnego przeciwnika (dotyczy gier 3+ osobowych).
    Strategia 'sabotage': jesli ktorykolwiek przeciwnik ma jednostke w
    Kopalni (dochod), priorytetowo atakuje WLASNIE jego (denial ekonomii),
    zamiast domyslnie najslabszego HP-zamku."""
    alive_opponents = [p for p in players if p is not active and p.alive
                        and p.invulnerable_turns == 0 and not p.fog_shield]
    if not alive_opponents:
        alive_opponents = [p for p in players if p is not active and p.alive]
    if not alive_opponents:
        return None

    if active.strategy == "sabotage":
        def mine_value(p):
            if p.mine and p.mine[0] is not None:
                u = p.mine[0]
                if "miner_bonus_gold" in u.abilities:
                    return 5
                if "tax_collector_infra" in u.abilities:
                    return 4
                return 3
            return -1
        econ_targets = [p for p in alive_opponents if mine_value(p) > 0]
        if econ_targets:
            best_opp = max(econ_targets, key=mine_value)
            targets = best_opp.attackable_units()
            if any(attacker.can_hit_category(t.target_category) for t in targets):
                return best_opp

    if active.strategy == "lowca_lidera":
        # Lowca Lidera: zawsze bije w AKTUALNEGO LIDERA (najwyzsze HP zamku),
        # ignorujac slabszych, dopoki nie stanie sie to niemozliwe (typ celu)
        best_opp = max(alive_opponents, key=lambda p: p.castle_hp)
        targets = best_opp.attackable_units()
        if (not targets and not best_opp.has_any_units_anywhere()) or any(attacker.can_hit_category(t.target_category) for t in targets):
            return best_opp

    if active.strategy == "msciciel" and active.last_attacked_by:
        # Mysciciel: priorytet ma zemsta na tym, kto go ostatnio zaatakowal
        revenge = next((p for p in alive_opponents if p.kingdom_name == active.last_attacked_by), None)
        if revenge is not None:
            targets = revenge.attackable_units()
            if (not targets and not revenge.has_any_units_anywhere()) or any(attacker.can_hit_category(t.target_category) for t in targets):
                return revenge
        # zemsta niemozliwa (cel martwy/niedosiegalny) - wraca do optymalnej gry nizej

    if active.strategy == "hazardzista":
        # Hazardzista: nieprzewidywalny - losowy cel z dostepnych, bez wzgledu
        # na optymalnosc
        return random.choice(alive_opponents)

    ordered = sorted(alive_opponents, key=lambda p: p.castle_hp)
    for opp in ordered:
        targets = opp.attackable_units()
        if not targets:
            if not opp.has_any_units_anywhere():
                return opp  # naprawde nic nie ma - mozna bic zamek
            continue  # ktos bezpieczny w Warowni - blokuje zamek, szukaj innego przeciwnika
        if any(attacker.can_hit_category(t.target_category) for t in targets):
            return opp  # jest przynajmniej jeden kompatybilny cel
    # zaden przeciwnik nie jest osiagalny dla tego typu ataku - atak przepada,
    # ale zwracamy najslabszego dla celow statystycznych (0 obrazen i tak wyjdzie)
    return ordered[0]


def build_event_deck():
    pool = []
    for name, (count, polarity, tag) in EVENTS.items():
        pool.extend([name] * count)
    random.shuffle(pool)
    return pool


def play_game(kingdom_list, strategies=None):
    """strategies: None (wszyscy 'balanced') albo lista dlugosci kingdom_list
    z wartosciami 'balanced'/'kingdom'/'event'/'infra' per gracz (pozycyjnie)."""
    n = len(kingdom_list)
    if strategies is None:
        strategies = ["balanced"] * n
    castle_hp = CASTLE_HP_BY_PLAYERS[n]
    event_deck = build_event_deck()
    event_discard = []
    players = [PlayerState(k, castle_hp, event_deck, event_discard, strategy=s)
               for k, s in zip(kingdom_list, strategies)]

    mine_pool = [max(0, n - 1)]
    barracks_pool = [max(0, n - 1)]
    fortress_pool = [max(0, n - 1)]

    for p in players:
        p.draw(5)

    turn_count = 0
    active_idx = 0
    while turn_count < MAX_TURNS_TOTAL:
        alive = [p for p in players if p.alive]
        if len(alive) <= 1:
            break

        active = players[active_idx]
        if not active.alive:
            active_idx = (active_idx + 1) % n
            continue

        if active.skip_turns > 0:
            active.skip_turns -= 1
            if active.invulnerable_turns > 0:
                active.invulnerable_turns -= 1
            apply_pending_flags(active, players, active_idx, mine_pool, barracks_pool, fortress_pool)
            active_idx = (active_idx + 1) % n
            turn_count += 1
            continue

        turn_count += 1
        active.fog_shield = False  # ochrona Mgly konczy sie z nadejsciem wlasnej tury
        active._double_atk_flag = False
        active.emisariusz_discards_this_turn = 0
        active.pegaz_transport_used_this_turn = False
        active.start_turn_income()
        income_goblin = getattr(active, "_goblin_income", 0)
        if income_goblin:
            active.gold += income_goblin
        active.draw_or_gold_choice()
        active.buy_phase(mine_pool, barracks_pool, fortress_pool)
        active.assign_infra_from_hand()
        active.play_phase()
        active.merge_krasnolud_pairs()
        active.try_pegaz_transport(mine_pool, fortress_pool)
        apply_pending_flags(active, players, active_idx, mine_pool, barracks_pool, fortress_pool)

        # zagraj trzymane karty wydarzen (jesli sensowne)
        if active.held_events:
            for ev in list(active.held_events):
                tag = EVENTS[ev][2]
                if tag == "destroy_weakest_enemy_infra":
                    resolve_held_event(active, ev, players, None)
                    active.held_events.remove(ev)
                elif tag == "alchemist_free_unit_buff4":
                    if active.empty_board_slot() is not None:
                        resolve_held_event(active, ev, players, None)
                        active.held_events.remove(ev)
                elif tag == "noop_fog":
                    resolve_held_event(active, ev, players, None)
                    active.held_events.remove(ev)
                elif tag == "noop_reposition":
                    if not active.try_zamieszanie():
                        active.held_events.remove(ev)  # nic sensownego do zrobienia - zwalniamy reke

        any_opponent = pick_target_player(active, players)
        if any_opponent is None:
            break

        atk_bonus = active.conditional_synergy_atk_bonus()
        used_in_combo = combo_attacks(active, any_opponent)

        double_flag = getattr(active, "_double_atk_flag", False)
        for u in list(active.all_units_in_play()):
            if id(u) in used_in_combo or u.hp <= 0:
                continue
            tgt = pick_target_for_unit(u, active, players)
            if tgt is None:
                continue
            if "venom_spray_infra_or_direct" in u.abilities and try_venom_spray(active, u, tgt):
                continue
            eff_bonus = atk_bonus + (u.effective_atk() if double_flag else 0)
            rampage = resolve_attack(u, tgt, eff_bonus, attacker_kingdom=active.kingdom_name)
            if rampage and u.hp > 0 and should_use_rampage(u, active, players):
                tgt2 = pick_target_for_unit(u, active, players)
                if tgt2 is not None:
                    resolve_attack(u, tgt2, eff_bonus, attacker_kingdom=active.kingdom_name)
                active.remove_unit_anywhere(u, by_opponent=False)

        # Tylko Wieza daje prawo do ataku. Jednostka w Kopalni NIE atakuje -
        # produkuje zloto i moze byc zaatakowana, ale sama nie bije (jedyny
        # wyjatek to obronny Szal Bitewny Orka, ktory dziala niezaleznie od
        # tego, gdzie Ork stoi, bo to reakcja na bycie zaatakowanym, nie atak).
        extra_attackers = []
        if active.tower:
            extra_attackers += [u for u in active.tower if u is not None]
        for u in extra_attackers:
            if u.hp <= 0:
                continue
            tgt = pick_target_for_unit(u, active, players)
            if tgt is None:
                continue
            if "venom_spray_infra_or_direct" in u.abilities and try_venom_spray(active, u, tgt):
                continue
            eff_bonus = atk_bonus + (u.effective_atk() if double_flag else 0)
            rampage = resolve_attack(u, tgt, eff_bonus, attacker_kingdom=active.kingdom_name)
            if rampage and u.hp > 0 and should_use_rampage(u, active, players):
                tgt2 = pick_target_for_unit(u, active, players)
                if tgt2 is not None:
                    resolve_attack(u, tgt2, eff_bonus, attacker_kingdom=active.kingdom_name)
                active.remove_unit_anywhere(u, by_opponent=False)

        activate_stored_units(active, players, atk_bonus)

        for i, s in enumerate(active.board):
            if s is not None and s.hp <= 0:
                active.board[i] = None
                active._discard_name(s.name)
                if s.passenger is not None:
                    active._discard_name(s.passenger.name)
                    s.passenger = None
        if active.tower:
            for i, u in enumerate(active.tower):
                if u is not None and u.hp <= 0:
                    active.tower[i] = None
                    active._discard_name(u.name)
        if active.mine and active.mine[0] is not None and active.mine[0].hp <= 0:
            active._discard_name(active.mine[0].name)
            active.mine[0] = None

        for p in players:
            if p.alive and p.castle_hp <= 0:
                p.alive = False
                p.elim_turn = turn_count
                if p.mine is not None:
                    mine_pool[0] += 1
                if p.barracks is not None:
                    barracks_pool[0] += 1
                if p.fortress is not None:
                    fortress_pool[0] += 1

        # Harpii Zryw / Galop: po zakonczeniu tury jednostka moze sie
        # przeniesc na wolne miejsce w obszarze gry (w tym infrastruktura)
        if active.alive:
            for u in list(active.board_units()):
                if u.hp > 0 and "reposition_end_turn" in u.abilities:
                    active.try_reposition_unit(u)

        active_idx = (active_idx + 1) % n

    alive = [p for p in players if p.alive]
    if len(alive) == 1:
        winner = alive[0].kingdom_name
    elif alive:
        best = max(alive, key=lambda p: (p.castle_hp,
                                          sum(u.hp + u.effective_atk() for u in p.board_units())))
        winner = best.kingdom_name
    else:
        winner = "draw"

    # ranking koncowy: zywi (wg castle_hp desc) nad wyeliminowanymi (bez
    # jednoznacznej kolejnosci eliminacji w tym modelu - traktujemy remisowo)
    ranking = sorted(players, key=lambda p: (p.alive, p.castle_hp), reverse=True)
    ranking_names = [p.kingdom_name for p in ranking]

    per_player = {}
    for p in players:
        per_player[p.kingdom_name] = dict(
            strategy=p.strategy,
            alive=p.alive,
            final_castle_hp=max(0, p.castle_hp),
            units_bought=p.n_units_bought,
            events_bought=p.n_events_bought,
            infra_bought=p.n_infra_bought,
            deck_value=p.total_deck_value(),
            gold_final=p.gold,
            elim_turn=p.elim_turn,
            deck_remaining=len(p.deck),
            infra_count=sum([bool(p.tower), bool(p.mine), bool(p.barracks), bool(p.fortress)]),
        )

    return dict(winner=winner, turns=turn_count, ranking=ranking_names, players=per_player)
