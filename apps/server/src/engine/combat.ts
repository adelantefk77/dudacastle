import type { AttackTarget, CardInstance, GameState, PlayerState } from "@dudacastle/shared";
import { BATTLEFIELD_ZONES } from "@dudacastle/shared";
import type { CardCatalog } from "./catalog.js";
import { getUnitDefinition } from "./catalog.js";
import { effectiveAttackDamage } from "./auras.js";
import { GameRuleError } from "./errors.js";
import { resolveEffect } from "./effect-resolver.js";
import { getPlayer } from "./selectors.js";
import { moveToDiscard } from "./zones.js";

type Emit = (type: string, payload?: Record<string, unknown>) => void;

function battlefieldUnitsOf(state: GameState, catalog: CardCatalog, matchPlayerId: string): CardInstance[] {
  return Object.values(state.cards).filter(
    (c) =>
      c.ownerMatchPlayerId === matchPlayerId &&
      BATTLEFIELD_ZONES.includes(c.zone) &&
      catalog.get(c.definitionId)?.type === "unit",
  );
}

/** Jednostki w Koszarach/Warowni "odczekujące" nie mogą jeszcze atakować ani używać zdolności (sekcja 8). */
export function assertUnitReadyToAct(card: CardInstance): void {
  if ((card.zone === "barracks" || card.zone === "stronghold") && card.status.readyToAct === false) {
    const label = card.zone === "barracks" ? "Koszarach" : "Warowni";
    throw new GameRuleError(
      `Jednostka w ${label} nie może jeszcze działać — oczekuje do początku swojej następnej tury.`,
      "UNIT_NOT_READY",
    );
  }
}

/**
 * Warownia: po odczekaniu jednostka wykonuje maks. 2 działania (atak lub zdolność), po czym
 * trafia na stos odrzuconych. Wywoływane po KAŻDYM ataku/użyciu zdolności takiej jednostki.
 */
export function consumeStrongholdAction(state: GameState, catalog: CardCatalog, card: CardInstance): void {
  if (card.zone !== "stronghold") return;
  card.status.actionsTakenThisTurn = (card.status.actionsTakenThisTurn ?? 0) + 1;
  if (card.status.actionsTakenThisTurn >= 2) moveToDiscard(state, catalog, card);
}

/**
 * Czy jednostka o zdolności ofensywnej `attackerCanTarget` może trafić cel o kategorii
 * `targetCategory` — te dwa pola są NIEZALEŻNE (zob. UnitCardDefinition.targetCategory).
 * "land_and_air" po którejkolwiek stronie oznacza zawsze zgodność.
 */
export function canAttackerHitTargetCategory(
  attackerCanTarget: "land" | "air" | "land_and_air",
  targetCategory: "land" | "air" | "land_and_air",
): boolean {
  if (attackerCanTarget === "land_and_air" || targetCategory === "land_and_air") return true;
  return attackerCanTarget === targetCategory;
}

function assertPlayerNotUntargetable(owner: PlayerState) {
  if (owner.untargetableTurnsRemaining > 0) {
    throw new GameRuleError(
      "Ten gracz jest chwilowo nietykalny (efekt karty Wydarzenia).",
      "PLAYER_UNTARGETABLE",
    );
  }
}

/** Jednostki przeciwnika, które mogą być celem normalnego ataku (bez Warowni — niedostępna). */
function attackableUnitsOf(state: GameState, catalog: CardCatalog, matchPlayerId: string): CardInstance[] {
  return Object.values(state.cards).filter(
    (c) =>
      c.ownerMatchPlayerId === matchPlayerId &&
      BATTLEFIELD_ZONES.includes(c.zone) &&
      c.zone !== "stronghold" &&
      catalog.get(c.definitionId)?.type === "unit",
  );
}

/**
 * Czy gracz posiada JAKĄKOLWIEK jednostkę, w tym w Warowni — Warownia sama nie jest atakowalna,
 * ale wciąż blokuje bezpośredni atak w Królestwo (zob. cards.py has_any_units_anywhere).
 */
