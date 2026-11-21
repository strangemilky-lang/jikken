import type {
  AccessoryAxis,
  AccessoryComboId,
  Enemy,
  HeroStats,
  Item,
  MainStatType,
} from './types';

export interface AccessoryAxisDef {
  axis: AccessoryAxis;
  name: string;
  shortLabel: string;
  tag: string;
  icon: string;
  mainType: MainStatType;
  mainLabel: string;
  unit: string;
  base: number;
  color: string;
  borderColor: string;
  bgTint: string;
  starterName: string;
  baseNames: Array<{ name: string; icon: string }>;
}

export const ACCESSORY_AXIS_ORDER: AccessoryAxis[] = ['ice', 'fire', 'lightning', 'dark'];

export const ACCESSORY_AXES: Record<AccessoryAxis, AccessoryAxisDef> = {
  ice: {
    axis: 'ice',
    name: '氷・疾風',
    shortLabel: '氷',
    tag: '連撃',
    icon: '❄️',
    mainType: 'multiHitRate',
    mainLabel: '連撃率',
    unit: '%',
    base: 7.5,
    color: '#38bdf8',
    borderColor: 'rgba(56, 189, 248, 0.55)',
    bgTint: 'rgba(56, 189, 248, 0.14)',
    starterName: '氷晶の指輪',
    baseNames: [
      { name: '氷晶環', icon: '❄️' },
      { name: '疾風の護符', icon: '🌬️' },
      { name: '霜華の腕輪', icon: '💎' },
    ],
  },
  fire: {
    axis: 'fire',
    name: '炎・紅蓮',
    shortLabel: '炎',
    tag: '火力',
    icon: '🔥',
    mainType: 'dmgPct',
    mainLabel: '与ダメージ',
    unit: '%',
    base: 6.5,
    color: '#fb7185',
    borderColor: 'rgba(251, 113, 133, 0.55)',
    bgTint: 'rgba(251, 113, 133, 0.14)',
    starterName: '紅蓮の首飾り',
    baseNames: [
      { name: '紅蓮の首飾', icon: '🔥' },
      { name: '業火の勲章', icon: '🏮' },
      { name: '烈火の宝玉', icon: '♦️' },
    ],
  },
  lightning: {
    axis: 'lightning',
    name: '雷・閃光',
    shortLabel: '雷',
    tag: '会心',
    icon: '⚡',
    mainType: 'critRate',
    mainLabel: '会心率',
    unit: '%',
    base: 5.5,
    color: '#facc15',
    borderColor: 'rgba(250, 204, 21, 0.55)',
    bgTint: 'rgba(250, 204, 21, 0.14)',
    starterName: '紫電の耳飾り',
    baseNames: [
      { name: '紫電の指輪', icon: '⚡' },
      { name: '閃光の印章', icon: '✨' },
      { name: '雷鳴の耳飾', icon: '🌩️' },
    ],
  },
  dark: {
    axis: 'dark',
    name: '闇・破砕',
    shortLabel: '闇',
    tag: '貫通',
    icon: '🌑',
    mainType: 'armorPen',
    mainLabel: '防御貫通',
    unit: '%',
    base: 5.5,
    color: '#c084fc',
    borderColor: 'rgba(192, 132, 252, 0.55)',
    bgTint: 'rgba(168, 85, 247, 0.16)',
    starterName: '深淵の小手',
    baseNames: [
      { name: '深淵の小手', icon: '🌑' },
      { name: '破砕の紋章', icon: '🔮' },
      { name: '冥黒の首輪', icon: '⛓️' },
    ],
  },
};

export type ComboSlashStyle =
  | 'flurry'
  | 'cleave'
  | 'bolt'
  | 'shatter'
  | 'frostfire'
  | 'twin_spark'
  | 'pierce'
  | 'flare_bolt'
  | 'molten_crush'
  | 'judgment';

