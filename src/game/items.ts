import {
  ACCESSORY_AXES,
  ACCESSORY_AXIS_ORDER,
  getAccessoryCombo,
  getExpectedMultiHitMultiplier,
  inferAccessoryAxis,
  type AccessoryAxisDef,
} from './accessories';
import {
  BASE_NAMES,
  EQUIP_SLOT_ORDER,
  HERO_BASE,
  MAX_BAG_SIZE,
  MAX_EQUIP_LEVEL,
  MAX_SUBSTAT_COUNT,
  PREFIXES,
  RARITIES,
  ROLL_TIER_RATIOS,
  SUB_MAP,
  SUB_POOL,
} from './constants';
import type {
  AccessoryAxis,
  EquippedSet,
  GameState,
  HeroStats,
  Item,
  ItemSlot,
  MainStatType,
  RarityId,
  SalvageBulkMode,
  SortMode,
  StorageFilter,
  SubStat,
  SubStatKey,
} from './types';

export const uid = () => 'itm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
export const rand = (min: number, max: number) => Math.random() * (max - min) + min;
export const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const getEquipTierStage = (stage: number) => Math.floor(Math.max(0, stage - 1) / 5) * 5 + 1;

export function fmt(n: number): string {
  if (n >= 1e36) return n.toExponential(2).replace('e+', 'e');
  if (n >= 1e33) return (n / 1e33).toFixed(2) + 'Dc';
  if (n >= 1e30) return (n / 1e30).toFixed(2) + 'No';
  if (n >= 1e27) return (n / 1e27).toFixed(2) + 'Oc';
  if (n >= 1e24) return (n / 1e24).toFixed(2) + 'Sp';
  if (n >= 1e21) return (n / 1e21).toFixed(2) + 'Sx';
  if (n >= 1e18) return (n / 1e18).toFixed(2) + 'Qi';
  if (n >= 1e15) return (n / 1e15).toFixed(2) + 'Qa';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e5) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString('ja-JP');
}

export function formatStatDiff(diff: number, unit: string): { text: string; tone: 'up' | 'down' | 'same' } {
  const absVal = Math.abs(diff);
  if (absVal < 0.001) {
    return { text: `±0${unit}`, tone: 'same' };
  }
  const formatted = fmt(absVal);
  if (diff > 0) {
    return { text: `▲+${formatted}${unit}`, tone: 'up' };
  }
  return { text: `▼-${formatted}${unit}`, tone: 'down' };
}

export interface ItemMainStatMeta {
  slotLabel: string;
  slotIcon: string;
  mainType: MainStatType;
  mainLabel: string;
  unit: string;
  isFixedCap: boolean;
  axisDef: AccessoryAxisDef | null;
}

export function getItemMainStatMeta(item: Pick<Item, 'slot' | 'accAxis' | 'mainStat'>): ItemMainStatMeta {
  if (item.slot === 'weapon') {
    return {
      slotLabel: '武器',
      slotIcon: '⚔️',
      mainType: 'atk',
      mainLabel: '攻撃力',
      unit: '',
      isFixedCap: false,
      axisDef: null,
    };
  }
  if (item.slot === 'armor') {
    return {
      slotLabel: '防具',
      slotIcon: '🛡️',
      mainType: 'hp',
      mainLabel: '最大HP',
      unit: '',
      isFixedCap: false,
      axisDef: null,
    };
  }
  const axis = inferAccessoryAxis(item);
  const def = ACCESSORY_AXES[axis];
  return {
    slotLabel: `アクセ・${def.shortLabel}`,
    slotIcon: def.icon,
    mainType: def.mainType,
    mainLabel: def.mainLabel,
    unit: def.unit,
    isFixedCap: true,
    axisDef: def,
  };
}

export function isFixedCapItem(item: Pick<Item, 'slot'>): boolean {
  return item.slot === 'accessory';
}

export type DropFeaturedCategory = 'weapon' | 'armor' | AccessoryAxis;