function hasAnyUnitAnywhere(state: GameState, catalog: CardCatalog, matchPlayerId: string): boolean {
  if (attackableUnitsOf(state, catalog, matchPlayerId).length > 0) return true;
  return Object.values(state.cards).some(
    (c) => c.ownerMatchPlayerId === matchPlayerId && c.zone === "stronghold" && catalog.get(c.definitionId)?.type === "unit",
  );
}

function assertUnitTargetable(target: CardInstance, owner: PlayerState) {
  if (!BATTLEFIELD_ZONES.includes(target.zone)) {
    throw new GameRuleError("Ten cel nie znajduje się w obszarze gry.", "TARGET_NOT_ON_BATTLEFIELD");
  }
  assertPlayerNotUntargetable(owner);
  if (target.zone === "stronghold") {
    throw new GameRuleError("Jednostka w Warowni nie może być celem ataków.", "TARGET_IN_STRONGHOLD");
  }
}

function requireOwnedActingCard(state: GameState, matchPlayerId: string, instanceId: string): CardInstance {
  const card = state.cards[instanceId];
  // Kopalnia NIE daje prawa do ataku — jednostka tam produkuje złoto i może być zaatakowana, ale
  // sama nie bije (jedyny wyjątek to obronny Szał Bitewny Orka, który jest reakcją na bycie
  // zaatakowanym, nie inicjowanym atakiem — obsłużone osobno w retaliateKillAttacker).
  const inAllowedZone = card && (card.zone === "play_area" || card.zone === "tower" || card.zone === "barracks" || card.zone === "stronghold");
  if (!card || card.ownerMatchPlayerId !== matchPlayerId || !inAllowedZone) {
    throw new GameRuleError("Nieprawidłowy atakujący.", "INVALID_ATTACKER");
  }
  if (card.status.hasAttacked) {
    throw new GameRuleError(
      "Ta jednostka wykonała już swój atak w tej turze (obrażenia i ataki nie przechodzą między turami).",
      "ALREADY_ATTACKED",
    );
  }
  assertUnitReadyToAct(card);
  return card;
}

/** Rozstrzyga (na miejscu, mutując `state`) skutki trafienia jednego celu i ewentualną śmierć jednostki-celu. */
function destroyUnit(
  state: GameState,
  catalog: CardCatalog,
  targetCard: CardInstance,
  emit: Emit,
  actionParams?: Record<string, unknown>,
): void {
  const def = getUnitDefinition(catalog, targetCard.definitionId);
  targetCard.status.destroyedOnTurn = state.turnNumber;
  moveToDiscard(state, catalog, targetCard);
  emit("UNIT_DESTROYED", { cardInstanceId: targetCard.instanceId });
  for (const ability of def.abilities) {
    if (ability.trigger === "on_death") {
      resolveEffect(ability.effectKey, {
        state,
        catalog,
        sourceCard: targetCard,
        ownerMatchPlayerId: targetCard.ownerMatchPlayerId,
        params: ability.params,
        actionParams,
        emit,
      });
    }
  }
}

function applyDamageToTarget(
  state: GameState,
  catalog: CardCatalog,
  representativeAttacker: CardInstance,
  attackerInstanceIds: string[],
  alloc: AttackTarget,
  emit: Emit,
): void {
  if (alloc.targetInstanceId === "kingdom") {
    throw new GameRuleError("Atak bezpośredni w Królestwo jest dostępny tylko dla zdolności Jadowity Prysk.", "DIRECT_KINGDOM_ATTACK_NOT_ALLOWED");
  }
  const targetCard = state.cards[alloc.targetInstanceId];
  if (!targetCard || targetCard.ownerMatchPlayerId !== alloc.targetPlayerId) {
    throw new GameRuleError("Nieprawidłowy cel ataku.", "INVALID_TARGET");
  }
  const targetOwner = getPlayer(state, targetCard.ownerMatchPlayerId);
  assertUnitTargetable(targetCard, targetOwner);

  const damage = Number(alloc.damage ?? 0);
  targetCard.currentHp -= damage;
  emit("ATTACK_RESOLVED", {
    attackerInstanceIds,
    targetInstanceId: targetCard.instanceId,
    damage,
    targetRemainingHp: targetCard.currentHp,
  });
  if (targetCard.currentHp <= 0) {
    destroyUnit(state, catalog, targetCard, emit, { attackerInstanceIds });
  }
}

