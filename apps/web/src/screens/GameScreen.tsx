import { useMemo, useState } from "react";
import type { CardInstance, GameEvent, GameState } from "@dudacastle/shared";
import { KINGDOMS } from "@dudacastle/shared";
import { useGameStore } from "../store/gameStore";
import { getCardDefinition } from "../lib/catalog";
import { getCardArt } from "../lib/card-art";
import { BattlefieldUnit } from "../components/BattlefieldUnit";
import { UnitCard } from "../components/UnitCard";
import { EventCardView } from "../components/EventCardView";
import { AbilityModal, type ModalField } from "../components/AbilityModal";
import "./game-screen.css";

function kingdomName(kingdomId: string): string {
  return KINGDOMS.find((k) => k.id === kingdomId)?.name ?? kingdomId;
}

function cardsOf(state: GameState, matchPlayerId: string, zone: CardInstance["zone"]): CardInstance[] {
  return Object.values(state.cards).filter((c) => c.ownerMatchPlayerId === matchPlayerId && c.zone === zone);
}

function isUnit(card: CardInstance): boolean {
  return getCardDefinition(card.definitionId)?.type === "unit";
}

function isInfra(card: CardInstance): boolean {
  return getCardDefinition(card.definitionId)?.type === "infrastructure";
}

/**
 * Tłumaczy surowe zdarzenia silnika na czytelne komunikaty — bez tego zagranie karty Wydarzenia
 * (zwłaszcza natychmiastowej, która nigdy nie trafia na ekran jako karta) było niewidoczne: efekt
 * się rozgrywał po stronie serwera, ale gracz nie miał żadnej informacji, co się właśnie stało.
 */
function describeEvent(event: GameEvent, gameState: GameState): string | null {
  const cardLabel = (id: unknown) => {
    const card = gameState.cards[String(id)];
    const def = card ? getCardDefinition(card.definitionId) : undefined;
    return def?.name ?? "karta";
  };
  const playerLabel = (id: unknown) => {
    const player = gameState.players.find((p) => p.matchPlayerId === id);
    return player ? kingdomName(player.kingdomId) : "gracz";
  };
  const p = event.payload;
  switch (event.type) {
    case "EVENT_CARD_BOUGHT": {
      const card = gameState.cards[String(p.cardInstanceId)];
      const def = card ? getCardDefinition(card.definitionId) : undefined;
      if (def?.type === "event") {
        return p.timing === "held_one_shot"
          ? `Kupiono Wydarzenie „${def.name}" — trafiło na rękę, zagraj je w dogodnym momencie.`
          : `Kupiono Wydarzenie „${def.name}": ${def.description}`;
      }
      return "Kupiono kartę Wydarzenia.";
    }
    case "EVENT_CARD_PLAYED":
      return `Zagrano Wydarzenie „${cardLabel(p.cardInstanceId)}".`;
    case "ATTACK_RESOLVED":
      return `Atak zadał ${p.damage} obrażeń (cel: ${p.targetRemainingHp} HP pozostało).`;
    case "JOINT_ATTACK_RESOLVED":
      return `Atak łączony zadał ${p.totalDamage} obrażeń.`;
    case "KINGDOM_ATTACKED_DIRECTLY":
      return `Atak bezpośrednio w Królestwo (${playerLabel(p.targetPlayerId)}) — ${p.damage} obrażeń.`;
    case "UNIT_DESTROYED":
      return `Zniszczono jednostkę: ${cardLabel(p.cardInstanceId)}.`;
    case "UNIT_DESTROYED_IGNORING_HP":
      return `Zniszczono jednostkę (Jadowity Prysk): ${cardLabel(p.targetInstanceId)}.`;
    case "UNIT_BOUGHT":
      return `${playerLabel(event.actorMatchPlayerId)} kupił(a) z Talii Królestwa: ${cardLabel(p.cardInstanceId)} (trafia na stos odrzuconych).`;
    case "UNIT_PLAYED":
      return `Zagrano jednostkę: ${cardLabel(p.cardInstanceId)}.`;
    case "UNIT_PLACED_IN_INFRASTRUCTURE":
      return `Umieszczono jednostkę „${cardLabel(p.cardInstanceId)}" w infrastrukturze (${p.infrastructure}).`;
    case "INFRASTRUCTURE_BOUGHT":
      return `Kupiono infrastrukturę: ${p.kind}.`;
    case "INFRASTRUCTURE_GRANTED":
      return `Otrzymano kartę infrastruktury: ${p.kind}.`;
    case "INFRASTRUCTURE_POOL_EXHAUSTED":
      return "Brak dostępnej infrastruktury tego typu we wspólnej puli.";
    case "PLAYER_ELIMINATED":
      return `Gracz wyeliminowany: ${playerLabel(p.matchPlayerId)}.`;
    case "GAME_FINISHED":
      return p.winnerMatchPlayerId ? `Koniec gry — zwycięzca: ${playerLabel(p.winnerMatchPlayerId)}!` : "Koniec gry — remis.";
    case "CARDS_DRAWN":
      return `Dobrano ${p.count} kart(y) z Talii Startowej.`;
    case "COINS_TAKEN":
      return `Wzięto ${p.amount} monety.`;
    case "INCOME_COLLECTED":
      return `Dochód na start tury: +${p.amount} monet.`;
    case "TURN_SKIPPED":
      return `${playerLabel(p.matchPlayerId)} pomija turę.`;
    case "CHARGE_BONUS_ATTACK_AVAILABLE":
      return "Szarża: dostępny dodatkowy atak.";
    case "CHARGE_BONUS_ATTACK_CONSUMED":
      return "Szarża: wykorzystano dodatkowy atak.";
    case "CROSS_TRAINING_TRIGGERED":
      return "Koszary: Cross Training — automatyczny atak z podwojonym ATK.";
    case "KRASNOLUD_MERGED_INTO_KATAPULTA":
      return "Dwa Krasnoludy połączone w Katapultę.";
    case "ABILITY_USED":
      return `Użyto zdolności: ${cardLabel(p.cardInstanceId)}.`;
    case "PLAGUE_RESOLVED":
      return `Zaraźliwa Plaga: odrzucono ${p.discarded} jednostek(i) u ${playerLabel(p.matchPlayerId)}.`;
    case "GORANOWE_SZCZESCIE_RESOLVED":
      return `Goranowe Szczęście: ${playerLabel(p.forcedMatchPlayerId)} dobrał(a) wymuszoną kartę Wydarzenia.`;
    default:
      return null; // przefiltrowywane niżej
  }
}

