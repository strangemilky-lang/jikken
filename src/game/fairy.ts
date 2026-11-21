import type { FairyBuffKind, FairyState, GameState } from './types';

export const FAIRY_BASE_COOLDOWN_SEC = 90;
export const FAIRY_KILL_REDUCE_SEC = 8;
export const FAIRY_FLOOR_REDUCE_SEC = 12;
export const FAIRY_BUFF_DURATION_MS = 60_000;

export interface FairyProfile {
  rank: number;
  title: string;
  accentColor: string;
  wingColor: string;
  dressColor: string;
  auraColor: string;
  maxGifts: number;
  salvageBonusPct: number;
  rareSlimeBonusPct: number;
  offlineBonusPct: number;
  chestChance: number;
  mythicChestChance: number;
  buffStonePct: number;
  buffExplorePct: number;
}

export interface FairyClaimResult {
  stones: number;
  chests: number;
  mythicChests: number;
  buffKind: FairyBuffKind | null;
  summaryText: string;
}

const FAIRY_TIERS = [
  {
    title: '森の妖精',
    accentColor: '#4ade80',
    wingColor: '#bbf7d0',
    dressColor: '#22c55e',
    auraColor: 'rgba(74, 222, 128, 0.28)',
  },
  {
    title: '蒼輝の妖精',
    accentColor: '#38bdf8',
    wingColor: '#bae6fd',
    dressColor: '#0ea5e9',
    auraColor: 'rgba(56, 189, 248, 0.30)',
  },
  {
    title: '黄金の妖精',
    accentColor: '#fbbf24',
    wingColor: '#fef08a',
    dressColor: '#eab308',
    auraColor: 'rgba(251, 191, 36, 0.32)',
  },
  {
    title: '星界の妖精',
    accentColor: '#c084fc',
    wingColor: '#e9d5ff',
    dressColor: '#a855f7',
    auraColor: 'rgba(192, 132, 252, 0.34)',
  },
  {
    title: '虹輝の妖精',
    accentColor: '#f472b6',
    wingColor: '#fbcfe8',
    dressColor: '#ec4899',
    auraColor: 'rgba(244, 114, 182, 0.36)',
  },
] as const;

export function getFairyRank(maxStage: number, cleared100: boolean): number {
  if (!cleared100 && maxStage <= 100) return 0;
  return Math.max(1, Math.floor(Math.max(100, maxStage - 1) / 100));
}

export function getFairyProfile(rank: number): FairyProfile {
  const safeRank = Math.max(0, Math.floor(rank));
  const tier = FAIRY_TIERS[Math.min(FAIRY_TIERS.length - 1, safeRank)];
  const title =
    safeRank >= FAIRY_TIERS.length ? `${tier.title} Lv.${safeRank + 1}` : tier.title;

  return {
    rank: safeRank,
    title,
    accentColor: tier.accentColor,
    wingColor: tier.wingColor,
    dressColor: tier.dressColor,
    auraColor: tier.auraColor,
    maxGifts: safeRank >= 3 ? 3 : safeRank >= 1 ? 2 : 1,
    salvageBonusPct: Math.min(40, safeRank * 8),
    rareSlimeBonusPct: Math.min(8, +(safeRank * 1.5).toFixed(1)),
    offlineBonusPct: Math.min(40, safeRank * 8),
    chestChance: Math.min(0.45, 0.25 + safeRank * 0.05),
    mythicChestChance: safeRank >= 2 ? Math.min(0.08, 0.02 + (safeRank - 2) * 0.015) : 0,
    buffStonePct: Math.min(50, 25 + safeRank * 5),
    buffExplorePct: Math.min(35, 20 + safeRank * 3),
  };
}

export function createDefaultFairyState(): FairyState {
  return {
    cooldownSec: 35,
    giftsReady: 0,
    totalClaimed: 0,
    buffKind: null,
    buffUntil: 0,
  };
}

export function sanitizeFairyState(raw: unknown, maxGifts: number): FairyState {
  const def = createDefaultFairyState();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Record<string, unknown>;
  const giftsReady =
    typeof r.giftsReady === 'number'
      ? Math.max(0, Math.min(maxGifts, Math.floor(r.giftsReady)))
      : 0;
  const cooldownSec =
    typeof r.cooldownSec === 'number' && Number.isFinite(r.cooldownSec)
      ? Math.max(1, Math.min(FAIRY_BASE_COOLDOWN_SEC, r.cooldownSec))
      : def.cooldownSec;
  const totalClaimed =
    typeof r.totalClaimed === 'number' && Number.isFinite(r.totalClaimed)
      ? Math.max(0, Math.floor(r.totalClaimed))
      : 0;
  const buffKind: FairyBuffKind | null =
    r.buffKind === 'stones' || r.buffKind === 'explore' ? r.buffKind : null;
  const buffUntil =
    typeof r.buffUntil === 'number' && Number.isFinite(r.buffUntil) ? Math.max(0, r.buffUntil) : 0;

  return {
    cooldownSec: giftsReady >= maxGifts ? FAIRY_BASE_COOLDOWN_SEC : cooldownSec,
    giftsReady,
    totalClaimed,
    buffKind,
    buffUntil,
  };
}