/** Po zniszczeniu wroga przez pojedynczy atak: Szarża (Elf Mroczny/Minotaur/Centaur) daje natychmiastowy drugi atak. */
function handleChargeFollowUp(
  state: GameState,
  catalog: CardCatalog,
  attacker: CardInstance,
  attackerDef: ReturnType<typeof getUnitDefinition>,
  targetDestroyed: boolean,
  emit: Emit,
): void {
  if (attacker.status.chargeBonusAttackAvailable) {
    attacker.status.chargeBonusAttackAvailable = false;
    moveToDiscard(state, catalog, attacker);
    emit("CHARGE_BONUS_ATTACK_CONSUMED", { cardInstanceId: attacker.instanceId });
    return;
  }
  if (!targetDestroyed) return;
  const chargeAbility = attackerDef.abilities.find(
    (a) => a.trigger === "on_enemy_destroyed" && a.effectKey === "extraAttackThenDiscard",
  );
  if (!chargeAbility) return;
  attacker.status.hasAttacked = false;
  attacker.status.chargeBonusAttackAvailable = true;
  emit("CHARGE_BONUS_ATTACK_AVAILABLE", { cardInstanceId: attacker.instanceId });
}

function resolveSingleAttack(
  state: GameState,
  catalog: CardCatalog,
  attacker: CardInstance,
  target: AttackTarget,
  emit: Emit,
): void {
  const attackerDef = getUnitDefinition(catalog, attacker.definitionId);
  const specialAbility = attackerDef.abilities.find((a) => a.effectKey === "directOrInfraKillInsteadOfAttack");

  if (target.targetInstanceId === "kingdom") {
    const opponent = getPlayer(state, target.targetPlayerId);
    assertPlayerNotUntargetable(opponent);
    // Atak bezpośredni w Królestwo jest dozwolony dla KAŻDEJ jednostki, jeśli przeciwnik nie
    // posiada żadnych jednostek blokujących (nawet w Warowni) — Jadowity Prysk to jedyny
    // wyjątek, który POMIJA istniejące jednostki zamiast wymagać ich braku.
    if (!specialAbility && hasAnyUnitAnywhere(state, catalog, target.targetPlayerId)) {
      throw new GameRuleError(
        "Przeciwnik posiada jednostki blokujące bezpośredni atak w Królestwo.",
        "OPPONENT_HAS_BLOCKING_UNITS",
      );
    }
    const damage = effectiveAttackDamage(state, attacker);
    opponent.kingdomHp -= damage;
    attacker.status.hasAttacked = true;
    emit("KINGDOM_ATTACKED_DIRECTLY", { attackerInstanceId: attacker.instanceId, targetPlayerId: target.targetPlayerId, damage });
    if (specialAbility?.params?.discardAfterUse) moveToDiscard(state, catalog, attacker);
    return;
  }

  const targetCard = state.cards[target.targetInstanceId];
  if (!targetCard || targetCard.ownerMatchPlayerId !== target.targetPlayerId) {
    throw new GameRuleError("Nieprawidłowy cel ataku.", "INVALID_TARGET");
  }
  const targetOwner = getPlayer(state, targetCard.ownerMatchPlayerId);
  assertUnitTargetable(targetCard, targetOwner);

  const isInfraZone = targetCard.zone === "tower" || targetCard.zone === "mine" || targetCard.zone === "barracks" || targetCard.zone === "stronghold";
  if (specialAbility && target.ignoreHp) {
    if (!isInfraZone) {
      throw new GameRuleError("Jadowity Prysk może eliminować tylko jednostki w infrastrukturze.", "TARGET_NOT_IN_INFRASTRUCTURE");
    }
    attacker.status.hasAttacked = true;
    destroyUnit(state, catalog, targetCard, emit, { attackerInstanceIds: [attacker.instanceId], ignoredHp: true });
    emit("UNIT_DESTROYED_IGNORING_HP", { attackerInstanceId: attacker.instanceId, targetInstanceId: targetCard.instanceId });
    if (specialAbility.params?.discardAfterUse) moveToDiscard(state, catalog, attacker);
    return;
  }

  const targetDef = getUnitDefinition(catalog, targetCard.definitionId);
  const effectiveCanTarget = attacker.zone === "tower" ? "land_and_air" : attackerDef.canTarget;
  if (!canAttackerHitTargetCategory(effectiveCanTarget, targetDef.targetCategory)) {
    const label = targetDef.targetCategory === "air" ? "powietrzne" : targetDef.targetCategory === "land" ? "lądowe" : "lądowe i powietrzne";
    throw new GameRuleError(`Ta jednostka nie może atakować celów typu "${label}".`, "INVALID_TARGET_DOMAIN");
  }

  const damage = effectiveAttackDamage(state, attacker);
  targetCard.currentHp -= damage;
  attacker.status.hasAttacked = true;
  attacker.status.tempAtkBonus = 0; // "Inicjatywa" konsumowana po pierwszym ataku
  emit("ATTACK_RESOLVED", {
    attackerInstanceIds: [attacker.instanceId],
    targetInstanceId: targetCard.instanceId,
    damage,
    targetRemainingHp: targetCard.currentHp,
  });

  const destroyed = targetCard.currentHp <= 0;
  if (destroyed) destroyUnit(state, catalog, targetCard, emit, { attackerInstanceIds: [attacker.instanceId] });
  handleChargeFollowUp(state, catalog, attacker, attackerDef, destroyed, emit);
}