type ModalState = { title: string; description?: string; fields: ModalField[]; onConfirm: (v: Record<string, string>) => void } | null;

interface EventLogProps {
  events: GameEvent[];
  gameState: GameState;
}

/** Dziennik ostatnich zdarzeń — jedyne miejsce, w którym widać co faktycznie zrobił efekt karty Wydarzenia, atak, itd. */
function EventLog({ events, gameState }: EventLogProps) {
  const described = events
    .map((e) => ({ e, text: describeEvent(e, gameState) }))
    .filter((x): x is { e: GameEvent; text: string } => x.text !== null)
    .slice(-25)
    .reverse();

  return (
    <div className="game-screen__log">
      <h4>Dziennik zdarzeń</h4>
      {described.length === 0 ? (
        <span className="infra-zone__empty">Tu pojawią się ostatnie zdarzenia meczu.</span>
      ) : (
        described.map(({ e, text }) => (
          <div key={`${e.sequenceNo}-${e.type}`} className="game-screen__log-entry">
            {text}
          </div>
        ))
      )}
    </div>
  );
}

export function GameScreen() {
  const { gameState, myMatchPlayerId, sendAction, lastError, dismissError, resetToLanding, recentEvents } = useGameStore();
  const [selectedHandUnitId, setSelectedHandUnitId] = useState<string | null>(null);
  const [selectedAttackers, setSelectedAttackers] = useState<string[]>([]);
  const [modal, setModal] = useState<ModalState>(null);

  const closeModal = () => setModal(null);

  if (!gameState || !myMatchPlayerId) {
    return <div className="game-screen__loading">Łączenie z meczem…</div>;
  }

  return (
    <GameBoard
      gameState={gameState}
      myMatchPlayerId={myMatchPlayerId}
      sendAction={sendAction}
      lastError={lastError}
      dismissError={dismissError}
      resetToLanding={resetToLanding}
      recentEvents={recentEvents}
      selectedHandUnitId={selectedHandUnitId}
      setSelectedHandUnitId={setSelectedHandUnitId}
      selectedAttackers={selectedAttackers}
      setSelectedAttackers={setSelectedAttackers}
      modal={modal}
      setModal={setModal}
      closeModal={closeModal}
    />
  );
}

interface GameBoardProps {
  gameState: GameState;
  myMatchPlayerId: string;
  sendAction: ReturnType<typeof useGameStore.getState>["sendAction"];
  lastError: string | null;
  dismissError: () => void;
  resetToLanding: () => void;
  recentEvents: ReturnType<typeof useGameStore.getState>["recentEvents"];
  selectedHandUnitId: string | null;
  setSelectedHandUnitId: (id: string | null) => void;
  selectedAttackers: string[];
  setSelectedAttackers: (ids: string[] | ((prev: string[]) => string[])) => void;
  modal: ModalState;
  setModal: (m: ModalState) => void;
  closeModal: () => void;
}

