export type RarityId = 0 | 1 | 2 | 3 | 4;

export type SlotKey = 'weapon' | 'armor' | 'ring' | 'necklace' | 'gauntlets' | 'boots';

export type MainStatType = 'atk' | 'hp' | 'critRate' | 'critDmg' | 'atkPct' | 'dmgPct';

export type SubStatKey =
  | 'atkPct'
  | 'critRate'
  | 'critDmg'
  | 'dmgPct'
  | 'armorPen'
  | 'bossDmg';

export type MoveStyle = 'smooth' | 'step';

export type CrawlSizeMode = 'small' | 'large';

export type SalvageBulkMode = 'common' | 'rare' | 'epic' | 'weaker';

export type SortMode = 'newest' | 'rarity' | 'stage' | 'level';

export type ItemLocation = 'bag' | 'stash';

export type WindowKey = 'party' | 'equipped' | 'bag' | 'stash';

export type JobId = 'warrior' | 'mage' | 'cleric' | 'ranger' | 'assassin';

export type UniqueAffixKey =
  | 'vampiric'
  | 'first_strike'
  | 'cleave'
  | 'double_hit'
  | 'thorns'
  | 'treasure';

export interface UniqueAffix {
  key: UniqueAffixKey;
  val: number;
}

export interface PartyMemberEquipment {
  weapon: Item;
  armor: Item;
}

export interface PartyMemberState {
  id: JobId;
  unlocked: boolean;
  level: number;
  exp: number;
  unspentSp: number;
  skills: Record<string, number>;
  equipment: PartyMemberEquipment;
}

export interface PartyState {
  activeIds: [JobId, JobId, JobId];
  roster: Record<JobId, PartyMemberState>;
}

export interface DragItemPayload {
  itemId: string;
  source: ItemLocation;
  slot: SlotKey;
}

export interface SubStat {
  key: SubStatKey;
  val: number;
  boosts: number;
}

export interface Item {
  id: string;
  slot: SlotKey;
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
  uniqueAffix?: UniqueAffix | null;
  reforgedSubIdx?: number | null;
  reforgeCount?: number;
}

export type EquippedSet = Record<SlotKey, Item>;

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
  party: PartyState;
  inventory: Item[];
  stash: Item[];
  fairy: FairyState;
  logs: Array<LogEntry | string>;
  lastSaveTime: number;
}

export interface HeroStats {
  atk: number;
  hp: number;
  critRate: number;
  critDmg: number;
  dmgPct: number;
  armorPen: number;
  bossDmg: number;
  mythicCount: number;
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