/** Leśny Szał (Ent), Rzut Głazem (Cyklop), Horda (Ork) — ataki wielu jednostek jako jedna akcja. */
function resolveJointAttack(
  state: GameState,
  catalog: CardCatalog,
  attackers: CardInstance[],
  targets: AttackTarget[],
  emit: Emit,
): void {
  const defs = attackers.map((a) => getUnitDefinition(catalog, a.definitionId));
  const firstDef = defs[0];
  const jointAbility =
    firstDef.abilities.find((a) => a.effectKey === "jointAttack") ??
    firstDef.abilities.find((a) => a.effectKey === "jointAttackThreshold");
  if (!jointAbility) {
    throw new GameRuleError("Te jednostki nie posiadają zdolności ataku łączonego.", "JOINT_ATTACK_NOT_SUPPORTED");
  }

  const requiredName = String(jointAbility.params?.unitName ?? firstDef.name);
  const requiredCount = Number(jointAbility.params?.requiredCount ?? attackers.length);
  if (attackers.length !== requiredCount) {
    throw new GameRuleError(
      `Ten atak łączony wymaga dokładnie ${requiredCount} jednostek "${requiredName}".`,
      "JOINT_ATTACK_WRONG_COUNT",
    );
  }
  if (!defs.every((d) => d.name === requiredName)) {
    throw new GameRuleError(`Wszyscy atakujący muszą być jednostkami "${requiredName}".`, "JOINT_ATTACK_UNIT_MISMATCH");
  }

  if (jointAbility.effectKey === "jointAttackThreshold") {
    const ownerCopies = battlefieldUnitsOf(state, catalog, attackers[0].ownerMatchPlayerId).filter(
      (c) => getUnitDefinition(catalog, c.definitionId).name === requiredName,
    );
    if (ownerCopies.length < requiredCount) {
      throw new GameRuleError(
        `Ten atak łączony wymaga posiadania ${requiredCount} jednostek "${requiredName}" w obszarze gry.`,
        "JOINT_ATTACK_THRESHOLD_NOT_MET",
      );
    }
  }

  const totalDamage =
    jointAbility.effectKey === "jointAttackThreshold"
      ? attackers.reduce((sum, a) => sum + effectiveAttackDamage(state, a), 0) * Number(jointAbility.params?.multiplier ?? 1)
      : Number(jointAbility.params?.totalAtk ?? attackers.reduce((sum, a) => sum + a.currentAtk, 0));

  const splittable = Boolean(jointAbility.params?.splittable);
  if (targets.length === 0) throw new GameRuleError("Brak celu ataku.", "NO_TARGET");
  if (!splittable && targets.length > 1) {
    throw new GameRuleError("Ten atak łączony nie może zostać podzielony pomiędzy kilka celów.", "JOINT_ATTACK_NOT_SPLITTABLE");
  }

  // Pojedynczy cel zawsze otrzymuje całość obrażeń — klient nie musi znać wyliczonej wartości
  // (np. pomnożonej przez Hordę); podział na >1 celu wymaga jawnego rozpisania przez klienta.
  const allocations: AttackTarget[] =
    targets.length === 1 ? [{ ...targets[0], damage: totalDamage }] : targets.map((t) => ({ ...t, damage: Number(t.damage ?? 0) }));
  const allocatedSum = allocations.reduce((sum, t) => sum + (t.damage ?? 0), 0);
  if (targets.length > 1 && allocatedSum !== totalDamage) {
    throw new GameRuleError(
      `Suma podzielonych obrażeń (${allocatedSum}) musi równać się ${totalDamage}.`,
      "JOINT_ATTACK_SPLIT_MISMATCH",
    );
  }

  attackers.forEach((a) => {
    a.status.hasAttacked = true;
  });
  const attackerInstanceIds = attackers.map((a) => a.instanceId);
  for (const alloc of allocations) {
    applyDamageToTarget(state, catalog, attackers[0], attackerInstanceIds, alloc, emit);
  }
  emit("JOINT_ATTACK_RESOLVED", { attackerInstanceIds, totalDamage, ability: jointAbility.key });
}

