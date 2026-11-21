import { ACCESSORY_AXES, inferAccessoryAxis } from './accessories';
import {
  EQUIP_SLOT_ORDER,
  MAX_BAG_SIZE,
  MAX_OFFLINE_SEC,
  MAX_STASH_SIZE,
  RARITIES,
  SAVE_KEY,
  SUB_MAP,
  SUB_POOL,
} from './constants';
import {
  createDefaultFairyState,
  getFairyProfile,
  getFairyRank,
  sanitizeFairyState,
} from './fairy';
import {
  calcHeroStats,
  clamp,
  generateItem,
  getMainStatVal,
  getMaxEquipLevel,
  getSalvageValue,
  uid,
} from './items';
import { createEnemy } from './maze';
import { isSanctumFloor, SANCTUM_INTERVAL } from './sanctum';
import type {
  AccessoryAxis,
  EquippedSet,
  GameState,
  Item,
  ItemSlot,
  MainStatType,
  OfflineSummary,
  SubStat,
  SubStatKey,
} from './types';

export function createDefaultState(): GameState {
  const starterEquipped = {
    weapon: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'weapon', isStarter: true }),
    armor: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'armor', isStarter: true }),
    acc1: generateItem({
      stage: 1,
      forcedRarity: 0,
      forcedSlot: 'accessory',
      forcedAxis: 'ice',
      isStarter: true,
    }),
    acc2: generateItem({
      stage: 1,
      forcedRarity: 0,
      forcedSlot: 'accessory',
      forcedAxis: 'fire',
      isStarter: true,
    }),
  } satisfies EquippedSet;

  return {
    stage: 1,
    maxStage: 1,
    floorEncounters: 0,
    autoProgress: true,
    autoSalvageRarity: -1,
    stones: 15,
    kills: 0,
    chests: 0,
    mythicChests: 0,
    sanctumKeys: 0,
    clearedSanctumMax: 0,
    cleared100: false,
    maxDmg: 0,
    soundOn: false,
    equipped: starterEquipped,
    inventory: [],
    stash: [],
    fairy: createDefaultFairyState(),
    logs: ['冒険を開始しました！武器・防具と2つのアクセサリを組み合わせて迷宮深層を目指そう。'],
    lastSaveTime: Date.now(),
  };
}

const LEGACY_ACCESSORY_SLOT_TO_AXIS: Record<string, { axis: AccessoryAxis; oldBase: number }> = {
  ring: { axis: 'lightning', oldBase: 6 },
  necklace: { axis: 'fire', oldBase: 16 },
  accessory: { axis: 'fire', oldBase: 16 },
  gauntlets: { axis: 'dark', oldBase: 8 },
  boots: { axis: 'ice', oldBase: 6 },
};