export function advanceFairyCooldown(
  fairy: FairyState,
  deltaSec: number,
  maxGifts: number,
): boolean {
  if (deltaSec <= 0) return false;
  if (fairy.giftsReady >= maxGifts) {
    fairy.cooldownSec = FAIRY_BASE_COOLDOWN_SEC;
    return false;
  }

  let added = false;
  fairy.cooldownSec -= deltaSec;
  while (fairy.cooldownSec <= 0 && fairy.giftsReady < maxGifts) {
    fairy.giftsReady += 1;
    fairy.cooldownSec += FAIRY_BASE_COOLDOWN_SEC;
    added = true;
  }
  if (fairy.giftsReady >= maxGifts) {
    fairy.cooldownSec = FAIRY_BASE_COOLDOWN_SEC;
  }
  return added;
}

export function getActiveFairyBuff(
  fairy: FairyState,
  now = Date.now(),
): { kind: FairyBuffKind; remainingSec: number } | null {
  if (!fairy.buffKind || fairy.buffUntil <= now) return null;
  return {
    kind: fairy.buffKind,
    remainingSec: Math.ceil((fairy.buffUntil - now) / 1000),
  };
}

export function claimFairyGift(
  state: GameState,
  rng: () => number = Math.random,
  now = Date.now(),
): FairyClaimResult | null {
  if (state.fairy.giftsReady <= 0) return null;

  const rank = getFairyRank(state.maxStage, state.cleared100);
  const profile = getFairyProfile(rank);

  state.fairy.giftsReady -= 1;
  state.fairy.totalClaimed += 1;
  if (state.fairy.giftsReady === profile.maxGifts - 1 && state.fairy.cooldownSec <= 0) {
    state.fairy.cooldownSec = FAIRY_BASE_COOLDOWN_SEC;
  }

  const stones = Math.max(
    6,
    Math.round((8 + state.stage * 2.2) * (1 + rank * 0.25) * (0.9 + rng() * 0.25)),
  );
  const mythicChests = profile.mythicChestChance > 0 && rng() < profile.mythicChestChance ? 1 : 0;
  const chests = mythicChests === 0 && rng() < profile.chestChance ? 1 : 0;

  let buffKind: FairyBuffKind | null = null;
  const buffChance = rank >= 1 ? 0.45 : 0.22;
  if (rng() < buffChance) {
    buffKind = rng() < 0.55 ? 'stones' : 'explore';
    state.fairy.buffKind = buffKind;
    state.fairy.buffUntil = now + FAIRY_BUFF_DURATION_MS;
  }

  state.stones += stones;
  state.chests += chests;
  state.mythicChests += mythicChests;

  const parts = [`💎+${stones}`];
  if (chests > 0) parts.push(`📦宝箱+${chests}`);
  if (mythicChests > 0) parts.push(`🌈虹箱+${mythicChests}`);
  if (buffKind === 'stones') parts.push(`✨石+${profile.buffStonePct}%`);
  else if (buffKind === 'explore') parts.push(`✨探索+${profile.buffExplorePct}%`);

  return {
    stones,
    chests,
    mythicChests,
    buffKind,
    summaryText: parts.join(' '),
  };
}

export function getFairySpeech(opts: {
  giftsReady: number;
  bossActive: boolean;
  buffKind: FairyBuffKind | null;
  rank: number;
}): string {
  if (opts.giftsReady > 0) {
    return opts.giftsReady >= 2
      ? `お土産が ${opts.giftsReady}個 たまってるよ！`
      : 'お土産みつけたよ！クリックしてね';
  }
  if (opts.bossActive) {
    return 'ボス戦だ！気合入れていこー！';
  }
  if (opts.buffKind === 'stones') {
    return '強化石ドロップ応援中〜♪';
  }
  if (opts.buffKind === 'explore') {
    return '追い風で探索スピードUP！';
  }
  if (opts.rank >= 2) {
    return 'たまに🌈虹箱も拾ってくるかも？';
  }
  return '敵を倒すとお土産が早く届くよ♪';
}