export interface ComboVfxProfile {
  primaryColor: string;
  secondaryColor: string;
  particleColors: string[];
  slashStyle: ComboSlashStyle;
  slashThickness: number;
  extraHitstopSec: number;
  shakeScale: number;
  staggerSec: number;
  flashColor: string;
  particleCount: number;
}

export interface AccessoryComboDef {
  id: AccessoryComboId;
  axes: [AccessoryAxis, AccessoryAxis];
  isPure: boolean;
  name: string;
  icons: string;
  effectText: string;
  vfxLabel: string;
  accentColor: string;
  badgeBg: string;
  badgeBorder: string;
  vfx: ComboVfxProfile;
}

export const ACCESSORY_COMBOS: Record<AccessoryComboId, AccessoryComboDef> = {
  'ice+ice': {
    id: 'ice+ice',
    axes: ['ice', 'ice'],
    isPure: true,
    name: '氷嵐乱舞',
    icons: '❄️❄️',
    effectText: '3連撃目以降の追撃威力 +8%（55%→63%）',
    vfxLabel: '多段氷刃乱舞',
    accentColor: '#38bdf8',
    badgeBg: 'rgba(56, 189, 248, 0.18)',
    badgeBorder: 'rgba(56, 189, 248, 0.6)',
    vfx: {
      primaryColor: '#7dd3fc',
      secondaryColor: '#e0f2fe',
      particleColors: ['#38bdf8', '#bae6fd', '#ffffff'],
      slashStyle: 'flurry',
      slashThickness: 3.4,
      extraHitstopSec: 0,
      shakeScale: 0.9,
      staggerSec: 0.085,
      flashColor: 'rgba(125, 211, 252, 0.25)',
      particleCount: 16,
    },
  },
  'fire+fire': {
    id: 'fire+fire',
    axes: ['fire', 'fire'],
    isPure: true,
    name: '紅蓮爆砕',
    icons: '🔥🔥',
    effectText: 'HP60%以上の敵への与ダメージ +12%',
    vfxLabel: '極大爆炎重撃',
    accentColor: '#fb7185',
    badgeBg: 'rgba(244, 63, 94, 0.2)',
    badgeBorder: 'rgba(251, 113, 133, 0.65)',
    vfx: {
      primaryColor: '#fb7185',
      secondaryColor: '#f97316',
      particleColors: ['#ef4444', '#f97316', '#fde047'],
      slashStyle: 'cleave',
      slashThickness: 6.2,
      extraHitstopSec: 0.02,
      shakeScale: 1.55,
      staggerSec: 0.1,
      flashColor: 'rgba(249, 115, 22, 0.30)',
      particleCount: 22,
    },
  },
  'lightning+lightning': {
    id: 'lightning+lightning',
    axes: ['lightning', 'lightning'],
    isPure: true,
    name: '紫電極光',
    icons: '⚡⚡',
    effectText: '会心ダメージ +22%',
    vfxLabel: '虹色閃雷花火',
    accentColor: '#facc15',
    badgeBg: 'rgba(250, 204, 21, 0.18)',
    badgeBorder: 'rgba(250, 204, 21, 0.65)',
    vfx: {
      primaryColor: '#fde047',
      secondaryColor: '#e879f9',
      particleColors: ['#fde047', '#38bdf8', '#f472b6', '#ffffff'],
      slashStyle: 'bolt',
      slashThickness: 4.4,
      extraHitstopSec: 0.015,
      shakeScale: 1.25,
      staggerSec: 0.09,
      flashColor: 'rgba(250, 204, 21, 0.28)',
      particleCount: 24,
    },
  },
  'dark+dark': {
    id: 'dark+dark',
    axes: ['dark', 'dark'],
    isPure: true,
    name: '深淵破砕',
    icons: '🌑🌑',
    effectText: '防御貫通100%超過分の35%を重装・ボス特攻へ変換（上限+40%）',
    vfxLabel: '重撃装甲粉砕',
    accentColor: '#c084fc',
    badgeBg: 'rgba(168, 85, 247, 0.22)',
    badgeBorder: 'rgba(192, 132, 252, 0.65)',
    vfx: {
      primaryColor: '#a855f7',
      secondaryColor: '#f43f5e',
      particleColors: ['#9333ea', '#c084fc', '#f43f5e', '#1e1b4b'],
      slashStyle: 'shatter',
      slashThickness: 5.8,
      extraHitstopSec: 0.045,
      shakeScale: 1.65,
      staggerSec: 0.11,
      flashColor: 'rgba(147, 51, 234, 0.30)',
      particleCount: 22,
    },
  },
  'ice+fire': {
    id: 'ice+fire',
    axes: ['ice', 'fire'],
    isPure: false,
    name: '凍炎交錯',
    icons: '❄️🔥',
    effectText: '連撃発生時、最終ヒットの与ダメージ +15%',
    vfxLabel: '冷気と爆炎の交錯',
    accentColor: '#38bdf8',
    badgeBg: 'linear-gradient(135deg, rgba(56,189,248,0.20), rgba(249,115,22,0.22))',
    badgeBorder: 'rgba(251, 146, 60, 0.6)',
    vfx: {
      primaryColor: '#38bdf8',
      secondaryColor: '#fb923c',
      particleColors: ['#38bdf8', '#bae6fd', '#f97316', '#ef4444'],
      slashStyle: 'frostfire',
      slashThickness: 4.6,
      extraHitstopSec: 0.015,
      shakeScale: 1.25,
      staggerSec: 0.095,
      flashColor: 'rgba(251, 146, 60, 0.24)',
      particleCount: 20,
    },
  },
  'ice+lightning': {
    id: 'ice+lightning',
    axes: ['ice', 'lightning'],
    isPure: false,
    name: '迅雷氷牙',
    icons: '❄️⚡',
    effectText: '追撃ヒットの会心率 +10%',
    vfxLabel: '氷牙と稲妻の連閃',
    accentColor: '#67e8f9',
    badgeBg: 'linear-gradient(135deg, rgba(56,189,248,0.20), rgba(250,204,21,0.20))',
    badgeBorder: 'rgba(103, 232, 249, 0.6)',
    vfx: {
      primaryColor: '#38bdf8',
      secondaryColor: '#fde047',
      particleColors: ['#38bdf8', '#fde047', '#ffffff'],
      slashStyle: 'twin_spark',
      slashThickness: 3.8,
      extraHitstopSec: 0.008,
      shakeScale: 1.05,
      staggerSec: 0.085,
      flashColor: 'rgba(103, 232, 249, 0.24)',
      particleCount: 18,
    },
  },
  'ice+dark': {
    id: 'ice+dark',
    axes: ['ice', 'dark'],
    isPure: false,
    name: '零度穿孔',
    icons: '❄️🌑',
    effectText: '2ヒット目以降の防御貫通 +12%',
    vfxLabel: '氷結装甲穿ち',
    accentColor: '#818cf8',
    badgeBg: 'linear-gradient(135deg, rgba(56,189,248,0.20), rgba(168,85,247,0.22))',
    badgeBorder: 'rgba(129, 140, 248, 0.6)',
    vfx: {
      primaryColor: '#67e8f9',
      secondaryColor: '#a855f7',
      particleColors: ['#38bdf8', '#a855f7', '#e0e7ff'],
      slashStyle: 'pierce',
      slashThickness: 4.2,
      extraHitstopSec: 0.02,
      shakeScale: 1.15,
      staggerSec: 0.09,
      flashColor: 'rgba(129, 140, 248, 0.25)',
      particleCount: 18,
    },
  },
  'fire+lightning': {
    id: 'fire+lightning',
    axes: ['fire', 'lightning'],
    isPure: false,
    name: '爆雷一閃',
    icons: '🔥⚡',
    effectText: '会心発生時の与ダメージ +8%',
    vfxLabel: '紅蓮雷光の十字閃',
    accentColor: '#fb923c',
    badgeBg: 'linear-gradient(135deg, rgba(244,63,94,0.20), rgba(250,204,21,0.20))',
    badgeBorder: 'rgba(251, 146, 60, 0.65)',
    vfx: {
      primaryColor: '#f97316',
      secondaryColor: '#fde047',
      particleColors: ['#f97316', '#fde047', '#ef4444', '#ffffff'],
      slashStyle: 'flare_bolt',
      slashThickness: 5.2,
      extraHitstopSec: 0.02,
      shakeScale: 1.4,
      staggerSec: 0.1,
      flashColor: 'rgba(251, 191, 36, 0.28)',
      particleCount: 22,
    },
  },
  'fire+dark': {
    id: 'fire+dark',
    axes: ['fire', 'dark'],
    isPure: false,
    name: '業火粉砕',
    icons: '🔥🌑',
    effectText: '重装・ボスへの与ダメージ +10%',
    vfxLabel: '黒炎の重装砕き',
    accentColor: '#f43f5e',
    badgeBg: 'linear-gradient(135deg, rgba(244,63,94,0.22), rgba(147,51,234,0.24))',
    badgeBorder: 'rgba(244, 63, 94, 0.65)',
    vfx: {
      primaryColor: '#f43f5e',
      secondaryColor: '#9333ea',
      particleColors: ['#ef4444', '#9333ea', '#fb923c'],
      slashStyle: 'molten_crush',
      slashThickness: 5.6,
      extraHitstopSec: 0.032,
      shakeScale: 1.5,
      staggerSec: 0.105,
      flashColor: 'rgba(225, 29, 72, 0.28)',
      particleCount: 22,
    },
  },
  'lightning+dark': {
    id: 'lightning+dark',
    axes: ['lightning', 'dark'],
    isPure: false,
    name: '闇雷断罪',
    icons: '⚡🌑',
    effectText: '会心発生時、その一撃の防御貫通 +12%',
    vfxLabel: '紫闇雷撃の断罪',
    accentColor: '#d8b4fe',
    badgeBg: 'linear-gradient(135deg, rgba(250,204,21,0.18), rgba(168,85,247,0.24))',
    badgeBorder: 'rgba(216, 180, 254, 0.65)',
    vfx: {
      primaryColor: '#fde047',
      secondaryColor: '#9333ea',
      particleColors: ['#fde047', '#a855f7', '#ffffff'],
      slashStyle: 'judgment',
      slashThickness: 4.8,
      extraHitstopSec: 0.026,
      shakeScale: 1.35,
      staggerSec: 0.095,
      flashColor: 'rgba(192, 132, 252, 0.28)',
      particleCount: 20,
    },
  },
};