export function sanitizeItem(
  it: unknown,
  fallbackSlot: ItemSlot = 'weapon',
  fallbackAxis: AccessoryAxis = 'fire',
): Item | null {
  if (!it || typeof it !== 'object') return null;
  const raw = it as Record<string, unknown>;
  const rawSlot = typeof raw.slot === 'string' ? raw.slot : '';

  let slot: ItemSlot = fallbackSlot;
  let accAxis: AccessoryAxis | undefined;
  let legacyScaleRatio = 1;

  if (rawSlot === 'weapon' || rawSlot === 'armor') {
    slot = rawSlot;
  } else if (rawSlot === 'accessory') {
    slot = 'accessory';
    if (typeof raw.accAxis === 'string' && raw.accAxis in ACCESSORY_AXES) {
      accAxis = raw.accAxis as AccessoryAxis;
    } else {
      const mainObj = raw.mainStat as Record<string, unknown> | undefined;
      const rawMainType = typeof mainObj?.type === 'string' ? mainObj.type : '';
      if (rawMainType === 'multiHitRate') accAxis = 'ice';
      else if (rawMainType === 'critRate') accAxis = 'lightning';
      else if (rawMainType === 'armorPen') accAxis = 'dark';
      else if (rawMainType === 'dmgPct') accAxis = 'fire';
      else {
        // 非常に古い単一'accessory'（会心ダメメイン）は炎へ安全移行
        accAxis = fallbackAxis;
        legacyScaleRatio = ACCESSORY_AXES[accAxis].base / 16;
      }
    }
  } else if (rawSlot in LEGACY_ACCESSORY_SLOT_TO_AXIS) {
    // 旧6枠（ring/necklace/gauntlets/boots）を4軸アクセサリへ無損失変換
    const map = LEGACY_ACCESSORY_SLOT_TO_AXIS[rawSlot];
    slot = 'accessory';
    accAxis = map.axis;
    legacyScaleRatio = ACCESSORY_AXES[map.axis].base / map.oldBase;
  } else if (fallbackSlot === 'accessory') {
    slot = 'accessory';
    accAxis = fallbackAxis;
  }

  const rarityNum = typeof raw.rarity === 'number' ? Math.floor(raw.rarity) : 0;
  const rarity = clamp(rarityNum, 0, RARITIES.length - 1) as Item['rarity'];
  const stage = Math.max(1, typeof raw.stage === 'number' ? Math.floor(raw.stage) : 1);
  const maxLv = getMaxEquipLevel({ rarity });
  const level = clamp(typeof raw.level === 'number' ? Math.floor(raw.level) : 0, 0, maxLv);

  const subStats: SubStat[] = [];
  if (Array.isArray(raw.subStats)) {
    const usedKeys = new Set<SubStatKey>();
    for (const entry of raw.subStats) {
      if (!entry || typeof entry !== 'object') continue;
      const s = entry as Record<string, unknown>;
      if (typeof s.key !== 'string' || typeof s.val !== 'number') continue;
      if (s.key in SUB_MAP) {
        const key = s.key as SubStatKey;
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);
        subStats.push({
          key,
          val: +s.val.toFixed(1),
          boosts: typeof s.boosts === 'number' ? s.boosts : 0,
        });
      } else if (s.key === 'aspd') {
        const fallbackDef =
          (!usedKeys.has('dmgPct') ? SUB_MAP.dmgPct : null) ??
          SUB_POOL.find((def) => !usedKeys.has(def.key)) ??
          SUB_MAP.dmgPct;
        usedKeys.add(fallbackDef.key);
        subStats.push({
          key: fallbackDef.key,
          val: +s.val.toFixed(1),
          boosts: typeof s.boosts === 'number' ? s.boosts : 0,
        });
      }
    }
  }

  const mainStatObj = raw.mainStat as Record<string, unknown> | undefined;
  const rawMainBase =
    mainStatObj && typeof mainStatObj.base === 'number' ? Math.max(1, mainStatObj.base) : 10;

  let mainType: MainStatType;
  let mainBase: number;
  let defaultLabel: string;
  let defaultIcon: string;

  if (slot === 'weapon') {
    mainType = 'atk';
    mainBase = rawMainBase;
    defaultLabel = '武器';
    defaultIcon = '⚔️';
  } else if (slot === 'armor') {
    mainType = 'hp';
    mainBase = rawMainBase;
    defaultLabel = '防具';
    defaultIcon = '🛡️';
  } else {
    const axis = accAxis ?? fallbackAxis;
    accAxis = axis;
    const axisDef = ACCESSORY_AXES[axis];
    mainType = axisDef.mainType;
    const scaled = Math.max(3, Math.round(rawMainBase * legacyScaleRatio));
    const maxReasonable = Math.round(axisDef.base * RARITIES[rarity].mainMult * 1.25);
    mainBase = legacyScaleRatio !== 1 ? clamp(scaled, 3, Math.max(4, maxReasonable)) : scaled;
    defaultLabel = axisDef.starterName;
    defaultIcon = axisDef.icon;
  }

  return {
    id: typeof raw.id === 'string' ? raw.id : uid(),
    slot,
    ...(slot === 'accessory' ? { accAxis: accAxis ?? inferAccessoryAxis({ mainStat: { type: mainType, base: mainBase } }) } : {}),
    name: typeof raw.name === 'string' ? raw.name : defaultLabel,
    icon: typeof raw.icon === 'string' ? raw.icon : defaultIcon,
    rarity,
    stage,
    level,
    locked: !!raw.locked,
    spentStones: typeof raw.spentStones === 'number' ? Math.max(0, raw.spentStones) : 0,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    mainStat: { type: mainType, base: mainBase },
    subStats,
  };
}