export const DROP_FEATURED_CYCLE: DropFeaturedCategory[] = [
  'weapon',
  'armor',
  'ice',
  'fire',
  'lightning',
  'dark',
];

export function getStageFeaturedDrop(stage: number): {
  category: DropFeaturedCategory;
  label: string;
  icon: string;
} {
  const cat = DROP_FEATURED_CYCLE[(Math.max(1, stage) - 1) % DROP_FEATURED_CYCLE.length];
  if (cat === 'weapon') return { category: cat, label: '武器', icon: '⚔️' };
  if (cat === 'armor') return { category: cat, label: '防具', icon: '🛡️' };
  const def = ACCESSORY_AXES[cat];
  return { category: cat, label: `${def.name}`, icon: def.icon };
}

export function rollRarity(stage: number, isBoss: boolean, cleared100: boolean, fromChest = false): RarityId {
  const canMythic = cleared100 || stage >= 101;
  const deepTier = Math.floor(Math.max(0, stage - 1) / 100);
  const stageBonus = Math.min(0.18, (stage - 1) * 0.006);
  const bossBonus = isBoss ? 0.22 : 0;
  const chestBoost = fromChest ? 1.7 : 1.0;

  const pMythic = canMythic ? Math.min(0.14, (0.015 + deepTier * 0.015 + (isBoss ? 0.03 : 0)) * chestBoost) : 0;
  const pLeg = Math.min(0.28, (0.02 + stageBonus * 0.35 + bossBonus * 0.25) * chestBoost);
  const pEpic = Math.min(0.38, (0.10 + stageBonus * 0.55 + bossBonus * 0.40) * chestBoost);
  const pRare = fromChest ? 0.42 : (0.28 + bossBonus * 0.25);

  const r = Math.random();
  if (r < pMythic) return 4;
  if (r < pMythic + pLeg) return 3;
  if (r < pMythic + pLeg + pEpic) return 2;
  if (r < pMythic + pLeg + pEpic + pRare) return 1;
  return 0;
}

export interface GenerateItemOptions {
  stage: number;
  forcedRarity?: RarityId | null;
  forcedSlot?: ItemSlot | null;
  forcedAxis?: AccessoryAxis | null;
  isStarter?: boolean;
  isBoss?: boolean;
  fromChest?: boolean;
  cleared100?: boolean;
}

const STARTER_NAMES: Record<'weapon' | 'armor', string> = {
  weapon: '見習いの剣',
  armor: '旅人の布服',
};

