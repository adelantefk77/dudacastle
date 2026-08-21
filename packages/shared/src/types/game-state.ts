export type Zone =
  | "starting_deck" // talia startowa (dobór kart)
  | "hand"
  | "discard"
  | "kingdom_deck" // talia królestwa (zakup jednostek, nieznana góra)
  | "play_area" // zwykłe miejsce na jednostki (3, lub 5 z Wieżą)
  | "tower"
  | "mine"
  | "barracks"
  | "stronghold"
  | "event_deck" // wspólna, zakryta
  | "event_discard";

/** Strefy liczące się jako "obszar gry" dla efektów typu aura/uzdrowienie (sekcja 2/8 instrukcji). */
export const BATTLEFIELD_ZONES: Zone[] = ["play_area", "tower", "mine", "barracks", "stronghold"];

export interface StatusFlags {
  /** Jednostka wykonała już swój atak w tej turze */
  hasAttacked?: boolean;
  /** Tura (numer), w której jednostka weszła do obecnej strefy — do liczenia "odczekania" w Koszarach/Warowni */
  enteredZoneOnTurn?: number;
  /** Tymczasowe bufy trwające tylko do końca bieżącej tury/starcia (np. Inicjatywa — konsumowane po pierwszym ataku) */
  tempAtkBonus?: number;
  tempHpBonus?: number;
  /** Trwałe bufy przypisane bezpośrednio do egzemplarza karty (np. Spotkanie Alchemika +3 HP dopóki w grze) */
  permanentHpBonus?: number;
  permanentAtkBonus?: number;
  /** Ostatnio zastosowany łączny bonus z aur pasywnych — do przeliczeń różnicowych (zob. engine/auras.ts) */
  auraAtkBonus?: number;
  auraHpBonus?: number;
  /** Jednostka nie może być celem ataków (Warownia, dopóki efekt karty nie stanowi inaczej) */
  untargetable?: boolean;
  /** Zdolność aktywowana (Harmonia, Powietrzny Transport, Harpii Zryw, Galop) już użyta w tej turze właściciela */
  activatedAbilityUsedThisTurn?: boolean;
  /** Liczba działań wykonanych po opuszczeniu Warowni w tej turze (limit z mechaniki Warowni) */
  actionsTakenThisTurn?: number;
  /** Ta karta nie zajmuje własnego miejsca — dzieli slot z inną kartą (Katapulta Krasnoludów, Zakorzenienie Enta) */
  stackedOnInstanceId?: string;
  /** Tura, w której ta jednostka zginęła — do wykrywania "dwóch Emisariuszy odrzuconych w tej samej turze" itp. */
  destroyedOnTurn?: number;
  /** false = jednostka w Koszarach/Warowni jeszcze "odczekuje" do początku następnej swojej tury (sekcja 8) */
  readyToAct?: boolean;
  /** Szarża (Elf Mroczny/Minotaur/Centaur): dostępny dodatkowy atak po pokonaniu wrogiej jednostki */
  chargeBonusAttackAvailable?: boolean;
  /** Ten egzemplarz to Katapulta powstała z połączenia 2 Krasnoludów — przy odrzuceniu wraca jako 2 karty Krasnoluda (zob. zones.ts moveToDiscard). */
  isKrasnoludMerge?: boolean;
  /** Ten egzemplarz to Kolczan Prawilności powstały z połączenia 2 Doświadczonych Łuczników — przy odrzuceniu wraca jako 2 karty Łucznika (zob. zones.ts moveToDiscard). */
  isLucznikMerge?: boolean;
  /** Trening z Gráfeldr'em: jednorazowo użyczony Szał Bitewny — sprawdzane i konsumowane w combat.ts destroyUnit PRZED wyczyszczeniem status przez moveToDiscard. */
  oneShotSzalBitewnyPending?: boolean;
  /**
   * Ile z `permanentHpBonus` pochodzi obecnie z bycia w Wieży (0, jeśli karta nie jest w Wieży) —
   * pozwala relocateUnitToZone (zones.ts) poprawnie ODJĄĆ ten bonus przy opuszczeniu Wieży zamiast
   * zostawiać go tam na zawsze (i uniknąć podwójnego naliczenia przy Wieża→gdzie indziej→Wieża).
   */
  towerHpBonusApplied?: number;
}

export interface CardInstance {
  instanceId: string;
  definitionId: string;
  ownerMatchPlayerId: string;
  zone: Zone;
  /** Pozycja w obszarze gry (play_area) lub kolejność w stosie/talii */
  slotIndex: number | null;
  /** Aktualne HP w tej rundzie walki; resetowane do bazowego + trwałe bufy po turze (dmg nie przechodzi między turami) */
  currentHp: number;
  currentAtk: number;
  status: StatusFlags;
}

/** Jednorazowy efekt zaplanowany na przyszły start tury właściciela (np. "w najbliższej swojej turze produkcja x2"). */
export interface ScheduledTurnEffect {
  id: string;
  effectKey: string;
  params?: Record<string, unknown>;
  /** Ile własnych startów tury właściciela musi jeszcze minąć, zanim efekt się uruchomi (0 = przy najbliższym) */
  turnsUntil: number;
}

