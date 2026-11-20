import {
  MAX_BAG_SIZE,
  MAX_OFFLINE_SEC,
  MAX_STASH_SIZE,
  RARITIES,
  SAVE_KEY,
  SLOT_ORDER,
  SLOTS,
  SUB_MAP,
  SUB_POOL,
  UNIQUE_AFFIX_MAP,
} from './constants';
import {
  createDefaultFairyState,
  getFairyProfile,
  getFairyRank,
  sanitizeFairyState,
} from './fairy';
import { clamp, generateItem, getMaxEquipLevel, getSalvageValue, uid } from './items';
import { createEnemy } from './maze';
import {
  calcPartyMemberStats,
  createDefaultPartyState,
  createStarterMember,
  getActiveMembers,
  getPartyBonuses,
  JOB_DEFS,
  JOB_ORDER,
  MAX_SKILL_LEVEL,
  syncLeaderEquipped,
} from './party';
import { isSanctumFloor, SANCTUM_INTERVAL } from './sanctum';
import type {
  EquippedSet,
  GameState,
  Item,
  JobId,
  OfflineSummary,
  PartyMemberState,
  PartyState,
  SlotKey,
  SubStat,
  SubStatKey,
  UniqueAffix,
  UniqueAffixKey,
} from './types';

export function createDefaultState(): GameState {
  const starterEquipped = {
    weapon: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'weapon', isStarter: true }),
    armor: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'armor', isStarter: true }),
    ring: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'ring', isStarter: true }),
    necklace: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'necklace', isStarter: true }),
    gauntlets: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'gauntlets', isStarter: true }),
    boots: generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'boots', isStarter: true }),
  } satisfies EquippedSet;

  const party = createDefaultPartyState(starterEquipped.weapon, starterEquipped.armor);

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
    party,
    inventory: [],
    stash: [],
    fairy: createDefaultFairyState(),
    logs: ['3人パーティで冒険を開始しました！スキルを振って迷宮深層を目指そう。'],
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

  let uniqueAffix: UniqueAffix | null = null;
  if (raw.uniqueAffix && typeof raw.uniqueAffix === 'object') {
    const af = raw.uniqueAffix as Record<string, unknown>;
    if (typeof af.key === 'string' && af.key in UNIQUE_AFFIX_MAP && typeof af.val === 'number' && Number.isFinite(af.val)) {
      const def = UNIQUE_AFFIX_MAP[af.key as UniqueAffixKey];
      uniqueAffix = {
        key: af.key as UniqueAffixKey,
        val: clamp(Math.round(af.val), def.min, Math.round(def.max * 1.5)),
      };
    }
  }

  const rawRefIdx = raw.reforgedSubIdx;
  const reforgedSubIdx =
    typeof rawRefIdx === 'number' && Number.isInteger(rawRefIdx) && rawRefIdx >= 0 && rawRefIdx < subStats.length
      ? rawRefIdx
      : null;
  const reforgeCount =
    typeof raw.reforgeCount === 'number' && Number.isFinite(raw.reforgeCount)
      ? Math.max(0, Math.floor(raw.reforgeCount))
      : 0;

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
    uniqueAffix,
    reforgedSubIdx,
    reforgeCount,
  };
}