function isUpgradedOrRare(it: Item): boolean {
  return it.rarity > 0 || it.level > 0 || it.stage > 1 || it.locked || it.spentStones > 0;
}

export function parseSaveState(rawJson: string): GameState | null {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (!parsed || typeof parsed.stage !== 'number' || !parsed.equipped || typeof parsed.equipped !== 'object') {
      return null;
    }

    const def = createDefaultState();
    const eq = parsed.equipped as Record<string, unknown>;
    const maxStage = Math.max(1, Math.floor((parsed.maxStage as number) || parsed.stage));
    const cleared100 = typeof parsed.cleared100 === 'boolean' ? parsed.cleared100 : maxStage > 100;
    const fairyProfile = getFairyProfile(getFairyRank(maxStage, cleared100));

    const weapon = sanitizeItem(eq.weapon, 'weapon') || def.equipped.weapon;
    const armor = sanitizeItem(eq.armor, 'armor') || def.equipped.armor;

    // 4枠新セーブ (acc1/acc2) vs 旧6枠セーブ (ring/necklace/gauntlets/boots/accessory) を無損失マイグレーション
    const rescuedItems: Item[] = [];
    let acc1: Item;
    let acc2: Item;

    const hasModernAccSlots = Boolean(eq.acc1 || eq.acc2);
    if (hasModernAccSlots) {
      acc1 = sanitizeItem(eq.acc1, 'accessory', 'ice') || def.equipped.acc1;
      acc2 = sanitizeItem(eq.acc2, 'accessory', 'fire') || def.equipped.acc2;
    } else {
      const legacyKeys: Array<{ key: string; fallbackAxis: AccessoryAxis }> = [
        { key: 'boots', fallbackAxis: 'ice' },
        { key: 'necklace', fallbackAxis: 'fire' },
        { key: 'ring', fallbackAxis: 'lightning' },
        { key: 'gauntlets', fallbackAxis: 'dark' },
        { key: 'accessory', fallbackAxis: 'fire' },
      ];
      const legacyAccs: Item[] = [];
      const seenLegacyIds = new Set<string>();
      for (const { key, fallbackAxis } of legacyKeys) {
        if (!eq[key]) continue;
        const sanitized = sanitizeItem(eq[key], 'accessory', fallbackAxis);
        if (sanitized && !seenLegacyIds.has(sanitized.id)) {
          seenLegacyIds.add(sanitized.id);
          legacyAccs.push(sanitized);
        }
      }
      // レア度・強化Lv・投資石が高い上位2つを自動装備し、外れたアクセはすべてバッグ（溢れは倉庫）へ退避
      legacyAccs.sort(
        (a, b) =>
          b.rarity - a.rarity ||
          b.level - a.level ||
          (b.spentStones || 0) - (a.spentStones || 0),
      );
      acc1 = legacyAccs[0] || def.equipped.acc1;
      acc2 = legacyAccs[1] || def.equipped.acc2;
      for (const overflowAcc of legacyAccs.slice(2)) {
        rescuedItems.push(overflowAcc);
      }
    }

    const migratedEquipped: EquippedSet = { weapon, armor, acc1, acc2 };

    // 一時3人パーティセーブからの無損失マイグレーション
    const seenIds = new Set<string>(EQUIP_SLOT_ORDER.map((s) => migratedEquipped[s].id));
    if (parsed.party && typeof parsed.party === 'object') {
      const rawParty = parsed.party as Record<string, unknown>;
      const roster =
        rawParty.roster && typeof rawParty.roster === 'object'
          ? (rawParty.roster as Record<string, unknown>)
          : null;
      if (roster) {
        const candidateWeapons: Item[] = [migratedEquipped.weapon];
        const candidateArmors: Item[] = [migratedEquipped.armor];
        for (const memberRaw of Object.values(roster)) {
          if (!memberRaw || typeof memberRaw !== 'object') continue;
          const mEq = (memberRaw as Record<string, unknown>).equipment;
          if (!mEq || typeof mEq !== 'object') continue;
          const mEqObj = mEq as Record<string, unknown>;
          const w = sanitizeItem(mEqObj.weapon, 'weapon');
          if (w && !seenIds.has(w.id)) {
            seenIds.add(w.id);
            candidateWeapons.push(w);
          }
          const a = sanitizeItem(mEqObj.armor, 'armor');
          if (a && !seenIds.has(a.id)) {
            seenIds.add(a.id);
            candidateArmors.push(a);
          }
        }
        candidateWeapons.sort((a, b) => getMainStatVal(b) - getMainStatVal(a) || b.rarity - a.rarity);
        candidateArmors.sort((a, b) => getMainStatVal(b) - getMainStatVal(a) || b.rarity - a.rarity);
        migratedEquipped.weapon = candidateWeapons[0];
        migratedEquipped.armor = candidateArmors[0];
        for (const extra of [...candidateWeapons.slice(1), ...candidateArmors.slice(1)]) {
          if (isUpgradedOrRare(extra)) {
            rescuedItems.push(extra);
          }
        }
      }
    }

    const rawInv = Array.isArray(parsed.inventory)
      ? parsed.inventory.map((it) => sanitizeItem(it)).filter((x): x is Item => Boolean(x))
      : [];
    const rawStash = Array.isArray(parsed.stash)
      ? parsed.stash.map((it) => sanitizeItem(it)).filter((x): x is Item => Boolean(x))
      : [];

    const combinedInv = [...rescuedItems, ...rawInv];
    const inventory = combinedInv.slice(0, MAX_BAG_SIZE);
    const overflowToStash = combinedInv.slice(MAX_BAG_SIZE);
    const stash = [...overflowToStash, ...rawStash].slice(0, MAX_STASH_SIZE);

    const inferredSanctumCleared =
      Math.floor(Math.max(0, maxStage - 1) / SANCTUM_INTERVAL) * SANCTUM_INTERVAL;
    let clearedSanctumMax =
      typeof parsed.clearedSanctumMax === 'number' && Number.isFinite(parsed.clearedSanctumMax)
        ? Math.floor(Math.max(0, parsed.clearedSanctumMax) / SANCTUM_INTERVAL) * SANCTUM_INTERVAL
        : inferredSanctumCleared;
    if (cleared100 && clearedSanctumMax < 100) {
      clearedSanctumMax = 100;
    }

    let stage = Math.max(1, Math.floor(parsed.stage));
    if (typeof parsed.clearedSanctumMax !== 'number' && isSanctumFloor(stage) && clearedSanctumMax < stage) {
      stage = Math.max(1, stage - 1);
    }

    return {
      ...def,
      stage,
      maxStage,
      floorEncounters: typeof parsed.floorEncounters === 'number' ? Math.max(0, Math.floor(parsed.floorEncounters)) : 0,
      autoProgress: typeof parsed.autoProgress === 'boolean' ? parsed.autoProgress : def.autoProgress,
      autoSalvageRarity:
        typeof parsed.autoSalvageRarity === 'number'
          ? clamp(Math.floor(parsed.autoSalvageRarity), -1, 3)
          : def.autoSalvageRarity,
      stones: typeof parsed.stones === 'number' && Number.isFinite(parsed.stones) ? Math.max(0, parsed.stones) : def.stones,
      kills: typeof parsed.kills === 'number' && Number.isFinite(parsed.kills) ? Math.max(0, Math.floor(parsed.kills)) : 0,
      chests: typeof parsed.chests === 'number' ? Math.max(0, parsed.chests) : 0,
      mythicChests: typeof parsed.mythicChests === 'number' ? Math.max(0, parsed.mythicChests) : 0,
      sanctumKeys:
        typeof parsed.sanctumKeys === 'number' && Number.isFinite(parsed.sanctumKeys)
          ? Math.max(0, Math.floor(parsed.sanctumKeys))
          : 0,
      clearedSanctumMax,
      cleared100,
      maxDmg: typeof parsed.maxDmg === 'number' ? Math.max(0, parsed.maxDmg) : 0,
      soundOn: Boolean(parsed.soundOn),
      equipped: migratedEquipped,
      inventory,
      stash,
      fairy: sanitizeFairyState(parsed.fairy, fairyProfile.maxGifts),
      logs: Array.isArray(parsed.logs) ? (parsed.logs as GameState['logs']) : [],
      lastSaveTime: typeof parsed.lastSaveTime === 'number' ? parsed.lastSaveTime : Date.now(),
    };
  } catch {
    return null;
  }
}

