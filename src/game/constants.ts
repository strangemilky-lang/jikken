import type { EquipSlotKey, FloorPalette, MainStatType, RarityId, SubStatKey } from './types';

export const SAVE_KEY = 'strip_hero_idle_save_v1';
export const CRAWL_SIZE_KEY = 'strip_hero_crawl_size_v2';
export const CRAWL_STYLE_KEY = 'strip_hero_crawl_style_v1';

export const MAX_BAG_SIZE = 60;
export const MAX_STASH_SIZE = 120;
export const MAX_OFFLINE_SEC = 86400; // 24h
export const CHEST_BATCH_MAX = 9; // 3x3 square window layout

export const MAX_EQUIP_LEVEL = 20;
export const MYTHIC_MAX_EQUIP_LEVEL = 40;
export const SUBSTAT_STEP_INTERVAL = 4;
export const MAX_SUBSTAT_COUNT = 4;
export const ROLL_TIER_RATIOS = [0.7, 0.8, 0.9, 1.0] as const;

export const CRAWL_COLS = 25;
export const CRAWL_ROWS = 25;

export const HERO_BASE = {
  atk: 12,
  hp: 110,
  critRate: 10,
  critDmg: 150,
} as const;

export interface RarityInfo {
  id: RarityId;
  name: string;
  color: string;
  border: string;
  bg: string;
  mainMult: number;
  subMult: number;
  maxLv: number;
  initSubs: number;
  dustBase: number;
}

export const RARITIES: RarityInfo[] = [
  { id: 0, name: 'コモン', color: '#cbd5e1', border: '#64748b', bg: 'rgba(203,213,225,0.08)', mainMult: 1.00, subMult: 0.72, maxLv: MAX_EQUIP_LEVEL, initSubs: 1, dustBase: 3 },
  { id: 1, name: 'レア', color: '#38bdf8', border: '#0284c7', bg: 'rgba(56,189,248,0.11)', mainMult: 1.38, subMult: 0.82, maxLv: MAX_EQUIP_LEVEL, initSubs: 2, dustBase: 9 },
  { id: 2, name: 'エピック', color: '#c084fc', border: '#9333ea', bg: 'rgba(192,132,252,0.13)', mainMult: 1.85, subMult: 0.92, maxLv: MAX_EQUIP_LEVEL, initSubs: 3, dustBase: 24 },
  { id: 3, name: 'レジェンダリー', color: '#fbbf24', border: '#d97706', bg: 'rgba(251,191,36,0.14)', mainMult: 2.50, subMult: 1.00, maxLv: MAX_EQUIP_LEVEL, initSubs: 4, dustBase: 60 },
  { id: 4, name: 'ミシック', color: '#f472b6', border: '#ec4899', bg: 'linear-gradient(135deg, rgba(244,114,182,0.20), rgba(56,189,248,0.16), rgba(251,191,36,0.16))', mainMult: 3.70, subMult: 1.08, maxLv: MYTHIC_MAX_EQUIP_LEVEL, initSubs: 4, dustBase: 160 },
];

export const EQUIP_SLOT_ORDER: EquipSlotKey[] = ['weapon', 'armor', 'acc1', 'acc2'];
export const SLOT_ORDER: EquipSlotKey[] = EQUIP_SLOT_ORDER;

export interface EquipSlotDef {
  key: EquipSlotKey;
  label: string;
  shortLabel: string;
  icon: string;
  acceptsItemSlot: 'weapon' | 'armor' | 'accessory';
  mainType?: MainStatType;
  mainLabel?: string;
  unit?: string;
  isFixedCap: boolean;
}

export const EQUIP_SLOTS: Record<EquipSlotKey, EquipSlotDef> = {
  weapon: {
    key: 'weapon',
    label: '武器',
    shortLabel: '武器',
    icon: '⚔️',
    acceptsItemSlot: 'weapon',
    mainType: 'atk',
    mainLabel: '攻撃力',
    unit: '',
    isFixedCap: false,
  },
  armor: {
    key: 'armor',
    label: '防具',
    shortLabel: '防具',
    icon: '🛡️',
    acceptsItemSlot: 'armor',
    mainType: 'hp',
    mainLabel: '最大HP',
    unit: '',
    isFixedCap: false,
  },
  acc1: {
    key: 'acc1',
    label: 'アクセサリ1',
    shortLabel: 'アクセ1',
    icon: '💍',
    acceptsItemSlot: 'accessory',
    isFixedCap: true,
  },
  acc2: {
    key: 'acc2',
    label: 'アクセサリ2',
    shortLabel: 'アクセ2',
    icon: '📿',
    acceptsItemSlot: 'accessory',
    isFixedCap: true,
  },
};

export const SLOTS = EQUIP_SLOTS;

export interface SubStatDef {
  key: SubStatKey;
  label: string;
  unit: string;
  min: number;
  max: number;
}

export const SUB_POOL: SubStatDef[] = [
  { key: 'atkPct', label: '攻撃力', unit: '%', min: 2.8, max: 5.8 },
  { key: 'critRate', label: '会心率', unit: '%', min: 2.5, max: 5.0 },
  { key: 'critDmg', label: '会心ダメ', unit: '%', min: 4.0, max: 8.0 },
  { key: 'dmgPct', label: '与ダメージ', unit: '%', min: 2.5, max: 5.2 },
  { key: 'armorPen', label: '防御貫通', unit: '%', min: 3.5, max: 7.5 },
  { key: 'bossDmg', label: 'ボス特攻', unit: '%', min: 5.0, max: 11.0 },
];