export interface PlayerState {
  matchPlayerId: string;
  userId: string;
  kingdomId: string;
  seatOrder: number;
  kingdomHp: number;
  /** Startowe (maksymalne) HP Królestwa wg liczby graczy — leczenie (Uzdrowienie, Sprzyjająca Pogoda...) nie może go przekroczyć. */
  maxKingdomHp: number;
  coins: number;
  eliminated: boolean;
  hasMadeDrawChoiceThisTurn: boolean;
  /** liczba dostępnych slotów w play_area: 3, albo 5 gdy posiada Wieżę w grze */
  unitSlotCapacity: number;
  /** Ile własnych tur z rzędu gracz musi pominąć (Zachodni Wiatr, Utknięcie w Grzęzawisku, Przysługa dla Księcia...) */
  turnsToSkip: number;
  /**
   * Ile własnych (przyszłych) tur pozostało, przez które Królestwo i jednostki gracza nie mogą
   * być celem ataków. Używane zarówno przez Wędrowną Trupę (wielotorowa ochrona) jak i Mgłę (v3:
   * chroni AŻ DO nadejścia własnej następnej tury, nie tylko do końca bieżącej — ustawiane na 1
   * w momencie zagrania, zdekrementowane na starcie kolejnej własnej tury).
   */
  untargetableTurnsRemaining: number;
  /** Do końca bieżącej tury ATK wszystkich jednostek gracza jest podwojone (Generał Szarych Płaszczy) */
  doubleAtkUntilEndOfTurn: boolean;
  /** Trwały bonus HP dla WSZYSTKICH (także przyszłych) jednostek w obszarze gry (Płatnerz) */
  permanentUnitHpAura: number;
  /** Stały bonus monet doliczany na starcie każdej własnej tury (Kopalnia Goblinów) */
  flatBonusCoinsPerTurn: number;
  /** Mnożnik produkcji wszystkich własnych Kopalni w TEJ turze (1 = brak bonusu; Spotkanie Przyjaznego Trolla → 3, v3) — resetowany po naliczeniu */
  mineProductionMultiplier: number;
  /** Kolejka efektów uruchamianych na starcie przyszłych własnych tur */
  scheduledTurnEffects: ScheduledTurnEffect[];
  /** Miejsce sterowane przez prostego bota serwera zamiast żywego gracza (zob. apps/server/src/engine/bot.ts) */
  isBot: boolean;
  /** Trening z Gráfeldr'em: jednorazowo użyczony Znawca Ścieżek — konsumowany przy najbliższym zakupie z talii królestwa/Wydarzeń (zob. reducer.ts). */
  oneShotPathExpertPending?: boolean;
}

export type TurnPhase = "draw" | "main";

export interface InfrastructurePool {
  mines: number;
  barracks: number;
  strongholds: number;
}

export interface GameState {
  matchId: string;
  status: "waiting" | "in_progress" | "finished";
  players: PlayerState[];
  cards: Record<string, CardInstance>; // wszystkie karty w grze, indeksowane po instanceId
  turnOrder: string[]; // matchPlayerId w kolejności tur
  currentPlayerIndex: number;
  turnNumber: number;
  turnPhase: TurnPhase;
  bankCoins: number;
  winnerMatchPlayerId: string | null;
  /** Niezaklejone kopie wspólnej infrastruktury dostępne do kupienia (graczy-1 sztuk każda, sekcja 1) */
  infrastructurePool: InfrastructurePool;
}

// ---- Akcje graczy (intencje wysyłane z klienta, walidowane przez silnik) ----

/** Jeden przydział obrażeń w ramach ataku (pojedynczego lub łączonego, ew. podzielonego na kilka celów). */
export interface AttackTarget {
  targetInstanceId: string | "kingdom"; // "kingdom" dla ataku bezpośredniego (np. Jadowity Prysk)
  targetPlayerId: string;
  /** Wymagane tylko gdy atak łączony jest "splittable" i dzielony na >1 cel; przy jednym celu przyjmowana jest cała wartość ataku. */
  damage?: number;
  /** Jadowity Prysk: zamiast zwykłych obrażeń, eliminuje cel w infrastrukturze ignorując HP. */
  ignoreHp?: boolean;
}

export type GameAction =
  | { type: "DRAW_CARDS"; matchPlayerId: string }
  | { type: "TAKE_COINS"; matchPlayerId: string }
  | {
      type: "PLAY_UNIT";
      matchPlayerId: string;
      cardInstanceId: string;
      slotIndex: number;
      /** Zakorzenienie (Ent): id jednostki-gospodarza, na której ta karta ma dzielić miejsce, zamiast zajmować własne. */
      stackOnInstanceId?: string;
    }
  | {
      type: "ATTACK";
      matchPlayerId: string;
      attackerInstanceIds: string[]; // >1 tylko gdy zdolność na to pozwala (np. Leśny Szał, Rzut Głazem, Horda)
      targets: AttackTarget[]; // >1 tylko gdy zdolność jest "splittable"
    }
  | { type: "BUY_UNIT"; matchPlayerId: string }
  | { type: "BUY_INFRASTRUCTURE"; matchPlayerId: string; kind: "tower" | "mine" | "barracks" | "stronghold" }
  | {
      type: "PLACE_IN_INFRASTRUCTURE";
      matchPlayerId: string;
      cardInstanceId: string;
      infrastructure: "tower" | "mine" | "barracks" | "stronghold";
    }
  | {
      type: "USE_ABILITY";
      matchPlayerId: string;
      cardInstanceId: string;
      abilityKey: string;
      params?: Record<string, unknown>;
    }
  | { type: "BUY_EVENT_CARD"; matchPlayerId: string }
  | {
      type: "PLAY_EVENT_FROM_HAND";
      matchPlayerId: string;
      cardInstanceId: string;
      /** Parametry wyboru gracza w momencie zagrania (np. wybrany cel Zasadzki Banitów) */
      params?: Record<string, unknown>;
    }
  | { type: "END_TURN"; matchPlayerId: string };

export interface GameEvent {
  matchId: string;
  sequenceNo: number;
  actorMatchPlayerId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