export function inferAccessoryAxis(item: Pick<Item, 'accAxis' | 'mainStat'> | null | undefined): AccessoryAxis {
  if (!item) return 'fire';
  if (item.accAxis && item.accAxis in ACCESSORY_AXES) {
    return item.accAxis;
  }
  if (item.mainStat.type === 'multiHitRate') return 'ice';
  if (item.mainStat.type === 'critRate') return 'lightning';
  if (item.mainStat.type === 'armorPen') return 'dark';
  return 'fire';
}

export function getAccessoryComboId(axisA: AccessoryAxis, axisB: AccessoryAxis): AccessoryComboId {
  const idxA = ACCESSORY_AXIS_ORDER.indexOf(axisA);
  const idxB = ACCESSORY_AXIS_ORDER.indexOf(axisB);
  const first = idxA <= idxB ? axisA : axisB;
  const second = idxA <= idxB ? axisB : axisA;
  return `${first}+${second}` as AccessoryComboId;
}

export function getAccessoryCombo(
  acc1: Pick<Item, 'accAxis' | 'mainStat'> | null | undefined,
  acc2: Pick<Item, 'accAxis' | 'mainStat'> | null | undefined,
): AccessoryComboDef {
  const axis1 = inferAccessoryAxis(acc1);
  const axis2 = inferAccessoryAxis(acc2);
  return ACCESSORY_COMBOS[getAccessoryComboId(axis1, axis2)];
}