/**
 * Wybiera cel automatycznie (bez udziału gracza) — używane przez efekty wyzwalane przy starcie
 * tury, np. Cross Training w Koszarach. Preferuje przeciwnika z najsłabszym kompatybilnym celem;
 * jeśli przeciwnik nie ma żadnych jednostek (i nie jest chroniony Warownią), zwraca atak w jego
 * Królestwo.
 */
function pickAutomaticTarget(state: GameState, catalog: CardCatalog, attacker: CardInstance): AttackTarget | null {
  const attackerDef = getUnitDefinition(catalog, attacker.definitionId);
  const effectiveCanTarget = attacker.zone === "tower" ? "land_and_air" : attackerDef.canTarget;
  const opponents = state.players.filter((p) => p.matchPlayerId !== attacker.ownerMatchPlayerId && !p.eliminated);

  for (const opponent of opponents) {
    if (opponent.untargetableTurnsRemaining > 0) continue;
    const attackable = attackableUnitsOf(state, catalog, opponent.matchPlayerId);
    const compatible = attackable.filter((t) =>
      canAttackerHitTargetCategory(effectiveCanTarget, getUnitDefinition(catalog, t.definitionId).targetCategory),
    );
    if (compatible.length > 0) {
      const target = compatible.reduce((lowest, t) => (t.currentHp < lowest.currentHp ? t : lowest));
      return { targetInstanceId: target.instanceId, targetPlayerId: opponent.matchPlayerId };
    }
    if (!hasAnyUnitAnywhere(state, catalog, opponent.matchPlayerId)) {
      return { targetInstanceId: "kingdom", targetPlayerId: opponent.matchPlayerId };
    }
  }
  return null;
}

/**
 * Atak automatyczny jednej jednostki (bez wyboru gracza) — Koszary/Cross Training. Zwraca true,
 * jeśli atak faktycznie się odbył (cel został znaleziony).
 */
export function resolveAutomaticAttack(state: GameState, catalog: CardCatalog, attacker: CardInstance, emit: Emit): boolean {
  const target = pickAutomaticTarget(state, catalog, attacker);
  if (!target) return false;
  resolveSingleAttack(state, catalog, attacker, target, emit);
  return true;
}

export function resolveAttackAction(
  state: GameState,
  catalog: CardCatalog,
  matchPlayerId: string,
  attackerInstanceIds: string[],
  targets: AttackTarget[],
  emit: Emit,
): void {
  if (attackerInstanceIds.length === 0) throw new GameRuleError("Brak atakującego.", "NO_ATTACKER");
  const attackers = attackerInstanceIds.map((id) => requireOwnedActingCard(state, matchPlayerId, id));

  if (attackers.length === 1) {
    if (targets.length !== 1) {
      throw new GameRuleError("Pojedynczy atak wymaga dokładnie jednego celu.", "SINGLE_ATTACK_ONE_TARGET");
    }
    resolveSingleAttack(state, catalog, attackers[0], targets[0], emit);
  } else {
    resolveJointAttack(state, catalog, attackers, targets, emit);
  }

  attackers.forEach((a) => consumeStrongholdAction(state, catalog, a));
}