export function generateItem(opts: GenerateItemOptions): Item {
  const {
    stage,
    forcedRarity = null,
    forcedSlot = null,
    forcedAxis = null,
    isStarter = false,
    isBoss = false,
    fromChest = false,
    cleared100 = false,
  } = opts;

  let slot: ItemSlot;
  let accAxis: AccessoryAxis | undefined;

  if (forcedSlot) {
    slot = forcedSlot;
    if (slot === 'accessory') {
      accAxis =
        forcedAxis ||
        ACCESSORY_AXIS_ORDER[randInt(0, ACCESSORY_AXIS_ORDER.length - 1)];
    }
  } else if (forcedAxis) {
    slot = 'accessory';
    accAxis = forcedAxis;
  } else {
    const featured = DROP_FEATURED_CYCLE[(Math.max(1, stage) - 1) % DROP_FEATURED_CYCLE.length];
    const picked =
      Math.random() < 0.46
        ? featured
        : DROP_FEATURED_CYCLE.filter((c) => c !== featured)[randInt(0, DROP_FEATURED_CYCLE.length - 2)];
    if (picked === 'weapon' || picked === 'armor') {
      slot = picked;
    } else {
      slot = 'accessory';
      accAxis = picked;
    }
  }

  const rarity: RarityId = forcedRarity !== null ? forcedRarity : rollRarity(stage, isBoss, cleared100, fromChest);
  const rInfo = RARITIES[rarity];
  const pList = PREFIXES[rarity];

  let name: string;
  let icon: string;
  let mainType: MainStatType;
  let mainBase = 10;

  if (slot === 'weapon' || slot === 'armor') {
    const bList = BASE_NAMES[slot];
    const baseChoice = bList[randInt(0, bList.length - 1)];
    name = isStarter ? STARTER_NAMES[slot] : `${pList[randInt(0, pList.length - 1)]}${baseChoice.name}`;
    icon = isStarter ? (slot === 'weapon' ? '⚔️' : '🛡️') : baseChoice.icon;
    mainType = slot === 'weapon' ? 'atk' : 'hp';

    const tierStage = getEquipTierStage(stage);
    const stagePow = Math.pow(1.14, tierStage - 1);
    const variance = isStarter ? 1.0 : rand(0.9, 1.16);
    if (slot === 'weapon') {
      mainBase = Math.max(5, Math.round(9 * stagePow * rInfo.mainMult * variance));
    } else {
      mainBase = Math.max(30, Math.round(55 * stagePow * rInfo.mainMult * variance));
    }
  } else {
    const axis = accAxis ?? 'fire';
    accAxis = axis;
    const axisDef = ACCESSORY_AXES[axis];
    const baseChoice = axisDef.baseNames[randInt(0, axisDef.baseNames.length - 1)];
    name = isStarter ? axisDef.starterName : `${pList[randInt(0, pList.length - 1)]}${baseChoice.name}`;
    icon = isStarter ? axisDef.icon : baseChoice.icon;
    mainType = axisDef.mainType;

    // 固定上限アクセサリー（階層インフレなし：全階層で理論値共通）
    const rollRatio = isStarter
      ? 0.8
      : ROLL_TIER_RATIOS[Math.floor(Math.random() * ROLL_TIER_RATIOS.length)];
    mainBase = Math.max(3, Math.round(axisDef.base * rInfo.mainMult * (0.85 + rollRatio * 0.25)));
  }

  const subCount = Math.min(MAX_SUBSTAT_COUNT, rInfo.initSubs);
  const shuffledSubs = [...SUB_POOL].sort(() => Math.random() - 0.5);
  const chosenDefs = shuffledSubs.slice(0, subCount);

  const subStats: SubStat[] = chosenDefs.map((subDef) => {
    const rollRatio = isStarter
      ? 0.7
      : ROLL_TIER_RATIOS[Math.floor(Math.random() * ROLL_TIER_RATIOS.length)];
    const rawVal = subDef.min + (subDef.max - subDef.min) * rollRatio;
    const val = +(rawVal * rInfo.subMult * (isStarter ? 0.75 : 1.0)).toFixed(1);
    return {
      key: subDef.key,
      val,
      boosts: 0,
    };
  });

  return {
    id: uid(),
    slot,
    ...(slot === 'accessory' ? { accAxis } : {}),
    name,
    icon,
    rarity,
    stage,
    level: 0,
    locked: false,
    spentStones: 0,
    createdAt: Date.now(),
    mainStat: {
      type: mainType,
      base: mainBase,
    },
    subStats,
  };
}

export function getMaxEquipLevel(item: Pick<Item, 'rarity'> | null | undefined): number {
  if (!item) return MAX_EQUIP_LEVEL;
  return RARITIES[item.rarity]?.maxLv ?? MAX_EQUIP_LEVEL;
}

export function getMainStatVal(item: Item | null | undefined): number {
  if (!item) return 0;
  if (item.level <= MAX_EQUIP_LEVEL) {
    return Math.round(item.mainStat.base * (1 + item.level * 0.12));
  }
  const over = item.level - MAX_EQUIP_LEVEL;
  return Math.round(item.mainStat.base * (1 + MAX_EQUIP_LEVEL * 0.12 + over * 0.09));
}