function GameBoard({
  gameState,
  myMatchPlayerId,
  sendAction,
  lastError,
  dismissError,
  resetToLanding,
  recentEvents,
  selectedHandUnitId,
  setSelectedHandUnitId,
  selectedAttackers,
  setSelectedAttackers,
  modal,
  setModal,
  closeModal,
}: GameBoardProps) {
  const me = gameState.players.find((p) => p.matchPlayerId === myMatchPlayerId);
  const opponents = gameState.players.filter((p) => p.matchPlayerId !== myMatchPlayerId);
  const isMyTurn = gameState.turnOrder[gameState.currentPlayerIndex] === myMatchPlayerId && !me?.eliminated;
  const inMainPhase = gameState.turnPhase === "main";

  const myHand = useMemo(() => (me ? cardsOf(gameState, me.matchPlayerId, "hand") : []), [gameState, me]);
  const myPlayArea = useMemo(
    () => (me ? cardsOf(gameState, me.matchPlayerId, "play_area").sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0)) : []),
    [gameState, me],
  );
  const myTowerUnits = useMemo(() => (me ? cardsOf(gameState, me.matchPlayerId, "tower").filter(isUnit) : []), [gameState, me]);
  const myMineUnits = useMemo(() => (me ? cardsOf(gameState, me.matchPlayerId, "mine").filter(isUnit) : []), [gameState, me]);
  const myBarracksUnits = useMemo(() => (me ? cardsOf(gameState, me.matchPlayerId, "barracks").filter(isUnit) : []), [gameState, me]);
  const myStrongholdUnits = useMemo(() => (me ? cardsOf(gameState, me.matchPlayerId, "stronghold").filter(isUnit) : []), [gameState, me]);
  const ownsTower = me ? cardsOf(gameState, me.matchPlayerId, "tower").some(isInfra) : false;
  const ownsMine = me ? cardsOf(gameState, me.matchPlayerId, "mine").some(isInfra) : false;
  const ownsBarracks = me ? cardsOf(gameState, me.matchPlayerId, "barracks").some(isInfra) : false;
  const ownsStronghold = me ? cardsOf(gameState, me.matchPlayerId, "stronghold").some(isInfra) : false;

  const PLAY_AREA_CAPACITY = 3;
  const freeSlots = new Set(Array.from({ length: PLAY_AREA_CAPACITY }, (_, i) => i));
  myPlayArea.forEach((c) => freeSlots.delete(c.slotIndex ?? -1));

  const INFRA_MAX_UNITS = { tower: 2, mine: 1, barracks: 2, stronghold: 1 } as const;

  /**
   * Strefy, do których dana jednostka może zostać przeniesiona (Harpii Zryw/Galop, Powietrzny
   * Transport, Zamieszanie) — wcześniej te zdolności pozwalały tylko na przesunięcie w obrębie
   * play_area, mimo że silnik (i simulator_v3.py) wspiera przenoszenie też do/z infrastruktury.
   * Serwer i tak waliduje ostatecznie (infrastructureForbidden, limity, posiadanie karty infry).
   */
  function relocateZoneOptions(card: CardInstance): { value: string; label: string }[] {
    const options: { value: string; label: string }[] = [];
    if (card.zone !== "play_area" && freeSlots.size > 0) options.push({ value: "play_area", label: "Obszar gry" });
    if (card.zone !== "tower" && ownsTower && myTowerUnits.length < INFRA_MAX_UNITS.tower) options.push({ value: "tower", label: "Wieża" });
    if (card.zone !== "mine" && ownsMine && myMineUnits.length < INFRA_MAX_UNITS.mine) options.push({ value: "mine", label: "Kopalnia" });
    if (card.zone !== "barracks" && ownsBarracks && myBarracksUnits.length < INFRA_MAX_UNITS.barracks) {
      options.push({ value: "barracks", label: "Koszary" });
    }
    if (card.zone !== "stronghold" && ownsStronghold && myStrongholdUnits.length < INFRA_MAX_UNITS.stronghold) {
      options.push({ value: "stronghold", label: "Warownia" });
    }
    return options;
  }

  if (!me) {
    return <div className="game-screen__loading">Twój gracz nie jest częścią tego meczu.</div>;
  }

  const myPlayerId = me.matchPlayerId;
  const selectedHandCard = selectedHandUnitId ? gameState.cards[selectedHandUnitId] : null;

  function handleHandUnitClick(card: CardInstance) {
    setSelectedAttackers([]);
    setSelectedHandUnitId(selectedHandUnitId === card.instanceId ? null : card.instanceId);
  }

  function handleHandEventClick(card: CardInstance) {
    const def = getCardDefinition(card.definitionId);
    if (!def || def.type !== "event") return;

    if (def.effectKey === "destroyLowestHpEnemyInInfrastructure") {
      setModal({
        title: def.name,
        description: def.description,
        fields: [
          {
            key: "targetPlayerId",
            label: "Przeciwnik",
            options: opponents.map((o) => ({ value: o.matchPlayerId, label: kingdomName(o.kingdomId) })),
          },
        ],
        onConfirm: (values) => {
          sendAction({ type: "PLAY_EVENT_FROM_HAND", matchPlayerId: myPlayerId, cardInstanceId: card.instanceId, params: values });
          closeModal();
        },
      });
      return;
    }

    if (def.effectKey === "relocateOwnUnitThenDiscard") {
      // Zamieszanie: dowolna WŁASNA jednostka z obszaru gry (nie tylko play_area — też Wieża/
      // Kopalnia/Koszary) do dowolnej innej posiadanej strefy z wolnym miejscem.
      const relocatableUnits = [...myPlayArea, ...myTowerUnits, ...myMineUnits, ...myBarracksUnits];
      const allZoneOptions = new Map<string, string>();
      for (const u of relocatableUnits) for (const opt of relocateZoneOptions(u)) allZoneOptions.set(opt.value, opt.label);
      setModal({
        title: def.name,
        description: def.description,
        fields: [
          {
            key: "cardInstanceId",
            label: "Jednostka",
            options: relocatableUnits.map((u) => ({ value: u.instanceId, label: getCardDefinition(u.definitionId)?.name ?? u.definitionId })),
          },
          {
            key: "targetZone",
            label: "Strefa docelowa",
            options: Array.from(allZoneOptions, ([value, label]) => ({ value, label })),
          },
        ],
        onConfirm: (values) => {
          sendAction({
            type: "PLAY_EVENT_FROM_HAND",
            matchPlayerId: myPlayerId,
            cardInstanceId: card.instanceId,
            params: { cardInstanceId: values.cardInstanceId, targetZone: values.targetZone },
          });
          closeModal();
        },
      });
      return;
    }

    if (def.effectKey === "grantOneShotAbilityToUnit") {
      const ownUnits = [...myPlayArea, ...myTowerUnits, ...myMineUnits, ...myBarracksUnits, ...myStrongholdUnits];
      setModal({
        title: def.name,
        description: def.description,
        fields: [
          {
            key: "targetInstanceId",
            label: "Jednostka",
            options: ownUnits.map((u) => ({ value: u.instanceId, label: getCardDefinition(u.definitionId)?.name ?? u.definitionId })),
          },
          {
            key: "chosenAbilityKey",
            label: "Zdolność",
            options: [
              { value: "uzdrowienie", label: "Uzdrowienie" },
              { value: "zrecznosc", label: "Zręczność" },
              { value: "inicjatywa", label: "Inicjatywa" },
              { value: "szarza", label: "Szarża" },
            ],
          },
        ],
        onConfirm: (values) => {
          sendAction({ type: "PLAY_EVENT_FROM_HAND", matchPlayerId: myPlayerId, cardInstanceId: card.instanceId, params: values });
          closeModal();
        },
      });
      return;
    }

    sendAction({ type: "PLAY_EVENT_FROM_HAND", matchPlayerId: myPlayerId, cardInstanceId: card.instanceId });
  }

  function handleEmptySlotClick(slotIndex: number) {
    if (!selectedHandCard) return;
    sendAction({ type: "PLAY_UNIT", matchPlayerId: myPlayerId, cardInstanceId: selectedHandCard.instanceId, slotIndex });
    setSelectedHandUnitId(null);
  }

  function toggleAttacker(card: CardInstance) {
    if (card.status.hasAttacked) return;
    setSelectedHandUnitId(null);
    setSelectedAttackers((prev) => (prev.includes(card.instanceId) ? prev.filter((id) => id !== card.instanceId) : [...prev, card.instanceId]));
  }

  function attackTarget(targetInstanceId: string, targetPlayerId: string) {
    if (selectedAttackers.length === 0) return;
    sendAction({
      type: "ATTACK",
      matchPlayerId: myPlayerId,
      attackerInstanceIds: selectedAttackers,
      targets: [{ targetInstanceId, targetPlayerId }],
    });
    setSelectedAttackers([]);
  }

  function attackKingdomDirectly(targetPlayerId: string) {
    // >1 atakujący: atak łączony (Ent/Cyklop/Horda) kończący przeciwnika, który nie ma już
    // żadnych jednostek — serwer liczy pełne obrażenia combo jako jedną alokację w Królestwo.
    if (selectedAttackers.length === 0) return;
    sendAction({
      type: "ATTACK",
      matchPlayerId: myPlayerId,
      attackerInstanceIds: selectedAttackers,
      targets: [{ targetInstanceId: "kingdom", targetPlayerId }],
    });
    setSelectedAttackers([]);
  }

  function useAbility(card: CardInstance) {
    const def = getCardDefinition(card.definitionId);
    if (!def || def.type !== "unit") return;
    const ability = def.abilities.find((a) => a.trigger === "activated");
    if (!ability) return;

    if (ability.effectKey === "relocateSelf") {
      setModal({
        title: ability.description,
        fields: [{ key: "targetZone", label: "Strefa docelowa", options: relocateZoneOptions(card) }],
        onConfirm: (values) => {
          sendAction({ type: "USE_ABILITY", matchPlayerId: myPlayerId, cardInstanceId: card.instanceId, abilityKey: ability.key, params: { targetZone: values.targetZone } });
          closeModal();
        },
      });
      return;
    }

    if (ability.effectKey === "relocateAllyOncePerTurn") {
      // Pegaz: sojusznik może pochodzić z dowolnej strefy (nie tylko play_area — też Wieża/
      // Kopalnia/Koszary), a strefa docelowa zależy od wybranego sojusznika, więc pokazujemy
      // sumę wszystkich stref osiągalnych dla KTÓREGOKOLWIEK kandydata (serwer i tak zwaliduje).
      const allies = [...myPlayArea, ...myTowerUnits, ...myMineUnits, ...myBarracksUnits].filter((u) => u.instanceId !== card.instanceId);
      const allyZoneOptions = new Map<string, string>();
      for (const u of allies) for (const opt of relocateZoneOptions(u)) allyZoneOptions.set(opt.value, opt.label);
      setModal({
        title: ability.description,
        fields: [
          { key: "targetInstanceId", label: "Sojusznik", options: allies.map((u) => ({ value: u.instanceId, label: getCardDefinition(u.definitionId)?.name ?? u.definitionId })) },
          { key: "targetZone", label: "Strefa docelowa", options: Array.from(allyZoneOptions, ([value, label]) => ({ value, label })) },
        ],
        onConfirm: (values) => {
          sendAction({ type: "USE_ABILITY", matchPlayerId: myPlayerId, cardInstanceId: card.instanceId, abilityKey: ability.key, params: { targetInstanceId: values.targetInstanceId, targetZone: values.targetZone } });
          closeModal();
        },
      });
      return;
    }

    if (ability.effectKey === "mergeIntoKatapulta") {
      // Partner może stać w dowolnej strefie (play_area/Wieża/Kopalnia/Koszary), nie tylko obok
      // siebie w obszarze gry — zob. relocateZoneOptions i identyczne uzasadnienie w effect-resolver.ts.
      const candidates = [...myPlayArea, ...myTowerUnits, ...myMineUnits, ...myBarracksUnits].filter(
        (u) => u.instanceId !== card.instanceId && getCardDefinition(u.definitionId)?.name === "Krasnolud",
      );
      setModal({
        title: ability.description,
        fields: [
          {
            key: "partnerInstanceId",
            label: "Drugi Krasnolud",
            options: candidates.map((u) => ({ value: u.instanceId, label: `${getCardDefinition(u.definitionId)?.name} (${u.zone})` })),
          },
        ],
        onConfirm: (values) => {
          sendAction({ type: "USE_ABILITY", matchPlayerId: myPlayerId, cardInstanceId: card.instanceId, abilityKey: ability.key, params: { partnerInstanceId: values.partnerInstanceId } });
          closeModal();
        },
      });
      return;
    }

    if (ability.effectKey === "swapTwoOwnUnitsOncePerTurn") {
      setModal({
        title: ability.description,
        fields: [
          { key: "instanceIdA", label: "Jednostka A", options: myPlayArea.map((u) => ({ value: u.instanceId, label: getCardDefinition(u.definitionId)?.name ?? u.definitionId })) },
          { key: "instanceIdB", label: "Jednostka B", options: myPlayArea.map((u) => ({ value: u.instanceId, label: getCardDefinition(u.definitionId)?.name ?? u.definitionId })) },
        ],
        onConfirm: (values) => {
          sendAction({ type: "USE_ABILITY", matchPlayerId: myPlayerId, cardInstanceId: card.instanceId, abilityKey: ability.key, params: values });
          closeModal();
        },
      });
      return;
    }

    sendAction({ type: "USE_ABILITY", matchPlayerId: myPlayerId, cardInstanceId: card.instanceId, abilityKey: ability.key });
  }

  const selectedAttackerCard = selectedAttackers.length === 1 ? gameState.cards[selectedAttackers[0]] : null;
  const selectedAttackerCanIgnoreUnits =
    selectedAttackerCard &&
    (getCardDefinition(selectedAttackerCard.definitionId) as { abilities: { effectKey: string }[] } | undefined)?.abilities.some(
      (a) => a.effectKey === "directOrInfraKillInsteadOfAttack",
    );

  // Każda jednostka może uderzyć wprost w Królestwo, jeśli przeciwnik nie ma żadnych jednostek
  // (nawet w Warowni, która sama nie jest atakowalna, ale wciąż blokuje) — Jadowity Prysk
  // dodatkowo pomija istniejące jednostki.
  function opponentHasAnyUnitAnywhere(opponentId: string): boolean {
    return (["play_area", "tower", "mine", "barracks", "stronghold"] as const).some(
      (zone) => cardsOf(gameState, opponentId, zone).filter(isUnit).length > 0,
    );
  }

  function canAttackKingdomDirectly(opponentId: string): boolean {
    // Dozwolone też dla >1 wybranego atakującego (atak łączony Ent/Cyklop/Horda) — żaden z tych
    // combosów nie ma Jadowitego Prysku, więc dla nich liczy się wyłącznie brak jednostek u wroga.
    if (selectedAttackers.length === 0) return false;
    const opponent = gameState.players.find((p) => p.matchPlayerId === opponentId);
    if (opponent?.eliminated) return false;
    return Boolean(selectedAttackerCanIgnoreUnits) || !opponentHasAnyUnitAnywhere(opponentId);
  }

  return (
    <main className="game-screen">
      {lastError && (
        <div className="game-screen__error" onClick={dismissError} role="alert">
          {lastError} (kliknij, aby ukryć)
        </div>
      )}

      {modal && <AbilityModal title={modal.title} description={modal.description} fields={modal.fields} onConfirm={modal.onConfirm} onCancel={closeModal} />}

      <div className="game-screen__layout">
        <div className="game-screen__main">
          <header className="game-screen__topbar">
            <div>
              Bank: {gameState.bankCoins}💰 — Tura #{gameState.turnNumber} — {isMyTurn ? "TWOJA TURA" : "Tura przeciwnika"} (
              {gameState.turnPhase === "draw" ? "Dobór" : "Rozgrywanie"})
            </div>
            <button type="button" onClick={resetToLanding}>
              Wyjdź
            </button>
          </header>

      {gameState.status === "finished" && (
        <div className="game-screen__banner">
          {gameState.winnerMatchPlayerId === myMatchPlayerId ? "Wygrałeś! 🎉" : "Twoje Królestwo zostało zniszczone."}
        </div>
      )}

      <section className="game-screen__opponents">
        {opponents.map((opp) => {
          const oppOwnsTower = cardsOf(gameState, opp.matchPlayerId, "tower").some(isInfra);
          const oppOwnsMine = cardsOf(gameState, opp.matchPlayerId, "mine").some(isInfra);
          const oppOwnsBarracks = cardsOf(gameState, opp.matchPlayerId, "barracks").some(isInfra);
          const oppOwnsStronghold = cardsOf(gameState, opp.matchPlayerId, "stronghold").some(isInfra);
          const oppPlayArea = cardsOf(gameState, opp.matchPlayerId, "play_area").filter(isUnit);
          const oppStrongholdUnits = cardsOf(gameState, opp.matchPlayerId, "stronghold").filter(isUnit);

          return (
            <div key={opp.matchPlayerId} className="opponent-board">
              <h3>
                {opp.isBot && "🤖 "}
                {kingdomName(opp.kingdomId)} — ❤️{opp.kingdomHp} 💰{opp.coins} {opp.eliminated ? "(wyeliminowany)" : ""}
              </h3>
              {/* Każda strefa (obszar gry / infrastruktura) oznaczona osobno — bez tego nie widać, czy
                  dana karta przeciwnika stoi w Kopalni, Wieży czy Koszarach, co uniemożliwiało planowanie ataków. */}
              <div className="opponent-board__units">
                <OpponentZone label="Obszar gry" units={oppPlayArea} opponentId={opp.matchPlayerId} attackTarget={attackTarget} />
                {oppOwnsTower && (
                  <OpponentZone
                    label="Wieża"
                    units={cardsOf(gameState, opp.matchPlayerId, "tower").filter(isUnit)}
                    opponentId={opp.matchPlayerId}
                    attackTarget={attackTarget}
                  />
                )}
                {oppOwnsMine && (
                  <OpponentZone
                    label="Kopalnia"
                    units={cardsOf(gameState, opp.matchPlayerId, "mine").filter(isUnit)}
                    opponentId={opp.matchPlayerId}
                    attackTarget={attackTarget}
                  />
                )}
                {oppOwnsBarracks && (
                  <OpponentZone
                    label="Koszary"
                    units={cardsOf(gameState, opp.matchPlayerId, "barracks").filter(isUnit)}
                    opponentId={opp.matchPlayerId}
                    attackTarget={attackTarget}
                  />
                )}
                {oppOwnsStronghold && (
                  <div className="opponent-board__zone">
                    <h5>Warownia</h5>
                    <span className="infra-zone__empty">
                      {oppStrongholdUnits.length === 0 ? "pusto" : `${oppStrongholdUnits.length}× (nie do ataku, blokuje zamek)`}
                    </span>
                  </div>
                )}
              </div>
              {canAttackKingdomDirectly(opp.matchPlayerId) && (
                <button type="button" className="game-screen__attack-kingdom" onClick={() => attackKingdomDirectly(opp.matchPlayerId)}>
                  Zaatakuj Królestwo bezpośrednio
                </button>
              )}
            </div>
          );
        })}
      </section>

      <section className="my-board">
        <h2>
          Twoje Królestwo ({kingdomName(me.kingdomId)}) — ❤️{me.kingdomHp} 💰{me.coins}
        </h2>

        <div className="my-board__row">
          <h4>Obszar gry</h4>
          <div className="my-board__slots">
            {Array.from({ length: PLAY_AREA_CAPACITY }, (_, slotIndex) => {
              const card = myPlayArea.find((c) => c.slotIndex === slotIndex);
              if (!card) {
                return (
                  <button
                    key={slotIndex}
                    type="button"
                    className={["my-board__empty-slot", selectedHandCard ? "my-board__empty-slot--targetable" : ""].join(" ")}
                    onClick={() => handleEmptySlotClick(slotIndex)}
                    disabled={!isMyTurn || !inMainPhase || !selectedHandCard}
                  >
                    Puste miejsce
                  </button>
                );
              }
              const def = getCardDefinition(card.definitionId);
              const hasActivated = def?.type === "unit" && def.abilities.some((a) => a.trigger === "activated");
              return (
                <BattlefieldUnit
                  key={card.instanceId}
                  card={card}
                  selected={selectedAttackers.includes(card.instanceId)}
                  hasActivatedAbility={hasActivated}
                  onSelect={() => toggleAttacker(card)}
                  onUseAbility={() => useAbility(card)}
                />
              );
            })}
          </div>
        </div>

        <div className="my-board__row">
          <h4>Infrastruktura</h4>
          <div className="my-board__infra">
            {ownsTower && <InfraZone label="Wieża" artDefinitionId={`${me.kingdomId}-tower`} units={myTowerUnits} selectedAttackers={selectedAttackers} toggleAttacker={toggleAttacker} useAbility={useAbility} />}
            {ownsMine && <InfraZone label="Kopalnia" artDefinitionId="infra-mine" units={myMineUnits} selectedAttackers={selectedAttackers} toggleAttacker={toggleAttacker} useAbility={useAbility} />}
            {ownsBarracks && <InfraZone label="Koszary" units={myBarracksUnits} selectedAttackers={selectedAttackers} toggleAttacker={toggleAttacker} useAbility={useAbility} />}
            {ownsStronghold && <InfraZone label="Warownia" units={myStrongholdUnits} selectedAttackers={selectedAttackers} toggleAttacker={toggleAttacker} useAbility={useAbility} />}
          </div>
        </div>

        <div className="my-board__row">
          <h4>Ręka ({myHand.length})</h4>
          <div className="my-board__hand">
            {myHand.map((card) => {
              const def = getCardDefinition(card.definitionId);
              if (!def) return null;
              if (def.type === "unit") {
                return (
                  <UnitCard
                    key={card.instanceId}
                    definition={def}
                    selected={selectedHandUnitId === card.instanceId}
                    onClick={() => (isMyTurn && inMainPhase ? handleHandUnitClick(card) : undefined)}
                  />
                );
              }
              if (def.type === "event") {
                return (
                  <EventCardView key={card.instanceId} definition={def} onClick={() => (isMyTurn && inMainPhase ? handleHandEventClick(card) : undefined)} />
                );
              }
              return null;
            })}
          </div>
        </div>

        {selectedHandCard && (
          <PlacementBar
            card={selectedHandCard}
            towerArtDefinitionId={`${me.kingdomId}-tower`}
            ownsTower={ownsTower}
            ownsMine={ownsMine}
            ownsBarracks={ownsBarracks}
            ownsStronghold={ownsStronghold}
            onPlaceInfra={(infrastructure) => {
              sendAction({ type: "PLACE_IN_INFRASTRUCTURE", matchPlayerId: myPlayerId, cardInstanceId: selectedHandCard.instanceId, infrastructure });
              setSelectedHandUnitId(null);
            }}
            onCancel={() => setSelectedHandUnitId(null)}
          />
        )}

        <ActionBar
          gameState={gameState}
          me={me}
          isMyTurn={isMyTurn}
          inMainPhase={inMainPhase}
          selectedAttackers={selectedAttackers}
          ownsTower={ownsTower}
          onDraw={() => sendAction({ type: "DRAW_CARDS", matchPlayerId: myPlayerId })}
          onTakeCoins={() => sendAction({ type: "TAKE_COINS", matchPlayerId: myPlayerId })}
          onBuyUnit={() => sendAction({ type: "BUY_UNIT", matchPlayerId: myPlayerId })}
          onBuyEvent={() => sendAction({ type: "BUY_EVENT_CARD", matchPlayerId: myPlayerId })}
          onBuyInfra={(kind) => sendAction({ type: "BUY_INFRASTRUCTURE", matchPlayerId: myPlayerId, kind })}
          onEndTurn={() => sendAction({ type: "END_TURN", matchPlayerId: myPlayerId })}
          onClearAttackers={() => setSelectedAttackers([])}
        />
      </section>
        </div>

        <aside className="game-screen__sidebar">
          <EventLog events={recentEvents} gameState={gameState} />
        </aside>
      </div>
    </main>
  );
}