export const FOLLOW_UP_DAMAGE_RATIO = 0.55;
export const ICE_PURE_THIRD_HIT_RATIO = 0.63;
export const MAX_EXTRA_MULTI_HITS = 4;

export function rollExtraHits(multiHitRate: number, rng: () => number = Math.random): number {
  const clamped = Math.max(0, multiHitRate);
  if (clamped <= 0) return 0;
  const guaranteed = Math.floor(clamped / 100);
  const remainderPct = clamped % 100;
  const bonus = remainderPct > 0 && rng() * 100 < remainderPct ? 1 : 0;
  return Math.min(MAX_EXTRA_MULTI_HITS, guaranteed + bonus);
}

export function getExpectedMultiHitMultiplier(multiHitRate: number, comboId: AccessoryComboId): number {
  const clamped = Math.max(0, multiHitRate);
  const expectedExtra = Math.min(MAX_EXTRA_MULTI_HITS, clamped / 100);
  if (expectedExtra <= 0) return 1;
  if (comboId === 'ice+ice' && expectedExtra > 1) {
    const firstFollowUp = Math.min(1, expectedExtra) * FOLLOW_UP_DAMAGE_RATIO;
    const furtherFollowUps = Math.max(0, expectedExtra - 1) * ICE_PURE_THIRD_HIT_RATIO;
    return 1 + firstFollowUp + furtherFollowUps;
  }
  return 1 + expectedExtra * FOLLOW_UP_DAMAGE_RATIO;
}

