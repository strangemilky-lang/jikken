export type RarityId = 0 | 1 | 2 | 3 | 4;

export type ItemSlot = 'weapon' | 'armor' | 'accessory';

export type AccessoryAxis = 'ice' | 'fire' | 'lightning' | 'dark';

export type EquipSlotKey = 'weapon' | 'armor' | 'acc1' | 'acc2';

export type SlotKey = EquipSlotKey;

export type AccessoryComboId =
  | 'ice+ice'
  | 'fire+fire'
  | 'lightning+lightning'
  | 'dark+dark'
  | 'ice+fire'
  | 'ice+lightning'
  | 'ice+dark'
  | 'fire+lightning'
  | 'fire+dark'
  | 'lightning+dark';

export type MainStatType = 'atk' | 'hp' | 'multiHitRate' | 'dmgPct' | 'critRate' | 'armorPen';

export type SubStatKey =
  | 'atkPct'
  | 'critRate'
  | 'critDmg'
  | 'dmgPct'
  | 'armorPen'
  | 'bossDmg';

export type StorageFilter = 'all' | 'weapon' | 'armor' | 'accessory' | AccessoryAxis;

export type MoveStyle = 'smooth' | 'step';

export type CrawlSizeMode = 'small' | 'large';

export type SalvageBulkMode = 'common' | 'rare' | 'epic' | 'weaker';

export type SortMode = 'newest' | 'rarity' | 'stage' | 'level';

export type ItemLocation = 'bag' | 'stash';

export type WindowKey = 'equipped' | 'bag' | 'stash';

export type EnemyArchetype = 'normal' | 'armored' | 'striker';

export interface DragItemPayload {
  itemId: string;
  source: ItemLocation;
  slot: ItemSlot;
  accAxis?: AccessoryAxis;
}

export interface SubStat {
  key: SubStatKey;
  val: number;
  boosts: number;
}

export interface Item {
  id: string;
  slot: ItemSlot;
  accAxis?: AccessoryAxis;
  name: string;
  icon: string;
  rarity: RarityId;
  stage: number;
  level: number;
  locked: boolean;
  spentStones: number;
  createdAt: number;
  mainStat: {
    type: MainStatType;
    base: number;
  };
  subStats: SubStat[];
}

export type EquippedSet = Record<EquipSlotKey, Item>;

export interface LogEntry {
  ts: string;
  msg: string;
  color: string | null;
}

export type FairyBuffKind = 'stones' | 'explore';

export interface FairyState {
  cooldownSec: number;
  giftsReady: number;
  totalClaimed: number;
  buffKind: FairyBuffKind | null;
  buffUntil: number;
}

export interface GameState {
  stage: number;
  maxStage: number;
  floorEncounters: number;
  autoProgress: boolean;
  autoSalvageRarity: number;
  stones: number;
  kills: number;
  chests: number;
  mythicChests: number;
  sanctumKeys: number;
  clearedSanctumMax: number;
  cleared100: boolean;
  maxDmg: number;
  soundOn: boolean;
  equipped: EquippedSet;
  inventory: Item[];
  stash: Item[];
  fairy: FairyState;
  logs: Array<LogEntry | string>;
  lastSaveTime: number;
}

export interface HeroStats {
  atk: number;
  hp: number;
  multiHitRate: number;
  critRate: number;
  critDmg: number;
  dmgPct: number;
  armorPen: number;
  rawArmorPen: number;
  bossDmg: number;
  mythicCount: number;
  comboId: AccessoryComboId;
  offlinePower: number;
}

export type SpriteKey =
  | 'slime'
  | 'goblin'
  | 'wolf'
  | 'king_slime'
  | 'scorpion'
  | 'mummy'
  | 'snake'
  | 'golem'
  | 'lizard'
  | 'wisp'
  | 'oni'
  | 'dragon'
  | 'snowman'
  | 'ice_wolf'
  | 'yeti'
  | 'ice_dragon'
  | 'skeleton'
  | 'vampire'
  | 'demon_knight'
  | 'abyss_general'
  | 'golden_slime'
  | 'great_demon'
  | 'stairs'
  | 'chest_gold'
  | 'chest_sealed'
  | 'chest_mythic'
  | 'chest_open'
  | 'sanctum_key'
  | 'loot_weapon'
  | 'loot_armor'
  | 'loot_accessory'
  | 'loot_stones'
  | 'loot_heal';

export interface Enemy {
  name: string;
  icon: string;
  spriteId: SpriteKey;
  archetype: EnemyArchetype;
  isBoss: boolean;
  isKeyKeeper?: boolean;
  isMidBoss: boolean;
  isSanctumBoss: boolean;
  isGreatDemon: boolean;
  isRareEscape: boolean;
  maxHp: number;
  hp: number;
  atk: number;
  defRate: number;
}

export interface MazeCell {
  x: number;
  y: number;
}

export interface DungeonRoom {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  isMonsterHouse: boolean;
  entrances: MazeCell[];
}

export type FloorLootType = 'chest' | 'weapon' | 'armor' | 'accessory' | 'stones' | 'heal';

export interface MazeEvent {
  id?: string;
  type: FloorLootType;
  icon: string;
  spriteId?: SpriteKey;
  x: number;
  y: number;
  triggered: boolean;
  roomId?: number;
}

export interface FloorEnemy {
  id: string;
  x: number;
  y: number;
  roomId: number;
  awakened: boolean;
  prevCell?: MazeCell | null;
  atkTimer: number;
  shake: number;
  flashTimer: number;
  rareEscapeTimer: number;
  enemy: Enemy;
}

export interface FloorPalette {
  name: string;
  wall: [number, number, number];
  fogWall: [number, number, number];
  ceil0: string;
  ceil1: string;
  floor0: string;
  floor1: string;
}

export interface OfflineSummary {
  durationStr: string;
  kills: number;
  stones: number;
  keptItems: Item[];
  chests: number;
}

export interface GachaPullResult {
  id: string;
  item: Item;
  shouldPromoteAnim: boolean;
  phase: 'waiting' | 'shaking' | 'revealed';
  fakeRarityId?: RarityId;
  committed: boolean;
  salvagedDust: number;
  bagFull: boolean;
  equippedFromModal: boolean;
}