export function getUpgradeCost(item: Item): number {
  if (isFixedCapItem(item)) {
    // 固定上限アクセは階層によらずレア度・強化Lvのみでコスト決定（+20以降は高騰）
    const overMult = item.level >= MAX_EQUIP_LEVEL ? (item.level - MAX_EQUIP_LEVEL + 1) * 0.95 : 0;
    return Math.max(4, Math.round((8 + item.rarity * 7) * (1 + item.level * 0.45 + overMult)));
  }
  const overMult = item.level >= MAX_EQUIP_LEVEL ? (item.level - MAX_EQUIP_LEVEL + 1) * 0.28 : 0;
  return Math.max(2, Math.round((3 + item.stage * 1.4) * (1 + item.level * 0.45 + overMult) * (1 + item.rarity * 0.3)));
}

export function getSalvageValue(item: Item, bonusPct = 0): number {
  const rInfo = RARITIES[item.rarity];
  const baseDust = isFixedCapItem(item)
    ? rInfo.dustBase + Math.round(item.rarity * 8)
    : rInfo.dustBase + Math.round(item.stage * (1.2 + item.rarity * 1.6));
  const refund = Math.round((item.spentStones || 0) * 0.6);
  const total = baseDust + refund;
  return bonusPct > 0 ? Math.round(total * (1 + bonusPct / 100)) : total;
}

export function calcHeroStats(equipSet: EquippedSet, cleared100: boolean): HeroStats {
  let flatAtk = HERO_BASE.atk;
  let flatHp = HERO_BASE.hp;
  let multiHitRate = 0;
  let critRate = HERO_BASE.critRate;
  let critDmg = HERO_BASE.critDmg;
  let atkPct = 0;
  let dmgPct = 0;
  let rawArmorPen = 0;
  let bossDmg = 0;
  let mythicCount = 0;

  for (const key of EQUIP_SLOT_ORDER) {
    const it = equipSet[key];
    if (!it) continue;
    if (it.rarity === 4) mythicCount++;
    const mVal = getMainStatVal(it);
    if (it.mainStat.type === 'atk') flatAtk += mVal;
    else if (it.mainStat.type === 'hp') flatHp += mVal;
    else if (it.mainStat.type === 'multiHitRate') multiHitRate += mVal;
    else if (it.mainStat.type === 'dmgPct') dmgPct += mVal;
    else if (it.mainStat.type === 'critRate') critRate += mVal;
    else if (it.mainStat.type === 'armorPen') rawArmorPen += mVal;

    for (const sub of it.subStats) {
      if (sub.key === 'atkPct') atkPct += sub.val;
      else if (sub.key === 'critRate') critRate += sub.val;
      else if (sub.key === 'critDmg') critDmg += sub.val;
      else if (sub.key === 'dmgPct') dmgPct += sub.val;
      else if (sub.key === 'armorPen') rawArmorPen += sub.val;
      else if (sub.key === 'bossDmg') bossDmg += sub.val;
    }
  }

  const combo = getAccessoryCombo(equipSet.acc1, equipSet.acc2);
  if (combo.id === 'lightning+lightning') {
    critDmg += 22;
  }

  const totalAtk = Math.max(1, flatAtk * (1 + atkPct / 100));
  const totalHp = Math.max(10, flatHp);

  const maxCritCap = cleared100 ? 300 : 100;
  const finalCritRate = clamp(critRate, 0, maxCritCap);
  const finalCritDmg = Math.max(100, critDmg);
  const armorPen = Math.min(100, rawArmorPen);

  const c = finalCritDmg / 100;
  let critExpectedMult = 1;
  if (finalCritRate <= 100) {
    critExpectedMult = 1 + (finalCritRate / 100) * (c - 1);
  } else if (finalCritRate <= 200) {
    critExpectedMult = c * (1 + ((finalCritRate - 100) / 100) * 1.0);
  } else {
    critExpectedMult = c * (2.0 + (Math.min(finalCritRate - 200, 100) / 100) * 2.0);
  }

  const expectedMultiHit = getExpectedMultiHitMultiplier(multiHitRate, combo.id);
  const offlinePower = totalAtk * (1 + dmgPct / 100) * critExpectedMult * expectedMultiHit;

  return {
    atk: totalAtk,
    hp: totalHp,
    multiHitRate,
    critRate: finalCritRate,
    critDmg: finalCritDmg,
    dmgPct,
    armorPen,
    rawArmorPen,
    bossDmg,
    mythicCount,
    comboId: combo.id,
    offlinePower,
  };
}

