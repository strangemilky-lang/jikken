import type { GameState, RarityId } from './types';

export const MID_BOSS_INTERVAL = 10;
export const SANCTUM_INTERVAL = 50;

export function isSanctumFloor(stage: number): boolean {
  return stage >= SANCTUM_INTERVAL && stage % SANCTUM_INTERVAL === 0;
}

export function isMidBossFloor(stage: number): boolean {
  return stage >= MID_BOSS_INTERVAL && stage % MID_BOSS_INTERVAL === 0 && !isSanctumFloor(stage);
}

export function isGateFloor(stage: number): boolean {
  return isSanctumFloor(stage + 1);
}

export function isHeldAtGate(stage: number, clearedSanctumMax: number): boolean {
  return isGateFloor(stage) && clearedSanctumMax < stage + 1;
}

/**
 * Returns the Sanctum floor target that can be challenged via the player-only entry button,
 * or null if the player hasn't unlocked the first Sanctum (50F) yet.
 */
export function getUnlockedSanctumTarget(
  stage: number,
  maxStage: number,
  clearedSanctumMax: number,
): number | null {
  const frontierSanctum = Math.floor(Math.max(1, maxStage) / SANCTUM_INTERVAL) * SANCTUM_INTERVAL;
  if (frontierSanctum >= SANCTUM_INTERVAL && frontierSanctum > clearedSanctumMax) {
    return frontierSanctum;
  }
  const bandSanctum = Math.ceil(Math.max(1, stage) / SANCTUM_INTERVAL) * SANCTUM_INTERVAL;
  if (maxStage >= bandSanctum || clearedSanctumMax >= bandSanctum) {
    return bandSanctum;
  }
  if (clearedSanctumMax >= SANCTUM_INTERVAL) {
    return clearedSanctumMax;
  }
  return null;
}

export function getNextManualStage(
  currentStage: number,
  maxStage: number,
  clearedSanctumMax: number,
): number | null {
  if (isSanctumFloor(currentStage)) {
    return clearedSanctumMax >= currentStage && maxStage >= currentStage + 1
      ? currentStage + 1
      : null;
  }
  const candidate = currentStage + 1;
  if (isSanctumFloor(candidate)) {
    if (clearedSanctumMax >= candidate && maxStage >= candidate + 1) {
      return candidate + 1;
    }
    return null;
  }
  return candidate <= maxStage ? candidate : null;
}

export function getPrevManualStage(currentStage: number): number | null {
  if (currentStage <= 1) return null;
  const candidate = currentStage - 1;
  if (isSanctumFloor(candidate)) {
    return candidate > 1 ? candidate - 1 : null;
  }
  return candidate;
}

export interface BossVictoryProgression {
  nextStage: number;
  nextMaxStage: number;
  nextClearedSanctumMax: number;
  heldAtGate: boolean;
  sanctumCleared: number | null;
}

export function resolveBossVictoryProgression(
  state: Pick<GameState, 'stage' | 'maxStage' | 'autoProgress' | 'clearedSanctumMax'>,
): BossVictoryProgression {
  if (isSanctumFloor(state.stage)) {
    const nextClearedSanctumMax = Math.max(state.clearedSanctumMax, state.stage);
    const nextMaxStage = Math.max(state.maxStage, state.stage + 1);
    return {
      nextStage: state.stage + 1,
      nextMaxStage,
      nextClearedSanctumMax,
      heldAtGate: false,
      sanctumCleared: state.stage,
    };
  }

  const candidateNext = state.stage + 1;
  if (isSanctumFloor(candidateNext)) {
    if (state.clearedSanctumMax >= candidateNext) {
      const nextMaxStage = Math.max(state.maxStage, candidateNext + 1);
      return {
        nextStage: state.autoProgress ? candidateNext + 1 : state.stage,
        nextMaxStage,
        nextClearedSanctumMax: state.clearedSanctumMax,
        heldAtGate: false,
        sanctumCleared: null,
      };
    }

    const nextMaxStage = Math.max(state.maxStage, candidateNext);
    return {
      nextStage: state.stage,
      nextMaxStage,
      nextClearedSanctumMax: state.clearedSanctumMax,
      heldAtGate: true,
      sanctumCleared: null,
    };
  }

  const nextMaxStage = Math.max(state.maxStage, candidateNext);
  return {
    nextStage: state.autoProgress ? candidateNext : state.stage,
    nextMaxStage,
    nextClearedSanctumMax: state.clearedSanctumMax,
    heldAtGate: false,
    sanctumCleared: null,
  };
}

export function resolveDefeatRetreatStage(stage: number): number {
  if (stage <= 1) return 1;
  const candidate = stage - 1;
  if (isSanctumFloor(candidate)) {
    return candidate > 1 ? candidate - 1 : 1;
  }
  return candidate;
}

export function canEnterSanctum(
  state: Pick<GameState, 'stage' | 'maxStage' | 'sanctumKeys' | 'clearedSanctumMax'>,
  targetSanctum: number,
): { ok: boolean; reason?: 'not_sanctum' | 'already_in_sanctum' | 'locked' | 'no_key' } {
  if (!isSanctumFloor(targetSanctum)) {
    return { ok: false, reason: 'not_sanctum' };
  }
  if (isSanctumFloor(state.stage)) {
    return { ok: false, reason: 'already_in_sanctum' };
  }
  if (state.maxStage < targetSanctum && state.clearedSanctumMax < targetSanctum) {
    return { ok: false, reason: 'locked' };
  }
  if (state.sanctumKeys < 1) {
    return { ok: false, reason: 'no_key' };
  }
  return { ok: true };
}

export function enterSanctumState(state: GameState, targetSanctum: number): boolean {
  const check = canEnterSanctum(state, targetSanctum);
  if (!check.ok) return false;
  state.sanctumKeys -= 1;
  state.stage = targetSanctum;
  state.floorEncounters = 0;
  return true;
}

export function rollSanctumDropRarity(
  cleared100: boolean,
  isGreatDemon: boolean,
  rng: () => number = Math.random,
): RarityId {
  const r = rng();
  if (cleared100 || isGreatDemon) {
    const pMythic = isGreatDemon ? 0.28 : 0.18;
    const pLegend = isGreatDemon ? 0.57 : 0.52;
    if (r < pMythic) return 4;
    if (r < pMythic + pLegend) return 3;
    return 2;
  }
  return r < 0.55 ? 3 : 2;
}
