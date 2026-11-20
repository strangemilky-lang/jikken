import { MAX_BAG_SIZE, MAX_OFFLINE_SEC, MAX_STASH_SIZE, RARITIES, SAVE_KEY, SLOT_ORDER, SLOTS, SUB_MAP, SUB_POOL } from './constants';
import {
  createDefaultFairyState,
  getFairyProfile,
  getFairyRank,
  sanitizeFairyState,
} from './fairy';
import { calcHeroStats, clamp, generateItem, getMaxEquipLevel, getSalvageValue, uid } from './items';
import { createEnemy } from './maze';
import { isSanctumFloor, SANCTUM_INTERVAL } from './sanctum';
import type { EquippedSet, GameState, Item, OfflineSummary, SlotKey, SubStat, SubStatKey } from './types';

export function createDefaultState(): GameState {
  const starterEquipped = {
    weapon: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'weapon', isStarter: true }),
    armor: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'armor', isStarter: true }),
    ring: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'ring', isStarter: true }),
    necklace: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'necklace', isStarter: true }),
    gauntlets: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'gauntlets', isStarter: true }),
    boots: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'boots', isStarter: true }),
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
    logs: ['冒険を開始しました！迷宮を探索して深層を目指そう。'],
    lastSaveTime: Date.now(),
  };
}

export function sanitizeItem(it: unknown, fallbackSlot: SlotKey = 'weapon'): Item | null {
  if (!it || typeof it !== 'object') return null;
  const raw = it as Record<string, unknown>;
  // 旧セーブの 'accessory' (会心ダメメイン) は 'necklace' へ自動移行
  const rawSlot = raw.slot === 'accessory' ? 'necklace' : raw.slot;
  const slot: SlotKey = typeof rawSlot === 'string' && rawSlot in SLOTS ? (rawSlot as SlotKey) : fallbackSlot;
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
  const mainBase = mainStatObj && typeof mainStatObj.base === 'number' ? Math.max(1, mainStatObj.base) : 10;

  return {
    id: typeof raw.id === 'string' ? raw.id : uid(),
    slot,
    name: typeof raw.name === 'string' ? raw.name : SLOTS[slot].label,
    icon: typeof raw.icon === 'string' ? raw.icon : SLOTS[slot].icon,
    rarity,
    stage,
    level,
    locked: !!raw.locked,
    spentStones: typeof raw.spentStones === 'number' ? Math.max(0, raw.spentStones) : 0,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    mainStat: { type: SLOTS[slot].mainType, base: mainBase },
    subStats,
  };
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

    const migratedEquipped = {} as EquippedSet;
    for (const slot of SLOT_ORDER) {
      const sourceRaw = eq[slot] ?? (slot === 'necklace' ? eq.accessory : undefined);
      migratedEquipped[slot] = sanitizeItem(sourceRaw, slot) || def.equipped[slot];
    }

    const rawInv = Array.isArray(parsed.inventory)
      ? parsed.inventory.map((it) => sanitizeItem(it)).filter((x): x is Item => Boolean(x))
      : [];
    const rawStash = Array.isArray(parsed.stash)
      ? parsed.stash.map((it) => sanitizeItem(it)).filter((x): x is Item => Boolean(x))
      : [];

    // 旧80枠バッグからの溢れ分(61個目以降)は倉庫へ安全に移行
    const inventory = rawInv.slice(0, MAX_BAG_SIZE);
    const overflowToStash = rawInv.slice(MAX_BAG_SIZE);
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
      ...(parsed as Partial<GameState>),
      stage,
      maxStage,
      floorEncounters: typeof parsed.floorEncounters === 'number' ? Math.max(0, Math.floor(parsed.floorEncounters)) : 0,
      chests: typeof parsed.chests === 'number' ? Math.max(0, parsed.chests) : 0,
      mythicChests: typeof parsed.mythicChests === 'number' ? Math.max(0, parsed.mythicChests) : 0,
      sanctumKeys:
        typeof parsed.sanctumKeys === 'number' && Number.isFinite(parsed.sanctumKeys)
          ? Math.max(0, Math.floor(parsed.sanctumKeys))
          : 0,
      clearedSanctumMax,
      maxDmg: typeof parsed.maxDmg === 'number' ? Math.max(0, parsed.maxDmg) : 0,
      cleared100,
      equipped: migratedEquipped,
      inventory,
      stash,
      fairy: sanitizeFairyState(parsed.fairy, fairyProfile.maxGifts),
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
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
  const enemySample = createEnemy(effectiveStage, false);
  const bossSample = createEnemy(effectiveStage, true);

  const avgHp = (enemySample.maxHp * 4 + bossSample.maxHp) / 5;
  const estPower = Math.max(1, stats.offlinePower);
  const turnsToKill = avgHp / estPower;
  const avgKillTime = Math.max(2.2, 1.8 + turnsToKill * 0.7);

  const surviveTurns = stats.hp / Math.max(1, enemySample.atk);
  const efficiency = surviveTurns < turnsToKill ? 0.5 : 1.0;

  const kills = Math.max(1, Math.floor((cappedSec / avgKillTime) * efficiency));

  let gainedStones = 0;
  let gainedChests = 0;
  const gainedItems: Item[] = [];

  const rollLimit = Math.min(kills, 3000);
  const scaleFactor = kills / rollLimit;

  for (let i = 0; i < rollLimit; i++) {
    const isBoss = (i % 6 === 5);
    gainedStones += Math.round((isBoss ? 2.8 : 1.4) + effectiveStage * (isBoss ? 1.2 : 0.58));
    if (isBoss) gainedChests += 1;
    if (Math.random() < (isBoss ? 0.78 : 0.28)) {
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
    (a, b) => (b.rarity - a.rarity) || (b.subStats.length - a.subStats.length) || (b.stage - a.stage),
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