export interface TurnHitResult {
  hitIndex: number;
  totalHits: number;
  isFollowUp: boolean;
  isFinalHit: boolean;
  dmg: number;
  critTier: 0 | 1 | 2 | 3;
  multFactor: number;
  effectiveArmorPen: number;
  label: string;
  cssClass: string;
}

export interface TurnAttackPlan {
  combo: AccessoryComboDef;
  hits: TurnHitResult[];
  totalDmg: number;
  maxHitDmg: number;
  highestCritTier: 0 | 1 | 2 | 3;
}

function rollCritTierFromRate(critRate: number, rng: () => number): 0 | 1 | 2 | 3 {
  if (critRate >= 200) {
    return rng() * 100 < critRate - 200 ? 3 : 2;
  }
  if (critRate >= 100) {
    return rng() * 100 < critRate - 100 ? 2 : 1;
  }
  return rng() * 100 < critRate ? 1 : 0;
}

function computeSingleHitDamage(
  stats: HeroStats,
  effectiveArmorPen: number,
  enemyDefRate: number,
  isBoss: boolean,
  critTier: 0 | 1 | 2 | 3,
  multFactor: number,
  variance: number,
): number {
  const dmgMult = 1 + stats.dmgPct / 100;
  const bossMult = isBoss ? 1 + stats.bossDmg / 100 : 1;
  const baseAtk = stats.atk * dmgMult * bossMult * multFactor;

  const c = stats.critDmg / 100;
  let tierMult = 1;
  if (critTier === 1) tierMult = c;
  else if (critTier === 2) tierMult = c * 2.0;
  else if (critTier === 3) tierMult = c * 4.0;

  const pen = Math.max(0, Math.min(1, effectiveArmorPen / 100));
  const defMult = Math.max(0.1, Math.min(1, 1 - enemyDefRate * (1 - pen)));

  return Math.max(1, Math.round(baseAtk * tierMult * defMult * variance));
}