interface OpponentZoneProps {
  label: string;
  units: CardInstance[];
  opponentId: string;
  attackTarget: (targetInstanceId: string, targetPlayerId: string) => void;
}

/** Jak InfraZone, ale dla planszy przeciwnika: klik na jednostkę wybiera ją jako cel ataku zamiast atakującego. */
function OpponentZone({ label, units, opponentId, attackTarget }: OpponentZoneProps) {
  return (
    <div className="opponent-board__zone">
      <h5>{label}</h5>
      {units.length === 0 ? (
        <span className="infra-zone__empty">pusto</span>
      ) : (
        units.map((card) => (
          <BattlefieldUnit key={card.instanceId} card={card} onSelect={() => attackTarget(card.instanceId, opponentId)} />
        ))
      )}
    </div>
  );
}

interface InfraZoneProps {
  label: string;
  /** Id definicji karty infrastruktury (np. "infra-mine") — do wyszukania wygenerowanej ilustracji. */
  artDefinitionId?: string;
  units: CardInstance[];
  selectedAttackers: string[];
  toggleAttacker: (card: CardInstance) => void;
  useAbility: (card: CardInstance) => void;
}

function InfraZone({ label, artDefinitionId, units, selectedAttackers, toggleAttacker, useAbility }: InfraZoneProps) {
  const art = artDefinitionId ? getCardArt(artDefinitionId) : undefined;
  return (
    <div className="infra-zone">
      <h5>
        {art && <img src={art} alt="" className="infra-zone__art" />}
        {label}
      </h5>
      {units.length === 0 ? (
        <span className="infra-zone__empty">pusto</span>
      ) : (
        units.map((card) => {
          const def = getCardDefinition(card.definitionId);
          const hasActivated = def?.type === "unit" && def.abilities.some((a) => a.trigger === "activated");
          return (
            <BattlefieldUnit
              key={card.instanceId}
              card={card}
              selected={selectedAttackers.includes(card.instanceId)}
              hasActivatedAbility={hasActivated}
              onSelect={() => toggleAttacker(card)}
              onUseAbility={() => useAbility(card)}
            />
          );
        })
      )}
    </div>
  );
}