export const SUB_MAP: Record<SubStatKey, SubStatDef> = {
  atkPct: SUB_POOL[0],
  critRate: SUB_POOL[1],
  critDmg: SUB_POOL[2],
  dmgPct: SUB_POOL[3],
  armorPen: SUB_POOL[4],
  bossDmg: SUB_POOL[5],
};

export const PREFIXES: string[][] = [
  ['古びた', '鉄の', '旅人の', '見習いの', '標準の'],
  ['熟練の', '鋭利な', '蒼き', '鋼の', '魔導の'],
  ['英雄の', '紫電の', '覇者の', '深淵の', '幻影の'],
  ['神域の', '竜殺しの', '星辰の', '創世の', '超越の'],
  ['虹輝の', '無限の', '終焉の', '天地創造の', '神話級'],
];

export const BASE_NAMES: Record<'weapon' | 'armor', Array<{ name: string; icon: string }>> = {
  weapon: [
    { name: '剣', icon: '🗡️' }, { name: '大剣', icon: '⚔️' }, { name: '戦斧', icon: '🪓' },
    { name: '長槍', icon: '🔱' }, { name: '刀', icon: '🗡️' }, { name: '聖剣', icon: '⚔️' },
  ],
  armor: [
    { name: '戦衣', icon: '👕' }, { name: '胸当て', icon: '🦺' }, { name: '重鎧', icon: '🛡️' },
    { name: '外套', icon: '🥋' }, { name: '聖鎧', icon: '🛡️' },
  ],
};

export const BIOMES = [
  {
    name: '🌲 緑の草原',
    mobs: [
      { name: 'スライム', icon: '🟢', spriteId: 'slime' as const },
      { name: 'ゴブリン', icon: '👺', spriteId: 'goblin' as const },
      { name: '野狼', icon: '🐺', spriteId: 'wolf' as const },
    ],
    boss: { name: 'キングスライム', icon: '🦠', spriteId: 'king_slime' as const },
  },
  {
    name: '🌵 灼熱の砂漠',
    mobs: [
      { name: '大サソリ', icon: '🦂', spriteId: 'scorpion' as const },
      { name: '砂漠ミイラ', icon: '🤕', spriteId: 'mummy' as const },
      { name: '毒蛇', icon: '🐍', spriteId: 'snake' as const },
    ],
    boss: { name: '砂塵ゴーレム', icon: '🗿', spriteId: 'golem' as const },
  },
  {
    name: '🌋 紅蓮の火山',
    mobs: [
      { name: '炎トカゲ', icon: '🦎', spriteId: 'lizard' as const },
      { name: '鬼火', icon: '🔥', spriteId: 'wisp' as const },
      { name: '爆砕鬼', icon: '👹', spriteId: 'oni' as const },
    ],
    boss: { name: '獄炎ドラゴン', icon: '🐉', spriteId: 'dragon' as const },
  },
  {
    name: '❄️ 極寒の雪原',
    mobs: [
      { name: '雪だるま魔', icon: '⛄', spriteId: 'snowman' as const },
      { name: '氷狼', icon: '🐺', spriteId: 'ice_wolf' as const },
      { name: '雪男', icon: '🦍', spriteId: 'yeti' as const },
    ],
    boss: { name: '白銀の氷竜', icon: '🐲', spriteId: 'ice_dragon' as const },
  },
  {
    name: '🏰 闇の魔王城',
    mobs: [
      { name: '骸骨剣士', icon: '💀', spriteId: 'skeleton' as const },
      { name: '吸血鬼', icon: '🧛', spriteId: 'vampire' as const },
      { name: '悪魔騎士', icon: '👿', spriteId: 'demon_knight' as const },
    ],
    boss: { name: '深淵の将軍', icon: '😈', spriteId: 'abyss_general' as const },
  },
];

export const FLOOR_PALETTES: FloorPalette[] = [
  { name: '地下迷宮', wall: [96, 116, 158], fogWall: [15, 23, 42], ceil0: '#05070f', ceil1: '#1b2a4a', floor0: '#233149', floor1: '#0a0f1c' },
  { name: '黄金神殿', wall: [176, 142, 74], fogWall: [42, 31, 14], ceil0: '#140f05', ceil1: '#423114', floor0: '#4a3818', floor1: '#1a1207' },
  { name: '紅蓮深淵', wall: [164, 66, 72], fogWall: [44, 12, 16], ceil0: '#140406', ceil1: '#451218', floor0: '#4a181d', floor1: '#1a0608' },
  { name: '翡翠魔窟', wall: [64, 152, 122], fogWall: [12, 38, 30], ceil0: '#04120e', ceil1: '#123b2e', floor0: '#164536', floor1: '#061712' },
  { name: '虚空星界', wall: [138, 92, 188], fogWall: [28, 16, 48], ceil0: '#090414', ceil1: '#2a164a', floor0: '#311a54', floor1: '#0e061c' },
];