export function resolveTurnAttackPlan(
  stats: HeroStats,
  enemy: Pick<Enemy, 'hp' | 'maxHp' | 'defRate' | 'isBoss' | 'archetype'>,
  cleared100: boolean,
  rng: () => number = Math.random,
  fixedVariance?: number,
): TurnAttackPlan {
  const combo = ACCESSORY_COMBOS[stats.comboId];
  const extraHits = rollExtraHits(stats.multiHitRate, rng);
  const totalHits = 1 + extraHits;
  const isHeavyOrBoss = enemy.isBoss || enemy.archetype === 'armored';
  const enemyHpRatio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
  const maxCritCap = cleared100 ? 300 : 100;

  const hits: TurnHitResult[] = [];
  let totalDmg = 0;
  let maxHitDmg = 0;
  let highestCritTier: 0 | 1 | 2 | 3 = 0;

  for (let i = 0; i < totalHits; i++) {
    const isFollowUp = i > 0;
    const isFinalHit = i === totalHits - 1;

    let multFactor = isFollowUp
      ? combo.id === 'ice+ice' && i >= 2
        ? ICE_PURE_THIRD_HIT_RATIO
        : FOLLOW_UP_DAMAGE_RATIO
      : 1.0;

    if (combo.id === 'ice+fire' && totalHits > 1 && isFinalHit) {
      multFactor *= 1.15;
    }
    if (combo.id === 'fire+fire' && enemyHpRatio >= 0.6) {
      multFactor *= 1.12;
    }
    if (combo.id === 'fire+dark' && isHeavyOrBoss) {
      multFactor *= 1.1;
    }
    if (combo.id === 'dark+dark' && isHeavyOrBoss && stats.rawArmorPen > 100) {
      const excessBonus = Math.min(0.4, ((stats.rawArmorPen - 100) * 0.35) / 100);
      multFactor *= 1 + excessBonus;
    }

    const effCritRate = Math.max(
      0,
      Math.min(maxCritCap, stats.critRate + (combo.id === 'ice+lightning' && isFollowUp ? 10 : 0)),
    );
    const critTier = rollCritTierFromRate(effCritRate, rng);

    if (combo.id === 'fire+lightning' && critTier >= 1) {
      multFactor *= 1.08;
    }

    let effectiveArmorPen = stats.armorPen;
    if (combo.id === 'ice+dark' && i >= 1) {
      effectiveArmorPen = Math.min(100, effectiveArmorPen + 12);
    }
    if (combo.id === 'lightning+dark' && critTier >= 1) {
      effectiveArmorPen = Math.min(100, effectiveArmorPen + 12);
    }

    const variance = fixedVariance !== undefined ? fixedVariance : 0.94 + rng() * 0.12;
    const dmg = computeSingleHitDamage(
      stats,
      effectiveArmorPen,
      enemy.defRate,
      enemy.isBoss,
      critTier,
      multFactor,
      variance,
    );

    const hitTag = isFollowUp ? ` (${i + 1}連)` : '';
    const label =
      critTier === 3
        ? `極会心${hitTag}!!`
        : critTier === 2
          ? `超会心${hitTag}!`
          : critTier === 1
            ? `会心${hitTag}`
            : isFollowUp
              ? `${i + 1}連撃`
              : '';
    const cssClass =
      critTier === 3
        ? 'crit-extreme'
        : critTier === 2
          ? 'crit-super'
          : critTier === 1
            ? 'crit'
            : isFollowUp
              ? 'multi'
              : 'hero';

    hits.push({
      hitIndex: i,
      totalHits,
      isFollowUp,
      isFinalHit,
      dmg,
      critTier,
      multFactor,
      effectiveArmorPen,
      label,
      cssClass,
    });

    totalDmg += dmg;
    if (dmg > maxHitDmg) maxHitDmg = dmg;
    if (critTier > highestCritTier) highestCritTier = critTier;
  }

  return {
    combo,
    hits,
    totalDmg,
    maxHitDmg,
    highestCritTier,
  };
}