interface PlacementBarProps {
  card: CardInstance;
  towerArtDefinitionId: string;
  ownsTower: boolean;
  ownsMine: boolean;
  ownsBarracks: boolean;
  ownsStronghold: boolean;
  onPlaceInfra: (infrastructure: "tower" | "mine" | "barracks" | "stronghold") => void;
  onCancel: () => void;
}

function PlacementBar({ card, towerArtDefinitionId, ownsTower, ownsMine, ownsBarracks, ownsStronghold, onPlaceInfra, onCancel }: PlacementBarProps) {
  const def = getCardDefinition(card.definitionId);
  const forbidden = def?.type === "unit" && def.infrastructureForbidden;
  const towerArt = getCardArt(towerArtDefinitionId);
  const mineArt = getCardArt("infra-mine");
  return (
    <div className="placement-bar">
      <span>Zamiast pustego miejsca możesz umieścić kartę w:</span>
      {ownsTower && (
        <button type="button" onClick={() => onPlaceInfra("tower")} disabled={forbidden}>
          {towerArt && <img src={towerArt} alt="" className="placement-bar__art" />}
          Wieża
        </button>
      )}
      {ownsMine && (
        <button type="button" onClick={() => onPlaceInfra("mine")} disabled={forbidden}>
          {mineArt && <img src={mineArt} alt="" className="placement-bar__art" />}
          Kopalnia
        </button>
      )}
      {ownsBarracks && (
        <button type="button" onClick={() => onPlaceInfra("barracks")}>
          Koszary
        </button>
      )}
      {ownsStronghold && (
        <button type="button" onClick={() => onPlaceInfra("stronghold")} disabled={forbidden}>
          Warownia
        </button>
      )}
      <button type="button" onClick={onCancel}>
        Anuluj
      </button>
    </div>
  );
}