export function calcHitDamage(
  stats: HeroStats,
  enemyDefRate: number,
  isBoss: boolean,
  critTier: 0 | 1 | 2 | 3,
  multFactor = 1.0,
  variance = 1.0,
): number {
  const dmgMult = 1 + stats.dmgPct / 100;
  const bossMult = isBoss ? 1 + stats.bossDmg / 100 : 1;
  const baseAtk = stats.atk * dmgMult * bossMult * multFactor;

  const c = stats.critDmg / 100;
  let tierMult = 1;
  if (critTier === 1) tierMult = c;
  else if (critTier === 2) tierMult = c * 2.0;
  else if (critTier === 3) tierMult = c * 4.0;

  const pen = clamp(stats.armorPen / 100, 0, 1);
  const defMult = clamp(1 - enemyDefRate * (1 - pen), 0.1, 1);

  return Math.max(1, Math.round(baseAtk * tierMult * defMult * variance));
}

export function formatUpgradeMessage(
  level: number,
  subLabel?: string,
  boost?: number,
  unit?: string,
  isUnlock = false,
): string {
  if (subLabel && boost !== undefined && unit !== undefined) {
    return isUnlock
      ? `強化 +${level}（解放: ${subLabel} +${boost.toFixed(1)}${unit}）`
      : `強化 +${level}（${subLabel} +${boost.toFixed(1)}${unit}）`;
  }
  return `強化 +${level}`;
}

export type SubstatMilestoneRoll =
  | {
      mode: 'unlock';
      targetIdx: number;
      newSub: SubStat;
      boost: number;
      isJackpot: boolean;
      subLabel: string;
      unit: string;
    }
  | {
      mode: 'boost';
      targetIdx: number;
      boost: number;
      isJackpot: boolean;
      subLabel: string;
      unit: string;
    };

export function rollSubstatMilestone(item: Item, rng: () => number = Math.random): SubstatMilestoneRoll | null {
  const rInfo = RARITIES[item.rarity];
  const tierIdx = Math.min(
    ROLL_TIER_RATIOS.length - 1,
    Math.floor(rng() * ROLL_TIER_RATIOS.length),
  );
  const ratio = ROLL_TIER_RATIOS[tierIdx];

  if (item.subStats.length < MAX_SUBSTAT_COUNT) {
    const existingKeys = new Set<SubStatKey>(item.subStats.map((s) => s.key));
    const available = SUB_POOL.filter((def) => !existingKeys.has(def.key));
    const pool = available.length > 0 ? available : SUB_POOL;
    const subDef = pool[Math.floor(rng() * pool.length)];
    const val = +((subDef.min + (subDef.max - subDef.min) * ratio) * rInfo.subMult).toFixed(1);
    return {
      mode: 'unlock',
      targetIdx: item.subStats.length,
      newSub: { key: subDef.key, val, boosts: 0 },
      boost: val,
      isJackpot: tierIdx === ROLL_TIER_RATIOS.length - 1,
      subLabel: subDef.label,
      unit: subDef.unit,
    };
  }

  const targetIdx = Math.floor(rng() * item.subStats.length);
  const targetSub = item.subStats[targetIdx];
  const subDef = SUB_MAP[targetSub.key];
  const boost = +((subDef.min + (subDef.max - subDef.min) * ratio) * rInfo.subMult * 0.9).toFixed(1);
  return {
    mode: 'boost',
    targetIdx,
    boost,
    isJackpot: tierIdx === ROLL_TIER_RATIOS.length - 1,
    subLabel: subDef.label,
    unit: subDef.unit,
  };
}

