import { useMemo, useState } from "react";
import type { CardInstance, GameState } from "@dudacastle/shared";
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

type ModalState = { title: string; description?: string; fields: ModalField[]; onConfirm: (v: Record<string, string>) => void } | null;

export function GameScreen() {
  const { gameState, myMatchPlayerId, sendAction, lastError, dismissError, resetToLanding } = useGameStore();
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
    if (selectedAttackers.length !== 1) return;
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
        fields: [{ key: "targetSlotIndex", label: "Wolne miejsce", options: Array.from(freeSlots).map((i) => ({ value: String(i), label: `Miejsce ${i + 1}` })) }],
        onConfirm: (values) => {
          sendAction({ type: "USE_ABILITY", matchPlayerId: myPlayerId, cardInstanceId: card.instanceId, abilityKey: ability.key, params: { targetSlotIndex: Number(values.targetSlotIndex) } });
          closeModal();
        },
      });
      return;
    }

    if (ability.effectKey === "relocateAllyOncePerTurn") {
      const allies = myPlayArea.filter((u) => u.instanceId !== card.instanceId);
      setModal({
        title: ability.description,
        fields: [
          { key: "targetInstanceId", label: "Sojusznik", options: allies.map((u) => ({ value: u.instanceId, label: getCardDefinition(u.definitionId)?.name ?? u.definitionId })) },
          { key: "targetSlotIndex", label: "Wolne miejsce", options: Array.from(freeSlots).map((i) => ({ value: String(i), label: `Miejsce ${i + 1}` })) },
        ],
        onConfirm: (values) => {
          sendAction({ type: "USE_ABILITY", matchPlayerId: myPlayerId, cardInstanceId: card.instanceId, abilityKey: ability.key, params: { targetInstanceId: values.targetInstanceId, targetSlotIndex: Number(values.targetSlotIndex) } });
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
    if (!selectedAttackerCard) return false;
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
        {opponents.map((opp) => (
          <div key={opp.matchPlayerId} className="opponent-board">
            <h3>
              {opp.isBot && "🤖 "}
              {kingdomName(opp.kingdomId)} — ❤️{opp.kingdomHp} 💰{opp.coins} {opp.eliminated ? "(wyeliminowany)" : ""}
            </h3>
            <div className="opponent-board__units">
              {(["play_area", "tower", "mine", "barracks"] as const).flatMap((zone) =>
                cardsOf(gameState, opp.matchPlayerId, zone)
                  .filter(isUnit)
                  .map((card) => (
                    <BattlefieldUnit
                      key={card.instanceId}
                      card={card}
                      onSelect={() => attackTarget(card.instanceId, opp.matchPlayerId)}
                    />
                  )),
              )}
            </div>
            {canAttackKingdomDirectly(opp.matchPlayerId) && (
              <button type="button" className="game-screen__attack-kingdom" onClick={() => attackKingdomDirectly(opp.matchPlayerId)}>
                Zaatakuj Królestwo bezpośrednio
              </button>
            )}
          </div>
        ))}
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
    </main>
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