interface ActionBarProps {
  gameState: GameState;
  me: GameState["players"][number];
  isMyTurn: boolean;
  inMainPhase: boolean;
  selectedAttackers: string[];
  ownsTower: boolean;
  onDraw: () => void;
  onTakeCoins: () => void;
  onBuyUnit: () => void;
  onBuyEvent: () => void;
  onBuyInfra: (kind: "tower" | "mine" | "barracks" | "stronghold") => void;
  onEndTurn: () => void;
  onClearAttackers: () => void;
}

function ActionBar({ gameState, me, isMyTurn, inMainPhase, selectedAttackers, ownsTower, onDraw, onTakeCoins, onBuyUnit, onBuyEvent, onBuyInfra, onEndTurn, onClearAttackers }: ActionBarProps) {
  const canDrawChoice = isMyTurn && gameState.turnPhase === "draw" && !me.hasMadeDrawChoiceThisTurn;

  return (
    <div className="action-bar">
      {canDrawChoice && (
        <>
          <button type="button" onClick={onDraw}>
            Dobierz 2 karty
          </button>
          <button type="button" onClick={onTakeCoins}>
            Weź 2 monety
          </button>
        </>
      )}
      {isMyTurn && inMainPhase && (
        <>
          <button type="button" onClick={onBuyUnit}>
            Kup jednostkę (5💰)
          </button>
          <button type="button" onClick={onBuyEvent}>
            Kup kartę Wydarzenia
          </button>
          {!ownsTower && (
            <button type="button" onClick={() => onBuyInfra("tower")}>
              Kup Wieżę
            </button>
          )}
          <button type="button" onClick={() => onBuyInfra("mine")}>
            Kup Kopalnię
          </button>
          <button type="button" onClick={() => onBuyInfra("barracks")}>
            Kup Koszary
          </button>
          <button type="button" onClick={() => onBuyInfra("stronghold")}>
            Kup Warownię
          </button>
          {selectedAttackers.length > 0 && (
            <button type="button" onClick={onClearAttackers}>
              Wyczyść wybór atakujących ({selectedAttackers.length})
            </button>
          )}
          <button type="button" className="action-bar__end-turn" onClick={onEndTurn}>
            Zakończ turę
          </button>
        </>
      )}
    </div>
  );
}