export function sanitizePartyState(rawParty: unknown, fallbackEquipped: EquippedSet): PartyState {
  const defParty = createDefaultPartyState(fallbackEquipped.weapon, fallbackEquipped.armor);
  if (!rawParty || typeof rawParty !== 'object') {
    return defParty;
  }

  const rp = rawParty as Record<string, unknown>;
  const rawRoster = rp.roster && typeof rp.roster === 'object' ? (rp.roster as Record<string, unknown>) : {};
  const roster = {} as Record<JobId, PartyMemberState>;

  for (const id of JOB_ORDER) {
    const def = JOB_DEFS[id];
    const fallbackMember = defParty.roster[id] ?? createStarterMember(id);
    const rm = rawRoster[id] && typeof rawRoster[id] === 'object' ? (rawRoster[id] as Record<string, unknown>) : null;
    if (!rm) {
      roster[id] = fallbackMember;
      continue;
    }

    const level =
      typeof rm.level === 'number' && Number.isFinite(rm.level) ? Math.max(1, Math.floor(rm.level)) : 1;
    const exp =
      typeof rm.exp === 'number' && Number.isFinite(rm.exp) ? Math.max(0, Math.floor(rm.exp)) : 0;
    const unspentSp =
      typeof rm.unspentSp === 'number' && Number.isFinite(rm.unspentSp)
        ? Math.max(0, Math.floor(rm.unspentSp))
        : 0;
    const unlocked = def.defaultUnlocked ? true : Boolean(rm.unlocked);

    const rawSkills = rm.skills && typeof rm.skills === 'object' ? (rm.skills as Record<string, unknown>) : {};
    const skills: Record<string, number> = {};
    for (const sk of def.skills) {
      const val = rawSkills[sk.id];
      skills[sk.id] =
        typeof val === 'number' && Number.isFinite(val)
          ? clamp(Math.floor(val), 0, MAX_SKILL_LEVEL)
          : 0;
    }

    const rawEq =
      rm.equipment && typeof rm.equipment === 'object' ? (rm.equipment as Record<string, unknown>) : {};
    const weapon = sanitizeItem(rawEq.weapon, 'weapon') ?? fallbackMember.equipment.weapon;
    const armor = sanitizeItem(rawEq.armor, 'armor') ?? fallbackMember.equipment.armor;

    roster[id] = {
      id,
      unlocked,
      level,
      exp,
      unspentSp,
      skills,
      equipment: { weapon, armor },
    };
  }

  const activeList: JobId[] = [];
  if (Array.isArray(rp.activeIds)) {
    for (const candidate of rp.activeIds) {
      if (
        typeof candidate === 'string' &&
        (JOB_ORDER as string[]).includes(candidate) &&
        roster[candidate as JobId]?.unlocked &&
        !activeList.includes(candidate as JobId)
      ) {
        activeList.push(candidate as JobId);
      }
      if (activeList.length === 3) break;
    }
  }
  for (const fallbackId of JOB_ORDER) {
    if (activeList.length === 3) break;
    if (roster[fallbackId].unlocked && !activeList.includes(fallbackId)) {
      activeList.push(fallbackId);
    }
  }

  return {
    activeIds: [activeList[0], activeList[1], activeList[2]],
    roster,
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

    const party = sanitizePartyState(parsed.party, migratedEquipped);

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

    const nextState: GameState = {
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
      party,
      inventory,
      stash,
      fairy: sanitizeFairyState(parsed.fairy, fairyProfile.maxGifts),
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
    const leader = nextState.party.roster[nextState.party.activeIds[0]];
    if (leader) {
      if (
        leader.equipment.weapon.id !== migratedEquipped.weapon.id &&
        leader.equipment.weapon.level === 0 &&
        leader.equipment.weapon.rarity === 0 &&
        (migratedEquipped.weapon.level > 0 || migratedEquipped.weapon.rarity > 0)
      ) {
        leader.equipment.weapon = migratedEquipped.weapon;
      }
      if (
        leader.equipment.armor.id !== migratedEquipped.armor.id &&
        leader.equipment.armor.level === 0 &&
        leader.equipment.armor.rarity === 0 &&
        (migratedEquipped.armor.level > 0 || migratedEquipped.armor.rarity > 0)
      ) {
        leader.equipment.armor = migratedEquipped.armor;
      }
    }
    syncLeaderEquipped(nextState);
    return nextState;
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
  const activeMembers = getActiveMembers(state.party);
  const memberStats = activeMembers.map((m) =>
    calcPartyMemberStats(m, state.equipped, state.cleared100, activeMembers),
  );
  const partyBonuses = getPartyBonuses(state.party, state.equipped);
  const totalPower = Math.max(
    1,
    memberStats.reduce((sum, s) => sum + s.offlinePower, 0),
  );
  const totalHp = Math.max(
    20,
    memberStats.reduce((sum, s) => sum + s.hp, 0),
  );

  const enemySample = createEnemy(effectiveStage, false);
  const bossSample = createEnemy(effectiveStage, true);

  const avgHp = (enemySample.maxHp * 4 + bossSample.maxHp) / 5;
  const turnsToKill = avgHp / totalPower;
  const avgKillTime = Math.max(2.0, 1.7 + turnsToKill * 0.7);

  const surviveTurns = totalHp / Math.max(1, enemySample.atk);
  const efficiency = surviveTurns < turnsToKill ? 0.5 : 1.0;

  const kills = Math.max(1, Math.floor((cappedSec / avgKillTime) * efficiency));

  let gainedStones = 0;
  let gainedChests = 0;
  const gainedItems: Item[] = [];

  const rollLimit = Math.min(kills, 3000);
  const scaleFactor = kills / rollLimit;
  const dropMult = 1 + partyBonuses.dropBonusPct / 100;

  for (let i = 0; i < rollLimit; i++) {
    const isBoss = (i % 6 === 5);
    gainedStones += Math.round((isBoss ? 2.8 : 1.4) + effectiveStage * (isBoss ? 1.2 : 0.58));
    if (isBoss) gainedChests += 1;
    if (Math.random() < Math.min(0.95, (isBoss ? 0.78 : 0.28) * dropMult)) {
      const it = generateItem({ stage: effectiveStage, isBoss, cleared100: state.cleared100 });
      gainedItems.push(it);
    }
  }
  if (scaleFactor > 1) {
    gainedStones = Math.round(gainedStones * scaleFactor);
    gainedChests = Math.round(gainedChests * scaleFactor);
  }

  const totalStoneBonusPct = fairyProfile.offlineBonusPct + partyBonuses.stoneBonusPct;
  if (totalStoneBonusPct > 0) {
    gainedStones = Math.round(gainedStones * (1 + totalStoneBonusPct / 100));
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