export function partitionBulkSalvage(
  inventory: Item[],
  mode: SalvageBulkMode,
  equipped: EquippedSet,
  salvageBonusPct = 0,
): { kept: Item[]; salvagedCount: number; totalGain: number; protectedCount: number } {
  const kept: Item[] = [];
  let salvagedCount = 0;
  let totalGain = 0;
  let protectedCount = 0;

  for (const item of inventory) {
    if (item.locked) {
      kept.push(item);
      continue;
    }
    let shouldSalvage = false;
    if (mode === 'common') shouldSalvage = item.rarity <= 0;
    else if (mode === 'rare') shouldSalvage = item.rarity <= 1;
    else if (mode === 'epic') shouldSalvage = item.rarity <= 2;
    else if (mode === 'weaker') {
      // 型落ち武器・防具のみ安全に対象化（固定上限アクセは分解しない）
      if (isFixedCapItem(item)) {
        shouldSalvage = false;
      } else {
        const eq = item.slot === 'weapon' ? equipped.weapon : equipped.armor;
        if (getMainStatVal(item) >= getMainStatVal(eq) || item.rarity > eq.rarity) {
          protectedCount++;
          shouldSalvage = false;
        } else {
          shouldSalvage = true;
        }
      }
    }

    if (shouldSalvage) {
      totalGain += getSalvageValue(item, salvageBonusPct);
      salvagedCount++;
    } else {
      kept.push(item);
    }
  }

  return { kept, salvagedCount, totalGain, protectedCount };
}

export function commitChestItemToState(
  st: GameState,
  item: Item,
  chestAutoSalvage: boolean,
  salvageBonusPct = 0,
): { salvagedDust: number; bagFull: boolean } {
  if (chestAutoSalvage && item.rarity <= st.autoSalvageRarity) {
    const salvagedDust = getSalvageValue(item, salvageBonusPct);
    st.stones += salvagedDust;
    return { salvagedDust, bagFull: false };
  }
  if (st.inventory.length >= MAX_BAG_SIZE) {
    const salvagedDust = getSalvageValue(item, salvageBonusPct);
    st.stones += salvagedDust;
    return { salvagedDust, bagFull: true };
  }
  st.inventory.unshift(item);
  return { salvagedDust: 0, bagFull: false };
}

export function matchesStorageFilter(item: Item, filter: StorageFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'weapon' || filter === 'armor' || filter === 'accessory') {
    return item.slot === filter;
  }
  return item.slot === 'accessory' && inferAccessoryAxis(item) === filter;
}

export function filterAndSortStorageItems(
  items: Item[],
  filterSlot: StorageFilter,
  sortMode: SortMode,
): Item[] {
  const filtered = items.filter((it) => matchesStorageFilter(it, filterSlot));
  if (sortMode === 'rarity') {
    return [...filtered].sort((a, b) => b.rarity - a.rarity || b.stage - a.stage);
  }
  if (sortMode === 'stage') {
    return [...filtered].sort((a, b) => b.stage - a.stage || b.rarity - a.rarity);
  }
  if (sortMode === 'level') {
    return [...filtered].sort((a, b) => b.level - a.level || b.rarity - a.rarity);
  }
  return filtered;
}

export function getNextSelectedStorageId(
  visibleItemsBeforeRemoval: Item[],
  removedItemId: string,
): string | null {
  const idx = visibleItemsBeforeRemoval.findIndex((it) => it.id === removedItemId);
  if (idx === -1) {
    return visibleItemsBeforeRemoval[0]?.id ?? null;
  }
  return visibleItemsBeforeRemoval[idx + 1]?.id ?? visibleItemsBeforeRemoval[idx - 1]?.id ?? null;
}