export function loadSavedGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return parseSaveState(raw);
  } catch {
    return null;
  }
}

export function persistGame(state: GameState): void {
  try {
    const payload: GameState = { ...state, lastSaveTime: Date.now() };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

export function computeOfflineRewards(state: GameState, elapsedSec: number): OfflineSummary | null {
  const cappedSec = clamp(elapsedSec, 0, MAX_OFFLINE_SEC);
  if (cappedSec < 10) return null;

  const effectiveStage = isSanctumFloor(state.stage) ? Math.max(1, state.stage - 1) : state.stage;
  const fairyProfile = getFairyProfile(getFairyRank(state.maxStage, state.cleared100));
  const stats = calcHeroStats(state.equipped, state.cleared100);
  const totalPower = Math.max(1, stats.offlinePower);

  const enemySample = createEnemy(effectiveStage, false, -100, 'normal');
  const bossSample = createEnemy(effectiveStage, true);

  const avgHp = (enemySample.maxHp * 4 + bossSample.maxHp) / 5;
  const turnsToKill = Math.max(1, avgHp / totalPower);
  const avgKillTime = Math.max(2.2, 1.8 + turnsToKill * 0.65);

  const surviveTurns = stats.hp / Math.max(1, enemySample.atk);
  const efficiency = surviveTurns < turnsToKill ? 0.5 : 1.0;

  const kills = Math.max(1, Math.floor((cappedSec / avgKillTime) * efficiency));

  let gainedStones = 0;
  let gainedChests = 0;
  const gainedItems: Item[] = [];

  const rollLimit = Math.min(kills, 3000);
  const scaleFactor = kills / rollLimit;

  for (let i = 0; i < rollLimit; i++) {
    const isBoss = i % 6 === 5;
    const baseStones = 3.4 + effectiveStage * 1.35;
    gainedStones += Math.round(baseStones * (isBoss ? 3.2 : 1.0));
    if (isBoss) gainedChests += 1;
    if (Math.random() < (isBoss ? 0.85 : 0.32)) {
      const it = generateItem({ stage: effectiveStage, isBoss, cleared100: state.cleared100 });
      gainedItems.push(it);
    }
  }
  if (scaleFactor > 1) {
    gainedStones = Math.round(gainedStones * scaleFactor);
    gainedChests = Math.round(gainedChests * scaleFactor);
  }

  if (fairyProfile.offlineBonusPct > 0) {
    gainedStones = Math.round(gainedStones * (1 + fairyProfile.offlineBonusPct / 100));
  }

  gainedItems.sort(
    (a, b) => b.rarity - a.rarity || b.subStats.length - a.subStats.length || b.stage - a.stage,
  );

  const keptItems: Item[] = [];
  const freeSlots = Math.max(0, MAX_BAG_SIZE - state.inventory.length);
  for (const it of gainedItems) {
    if (it.rarity <= state.autoSalvageRarity || keptItems.length >= freeSlots) {
      gainedStones += getSalvageValue(it, fairyProfile.salvageBonusPct);
    } else {
      keptItems.push(it);
    }
  }

  const hrs = Math.floor(cappedSec / 3600);
  const mins = Math.floor((cappedSec % 3600) / 60);
  const secs = Math.floor(cappedSec % 60);
  const durationStr = (hrs > 0 ? `${hrs}時間 ` : '') + (mins > 0 ? `${mins}分 ` : '') + `${secs}秒`;

  return {
    durationStr,
    kills,
    stones: gainedStones,
    keptItems,
    chests: gainedChests,
  };
}
