import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BIOMES,
  CHEST_BATCH_MAX,
  MAX_BAG_SIZE,
  MAX_EQUIP_LEVEL,
  MAX_STASH_SIZE,
  MYTHIC_MAX_EQUIP_LEVEL,
  RARITIES,
  SLOTS,
  SLOT_ORDER,
  SUB_POOL,
  SUBSTAT_STEP_INTERVAL,
} from './constants';
import {
  advanceFairyCooldown,
  claimFairyGift,
  createDefaultFairyState,
  FAIRY_BASE_COOLDOWN_SEC,
  getFairyProfile,
  getFairyRank,
} from './fairy';
import {
  calcHeroStats,
  calcHitDamage,
  commitChestItemToState,
  filterAndSortStorageItems,
  formatStatDiff,
  formatUpgradeMessage,
  generateItem,
  getEquipTierStage,
  getMainStatVal,
  getMaxEquipLevel,
  getNextSelectedStorageId,
  getSalvageValue,
  getUpgradeCost,
  partitionBulkSalvage,
  rollSubstatMilestone,
} from './items';
import {
  bfsPath,
  cardinalAngleFromDelta,
  crawlKey,
  createEnemy,
  findChokeRetreatCell,
  findHeroSafePath,
  generateMaze,
  generateSanctumChamber,
  getEngagedEnemies,
  getTurnSpeedScale,
  pickEncounterAheadCell,
  pickExplorationTarget,
  placeDungeonEnemies,
  placeMazeEvents,
  revealDungeonTiles,
  shouldEnterRestMode,
  shouldExitRestMode,
  shouldRetreatInRoom,
  shouldTriggerRandomEncounter,
  snapCardinalAngle,
  stepEnemiesTowardHero,
} from './maze';
import {
  canEnterSanctum,
  enterSanctumState,
  getNextManualStage,
  getPrevManualStage,
  getUnlockedSanctumTarget,
  isGateFloor,
  isHeldAtGate,
  isMidBossFloor,
  isSanctumFloor,
  resolveBossVictoryProgression,
  resolveDefeatRetreatStage,
  rollSanctumDropRarity,
  rollSanctumKeyDrop,
  SANCTUM_KEY_DROP_CHANCE,
} from './sanctum';
import {
  resolveWallThemeKey,
  SPRITE_REGISTRY,
  validateSpriteDefinition,
  WALL_TEXTURE_GRIDS,
} from './pixelArt';
import { createDefaultState, parseSaveState } from './save';

test('CHEST_BATCH_MAX is 9 for 3x3 modal layout', () => {
  assert.equal(CHEST_BATCH_MAX, 9);
});

test('formatUpgradeMessage produces simple, concise Japanese messages for +4 milestones', () => {
  assert.equal(formatUpgradeMessage(1), '強化 +1');
  assert.equal(formatUpgradeMessage(4, '攻撃力', 6.5, '%', false), '強化 +4（攻撃力 +6.5%）');
  assert.equal(formatUpgradeMessage(4, '会心率', 3.2, '%', true), '強化 +4（解放: 会心率 +3.2%）');
  const msg = formatUpgradeMessage(8, '会心率', 4.2, '%', false);
  assert.equal(msg.includes('大成功'), false);
  assert.equal(msg.includes('神跳ね'), false);
});

test('Rarities R0-R3 have Lv20 cap, Mythic has Lv40 cap, +4 intervals, and Legend/Mythic guarantee 4 initial substats', () => {
  assert.equal(MAX_EQUIP_LEVEL, 20);
  assert.equal(MYTHIC_MAX_EQUIP_LEVEL, 40);
  assert.equal(SUBSTAT_STEP_INTERVAL, 4);
  assert.ok(RARITIES.slice(0, 4).every((r) => r.maxLv === 20));
  assert.equal(RARITIES[4].maxLv, 40);

  const common = generateItem({ stage: 10, forcedRarity: 0, forcedSlot: 'ring' });
  const epic = generateItem({ stage: 10, forcedRarity: 2, forcedSlot: 'necklace' });
  const legend = generateItem({ stage: 10, forcedRarity: 3, forcedSlot: 'gauntlets' });
  const mythic = generateItem({ stage: 10, forcedRarity: 4, forcedSlot: 'boots' });

  assert.equal(common.subStats.length, 1);
  assert.equal(epic.subStats.length, 3);
  assert.equal(legend.subStats.length, 4);
  assert.equal(mythic.subStats.length, 4);

  // Epic (<4 subs) unlocks a new unique substat on first +4 milestone
  const unlockRoll = rollSubstatMilestone(epic, () => 0.5);
  assert.ok(unlockRoll && unlockRoll.mode === 'unlock');
  assert.ok(!epic.subStats.some((s) => s.key === unlockRoll.newSub.key));

  // Legend (4 subs) boosts one of its 4 substats
  const boostRoll = rollSubstatMilestone(legend, () => 0.5);
  assert.ok(boostRoll && boostRoll.mode === 'boost');
  assert.ok(boostRoll.targetIdx >= 0 && boostRoll.targetIdx < 4);
});

test('Fixed-cap accessories (ring, necklace, gauntlets, boots) do not inflate with stage', () => {
  const r1 = generateItem({ stage: 1, forcedRarity: 3, forcedSlot: 'ring' });
  const r800 = generateItem({ stage: 800, forcedRarity: 3, forcedSlot: 'ring' });
  // Same stage-independent ceiling and upgrade cost
  assert.ok(r800.mainStat.base <= 20 && r1.mainStat.base <= 20);
  assert.equal(getUpgradeCost(r1), getUpgradeCost(r800));
});

test('calcHeroStats & calcHitDamage handle dmgPct, bossDmg, armorPen without follow-up hit inflation', () => {
  const baseState = createDefaultState();
  const mythicWeapon = generateItem({ stage: 10, forcedRarity: 4, forcedSlot: 'weapon' });
  const withMythic = { ...baseState.equipped, weapon: mythicWeapon };
  const mythicStats = calcHeroStats(withMythic, true);
  assert.equal(mythicStats.mythicCount, 1);

  const legendWeapon = { ...mythicWeapon, rarity: 3 as const };
  const legendStats = calcHeroStats({ ...baseState.equipped, weapon: legendWeapon }, true);
  // Same mainStat.base & subStats should produce identical offlinePower (no hidden follow-up multiplier)
  assert.equal(Math.round(mythicStats.offlinePower), Math.round(legendStats.offlinePower));

  const tankyBossStats = { ...mythicStats, atk: 1000, critDmg: 200, dmgPct: 50, armorPen: 0, bossDmg: 0 };
  const dmgNoPen = calcHitDamage(tankyBossStats, 0.6, true, 0, 1.0, 1.0);
  const dmgWithPen = calcHitDamage({ ...tankyBossStats, armorPen: 50 }, 0.6, true, 0, 1.0, 1.0);
  const dmgWithBoss = calcHitDamage({ ...tankyBossStats, bossDmg: 40 }, 0.6, true, 0, 1.0, 1.0);

  assert.equal(dmgNoPen, 600); // 1000 * 1.5 * (1 - 0.6)
  assert.equal(dmgWithPen, 1050); // 1000 * 1.5 * (1 - 0.6 * 0.5)
  assert.equal(dmgWithBoss, 840); // 1000 * 1.5 * 1.4 * 0.4
});

test('random encounter logic has 4-step cooldown and halved encounter probability', () => {
  assert.equal(shouldTriggerRandomEncounter(0, 10, () => 0), false);
  assert.equal(shouldTriggerRandomEncounter(4, 10, () => 0), false);
  assert.equal(shouldTriggerRandomEncounter(5, 10, () => 0.04), true);
  assert.equal(shouldTriggerRandomEncounter(5, 10, () => 0.08), false);
  assert.equal(shouldTriggerRandomEncounter(10, 1, () => 0), false);

  const maze = generateMaze();
  const path = bfsPath(maze.grid, maze.spawn.x, maze.spawn.y, maze.stairs.x, maze.stairs.y);
  assert.ok(path !== null && path.length >= 2);
});

test('createEnemy sets defense rate and creates regular, mid-boss (10F), and great demon (100F)', () => {
  const b10 = createEnemy(10, true);
  assert.equal(b10.isMidBoss, true);
  assert.equal(b10.isGreatDemon, false);
  assert.ok(b10.defRate > 0.25);

  const b100 = createEnemy(100, true);
  assert.equal(b100.isGreatDemon, true);
  assert.equal(b100.isBoss, true);
  assert.ok(b100.defRate >= 0.4);
});

test('partitionBulkSalvage protects locked items, stronger gear, and fixed-cap accessories on weaker mode', () => {
  const state = createDefaultState();
  const weakCommon = generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'weapon' });
  const lockedCommon = { ...generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'weapon' }), locked: true };
  const highHpArmor = generateItem({ stage: 10, forcedRarity: 3, forcedSlot: 'armor' });
  const ring = generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'ring' });

  const resCommon = partitionBulkSalvage([weakCommon, lockedCommon, highHpArmor], 'common', state.equipped);
  assert.equal(resCommon.salvagedCount, 1);
  assert.equal(resCommon.kept.length, 2);

  // 'weaker' must never salvage fixed-cap accessories or stronger armor
  const resWeaker = partitionBulkSalvage([highHpArmor, ring], 'weaker', state.equipped);
  assert.equal(resWeaker.salvagedCount, 0);
  assert.equal(resWeaker.kept.length, 2);
});

test('parseSaveState migrates legacy 3-slot wave-based save cleanly to 6 slots', () => {
  const legacyAcc = generateItem({ stage: 8, forcedRarity: 3, forcedSlot: 'necklace' });
  const legacy = JSON.stringify({
    stage: 12,
    maxStage: 15,
    wave: 4,
    stones: 250,
    equipped: {
      weapon: createDefaultState().equipped.weapon,
      armor: createDefaultState().equipped.armor,
      accessory: { ...legacyAcc, slot: 'accessory' },
    },
    inventory: [{ ...legacyAcc, id: 'inv_acc', slot: 'accessory' }],
  });
  const migrated = parseSaveState(legacy);
  assert.ok(migrated !== null);
  assert.equal(migrated.stage, 12);
  assert.equal(migrated.maxStage, 15);
  assert.equal(migrated.floorEncounters, 0);
  for (const slot of SLOT_ORDER) {
    assert.equal(migrated.equipped[slot].slot, slot);
  }
  assert.equal(migrated.equipped.necklace.id, legacyAcc.id);
  assert.equal(migrated.inventory[0].slot, 'necklace');
});

test('commitChestItemToState resolves auto-salvage, bag limit, and inventory addition cleanly', () => {
  const st = createDefaultState();
  st.autoSalvageRarity = 0;
  const startStones = st.stones;

  const commonItem = generateItem({ stage: 3, forcedRarity: 0, forcedSlot: 'weapon' });
  const r1 = commitChestItemToState(st, commonItem, true);
  assert.ok(r1.salvagedDust > 0);
  assert.equal(r1.bagFull, false);
  assert.equal(st.inventory.length, 0);
  assert.equal(st.stones, startStones + r1.salvagedDust);

  const rareItem = generateItem({ stage: 3, forcedRarity: 1, forcedSlot: 'armor' });
  const r2 = commitChestItemToState(st, rareItem, true);
  assert.equal(r2.salvagedDust, 0);
  assert.equal(r2.bagFull, false);
  assert.equal(st.inventory.length, 1);
  assert.equal(st.inventory[0].id, rareItem.id);
});

test('getEquipTierStage steps every 5 floors and stays balanced through 1000F across 6 slots', () => {
  assert.equal(getEquipTierStage(1), 1);
  assert.equal(getEquipTierStage(5), 1);
  assert.equal(getEquipTierStage(6), 6);
  assert.equal(getEquipTierStage(10), 6);
  assert.equal(getEquipTierStage(11), 11);
  assert.equal(getEquipTierStage(1000), 996);

  const w1 = generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'weapon' });
  const w5 = generateItem({ stage: 5, forcedRarity: 0, forcedSlot: 'weapon' });
  const w6 = generateItem({ stage: 6, forcedRarity: 0, forcedSlot: 'weapon' });
  assert.ok(w5.mainStat.base <= 11);
  assert.ok(w1.mainStat.base <= 11);
  assert.ok(w6.mainStat.base >= 15);

  const boss1000 = createEnemy(1000, true);
  const w1000 = generateItem({ stage: 1000, forcedRarity: 4, forcedSlot: 'weapon' });
  const a1000 = generateItem({ stage: 1000, forcedRarity: 4, forcedSlot: 'armor' });
  const ring1000 = generateItem({ stage: 1000, forcedRarity: 4, forcedSlot: 'ring' });
  const neck1000 = generateItem({ stage: 1000, forcedRarity: 4, forcedSlot: 'necklace' });
  const gaunt1000 = generateItem({ stage: 1000, forcedRarity: 4, forcedSlot: 'gauntlets' });
  const boots1000 = generateItem({ stage: 1000, forcedRarity: 4, forcedSlot: 'boots' });
  const stats1000 = calcHeroStats(
    {
      weapon: w1000,
      armor: a1000,
      ring: ring1000,
      necklace: neck1000,
      gauntlets: gaunt1000,
      boots: boots1000,
    },
    true,
  );
  assert.ok(Number.isFinite(boss1000.maxHp) && boss1000.maxHp > 0);
  assert.ok(Number.isFinite(stats1000.offlinePower) && stats1000.offlinePower > 0);
  assert.ok(stats1000.hp > boss1000.atk);
});

test('pickExplorationTarget avoids bee-lining undiscovered stairs and avoids sudden U-turns', () => {
  const grid = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1, 0, 1],
    [1, 1, 1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  const stairs = { x: 5, y: 5 };
  const explored = new Set<string>([crawlKey(1, 1), crawlKey(2, 1), crawlKey(3, 1)]);
  const stepped = new Set<string>([crawlKey(1, 1), crawlKey(2, 1)]);

  const res = pickExplorationTarget(
    grid,
    2,
    1,
    0,
    explored,
    stepped,
    stairs,
    [],
    () => 0.2,
    undefined,
    undefined,
    undefined,
    { hasFloorKey: false },
  );
  assert.equal(res.reason, 'explore');
  assert.notDeepEqual(res.target, stairs);
  const path = bfsPath(grid, 2, 1, res.target.x, res.target.y);
  assert.ok(path && path.length >= 2);
  assert.notEqual(path[1].x, 1);

  explored.add(crawlKey(stairs.x, stairs.y));
  const stillLocked = pickExplorationTarget(
    grid,
    2,
    1,
    0,
    explored,
    stepped,
    stairs,
    [],
    () => 0.2,
    undefined,
    undefined,
    undefined,
    { hasFloorKey: false },
  );
  assert.equal(stillLocked.reason, 'explore');
  assert.notDeepEqual(stillLocked.target, stairs);

  const foundStairs = pickExplorationTarget(
    grid,
    2,
    1,
    0,
    explored,
    stepped,
    stairs,
    [],
    () => 0.2,
    undefined,
    undefined,
    undefined,
    { hasFloorKey: true },
  );
  assert.equal(foundStairs.reason, 'stairs');
  assert.deepEqual(foundStairs.target, stairs);

  const enc = pickEncounterAheadCell(grid, 2, 1, 0, path, stairs, false);
  assert.ok(enc !== null);
  assert.ok(enc.x >= 2);

  const maze = generateMaze();
  const evs = placeMazeEvents(maze.depth, maze.stairs);
  assert.ok(evs.length >= 1);
  assert.ok(evs.every((e) => e.type === 'chest' && (e.x !== maze.stairs.x || e.y !== maze.stairs.y)));
});

test('Bag (60) and Stash (120) capacities, overflow save migration, and formatStatDiff', () => {
  assert.equal(MAX_BAG_SIZE, 60);
  assert.equal(MAX_STASH_SIZE, 120);

  assert.deepEqual(formatStatDiff(42, ''), { text: '▲+42', tone: 'up' });
  assert.deepEqual(formatStatDiff(-150000, ''), { text: '▼-150.0K', tone: 'down' });
  assert.deepEqual(formatStatDiff(0, '%'), { text: '±0%', tone: 'same' });

  const base = createDefaultState();
  const items70 = Array.from({ length: 70 }, (_, idx) => ({
    ...generateItem({ stage: 5, forcedSlot: 'weapon' }),
    id: `old_${idx}`,
  }));
  const migrated = parseSaveState(
    JSON.stringify({
      ...base,
      inventory: items70,
    }),
  );
  assert.ok(migrated !== null);
  assert.equal(migrated.inventory.length, 60);
  assert.equal(migrated.stash.length, 10);
  assert.equal(migrated.stash[0].id, 'old_60');
});

test('Post-100F crit overflow (2.0x super / 4.0x hyper) makes crit-focused builds modestly strongest without 2x+ gap', () => {
  const baseStats = {
    atk: 1000,
    hp: 5000,
    critRate: 100,
    critDmg: 300,
    dmgPct: 0,
    armorPen: 0,
    bossDmg: 0,
    mythicCount: 0,
    offlinePower: 0,
  };
  const crit1 = calcHitDamage(baseStats, 0, false, 1, 1.0, 1.0);
  const crit2 = calcHitDamage(baseStats, 0, false, 2, 1.0, 1.0);
  const crit3 = calcHitDamage(baseStats, 0, false, 3, 1.0, 1.0);
  assert.equal(crit1, 3000);
  assert.equal(crit2, 6000); // 2.0x normal crit
  assert.equal(crit3, 12000); // 4.0x normal crit

  // Before 100F: capped at 100%; after 100F: uncapped up to 300%
  const st = createDefaultState();
  const mythicRing = generateItem({ stage: 100, forcedRarity: 4, forcedSlot: 'ring' });
  mythicRing.level = 20;
  mythicRing.subStats = [{ key: 'critRate', val: 30, boosts: 5 }];
  const withHighCrit = {
    ...st.equipped,
    ring: mythicRing,
    weapon: { ...st.equipped.weapon, subStats: [{ key: 'critRate' as const, val: 25, boosts: 4 }] },
  };
  const pre100 = calcHeroStats(withHighCrit, false);
  const post100 = calcHeroStats(withHighCrit, true);
  assert.equal(pre100.critRate, 100);
  assert.ok(post100.critRate > 120 && post100.critRate <= 300);

  // Compare equal 40-roll Mythic+20 allocations deterministically:
  // crit-focused should lead over balanced, but stay modest (<1.35x, never 2x+)
  const makeFullMythic = (rolls: { critRate: number; critDmg: number; atkPct: number; dmgPct: number }) => {
    const eq = { ...st.equipped };
    for (const slot of SLOT_ORDER) {
      eq[slot] = {
        ...st.equipped[slot],
        rarity: 4,
        level: 20,
        stage: 100,
        mainStat: {
          ...st.equipped[slot].mainStat,
          base:
            slot === 'weapon'
              ? 50000
              : slot === 'armor'
                ? 300000
                : slot === 'ring'
                  ? 24
                  : slot === 'necklace'
                    ? 65
                    : slot === 'gauntlets'
                      ? 33
                      : 24,
        },
        subStats: [
          { key: 'critRate', val: +(rolls.critRate * 3.85 / 6).toFixed(1), boosts: 0 },
          { key: 'critDmg', val: +(rolls.critDmg * 6.2 / 6).toFixed(1), boosts: 0 },
          { key: 'atkPct', val: +(rolls.atkPct * 4.4 / 6).toFixed(1), boosts: 0 },
          { key: 'dmgPct', val: +(rolls.dmgPct * 3.95 / 6).toFixed(1), boosts: 0 },
        ],
      };
    }
    return calcHeroStats(eq, true);
  };
  const cap100 = makeFullMythic({ critRate: 3, critDmg: 12, atkPct: 12, dmgPct: 13 });
  const balanced = makeFullMythic({ critRate: 10, critDmg: 10, atkPct: 10, dmgPct: 10 });
  const critMax = makeFullMythic({ critRate: 40, critDmg: 0, atkPct: 0, dmgPct: 0 });
  const vsBalanced = critMax.offlinePower / balanced.offlinePower;
  const vsCap100 = critMax.offlinePower / cap100.offlinePower;
  assert.ok(vsBalanced > 1.05 && vsBalanced < 1.35, `Expected modest crit lead vs balanced, got ${vsBalanced.toFixed(3)}`);
  assert.ok(vsCap100 > 1.15 && vsCap100 < 1.60, `Expected modest crit lead vs cap100, got ${vsCap100.toFixed(3)}`);
});

test('Fairy evolves every 100F with non-DPS utility passives, explore-accelerated gifts, and save sanitization', () => {
  assert.equal(getFairyRank(50, false), 0);
  assert.equal(getFairyRank(100, true), 1);
  assert.equal(getFairyRank(201, true), 2);
  assert.equal(getFairyRank(305, true), 3);
  assert.equal(getFairyRank(450, true), 4);

  const p0 = getFairyProfile(0);
  const p2 = getFairyProfile(2);
  const p3 = getFairyProfile(3);
  assert.equal(p0.maxGifts, 1);
  assert.equal(p0.salvageBonusPct, 0);
  assert.equal(p2.maxGifts, 2);
  assert.ok(p2.mythicChestChance > 0);
  assert.equal(p3.maxGifts, 3);
  assert.equal(p3.salvageBonusPct, 24);

  // Cooldown advancement caps cleanly at maxGifts
  const fairy = createDefaultFairyState();
  fairy.cooldownSec = 5;
  const added1 = advanceFairyCooldown(fairy, 5, p2.maxGifts);
  assert.equal(added1, true);
  assert.equal(fairy.giftsReady, 1);
  assert.equal(fairy.cooldownSec, FAIRY_BASE_COOLDOWN_SEC);

  advanceFairyCooldown(fairy, FAIRY_BASE_COOLDOWN_SEC * 3, p2.maxGifts);
  assert.equal(fairy.giftsReady, p2.maxGifts);
  assert.equal(fairy.cooldownSec, FAIRY_BASE_COOLDOWN_SEC);

  // Claiming gift awards stones/chest/buff and increments totalClaimed
  const st = createDefaultState();
  st.stage = 205;
  st.maxStage = 205;
  st.cleared100 = true;
  st.fairy.giftsReady = 2;
  const beforeStones = st.stones;
  const beforeMythic = st.mythicChests;
  const claimed = claimFairyGift(st, () => 0.01, 10_000);
  assert.ok(claimed !== null);
  assert.ok(claimed.stones > 0);
  assert.equal(claimed.mythicChests, 1);
  assert.equal(claimed.buffKind, 'stones');
  assert.equal(st.stones, beforeStones + claimed.stones);
  assert.equal(st.mythicChests, beforeMythic + 1);
  assert.equal(st.fairy.giftsReady, 1);
  assert.equal(st.fairy.totalClaimed, 1);
  assert.ok(st.fairy.buffUntil > 10_000);

  // Salvage bonus applies cleanly
  const sampleItem = generateItem({ stage: 50, forcedRarity: 2, forcedSlot: 'weapon' });
  const baseDust = getSalvageValue(sampleItem, 0);
  const boostedDust = getSalvageValue(sampleItem, 24);
  assert.ok(boostedDust > baseDust);

  // Save migration fills default fairy state for old saves without fairy key
  const oldSave = JSON.stringify({
    stage: 150,
    maxStage: 150,
    cleared100: true,
    equipped: createDefaultState().equipped,
  });
  const parsed = parseSaveState(oldSave);
  assert.ok(parsed !== null);
  assert.equal(parsed.fairy.giftsReady, 0);
  assert.ok(parsed.fairy.cooldownSec > 0);
});

test('filterAndSortStorageItems and getNextSelectedStorageId keep salvage selection scoped to active tab', () => {
  const w1 = { ...generateItem({ stage: 5, forcedRarity: 0, forcedSlot: 'weapon' }), id: 'w1' };
  const w2 = { ...generateItem({ stage: 10, forcedRarity: 2, forcedSlot: 'weapon' }), id: 'w2' };
  const a1 = { ...generateItem({ stage: 8, forcedRarity: 3, forcedSlot: 'armor' }), id: 'a1' };
  const r1 = { ...generateItem({ stage: 4, forcedRarity: 1, forcedSlot: 'ring' }), id: 'r1' };
  const inventory = [w1, a1, w2, r1];

  // Weapon tab sorted by rarity: [w2, w1]
  const weaponTab = filterAndSortStorageItems(inventory, 'weapon', 'rarity');
  assert.deepEqual(
    weaponTab.map((i) => i.id),
    ['w2', 'w1'],
  );

  // Salvaging w2 advances to w1 (next weapon in weapon tab), never a1
  assert.equal(getNextSelectedStorageId(weaponTab, 'w2'), 'w1');

  // Salvaging the last weapon in the weapon tab yields null (never jumps to armor/ring)
  const weaponTabLast = weaponTab.filter((i) => i.id !== 'w2');
  assert.equal(getNextSelectedStorageId(weaponTabLast, 'w1'), null);

  // 'all' tab sorted by rarity: [a1 (rarity 3), w2 (rarity 2), r1 (rarity 1), w1 (rarity 0)]
  const allTab = filterAndSortStorageItems(inventory, 'all', 'rarity');
  assert.deepEqual(
    allTab.map((i) => i.id),
    ['a1', 'w2', 'r1', 'w1'],
  );
  assert.equal(getNextSelectedStorageId(allTab, 'a1'), 'w2');
  assert.equal(getNextSelectedStorageId(allTab, 'w1'), 'r1');
});

test('Sanctum predicates identify 10F mid-bosses, 50F Sanctums, and 49F/99F gate floors', () => {
  assert.equal(isMidBossFloor(10), true);
  assert.equal(isMidBossFloor(40), true);
  assert.equal(isMidBossFloor(60), true);
  assert.equal(isMidBossFloor(50), false);
  assert.equal(isMidBossFloor(100), false);

  assert.equal(isSanctumFloor(50), true);
  assert.equal(isSanctumFloor(100), true);
  assert.equal(isSanctumFloor(150), true);
  assert.equal(isSanctumFloor(49), false);

  assert.equal(isGateFloor(49), true);
  assert.equal(isGateFloor(99), true);
  assert.equal(isGateFloor(50), false);

  assert.equal(isHeldAtGate(49, 0), true);
  assert.equal(isHeldAtGate(49, 50), false);
  assert.equal(isHeldAtGate(99, 50), true);
  assert.equal(isHeldAtGate(99, 100), false);

  assert.equal(getUnlockedSanctumTarget(20, 49, 0), null);
  assert.equal(getUnlockedSanctumTarget(49, 50, 0), 50);
  assert.equal(getUnlockedSanctumTarget(10, 50, 0), 50);
  assert.equal(getUnlockedSanctumTarget(65, 65, 50), 50);
  assert.equal(getUnlockedSanctumTarget(99, 100, 50), 100);
  assert.equal(getUnlockedSanctumTarget(40, 100, 50), 100);
});

test('Sanctum progression halts autoProgress at 49F gate until 50F Great Boss is defeated', () => {
  // Clearing 49F with autoProgress ON holds at 49F while unlocking maxStage 50
  const gateRes = resolveBossVictoryProgression({
    stage: 49,
    maxStage: 49,
    autoProgress: true,
    clearedSanctumMax: 0,
  });
  assert.equal(gateRes.heldAtGate, true);
  assert.equal(gateRes.nextStage, 49);
  assert.equal(gateRes.nextMaxStage, 50);
  assert.equal(gateRes.nextClearedSanctumMax, 0);

  // Defeating 50F Great Boss exits Sanctum to 51F even if autoProgress is OFF
  const sanctumClear = resolveBossVictoryProgression({
    stage: 50,
    maxStage: 50,
    autoProgress: false,
    clearedSanctumMax: 0,
  });
  assert.equal(sanctumClear.sanctumCleared, 50);
  assert.equal(sanctumClear.heldAtGate, false);
  assert.equal(sanctumClear.nextStage, 51);
  assert.equal(sanctumClear.nextMaxStage, 51);
  assert.equal(sanctumClear.nextClearedSanctumMax, 50);

  // Re-clearing 49F after 50F is cleared skips 50F directly to 51F
  const skipRes = resolveBossVictoryProgression({
    stage: 49,
    maxStage: 51,
    autoProgress: true,
    clearedSanctumMax: 50,
  });
  assert.equal(skipRes.heldAtGate, false);
  assert.equal(skipRes.nextStage, 51);
});

test('Manual stage navigation and defeat retreat never enter Sanctums automatically', () => {
  assert.equal(getNextManualStage(49, 50, 0), null);
  assert.equal(getNextManualStage(49, 51, 50), 51);
  assert.equal(getNextManualStage(50, 50, 0), null);
  assert.equal(getNextManualStage(50, 51, 50), 51);

  assert.equal(getPrevManualStage(51), 49);
  assert.equal(getPrevManualStage(50), 49);
  assert.equal(getPrevManualStage(1), null);

  assert.equal(resolveDefeatRetreatStage(50), 49);
  assert.equal(resolveDefeatRetreatStage(51), 49);
  assert.equal(resolveDefeatRetreatStage(49), 48);
});

test('Sanctum entry requires unlocked gate + key and consumes 1 key per entry', () => {
  const st = createDefaultState();
  st.stage = 49;
  st.maxStage = 49;
  st.sanctumKeys = 2;
  assert.deepEqual(canEnterSanctum(st, 50), { ok: false, reason: 'locked' });

  st.maxStage = 50;
  st.sanctumKeys = 0;
  assert.deepEqual(canEnterSanctum(st, 50), { ok: false, reason: 'no_key' });

  st.sanctumKeys = 2;
  st.floorEncounters = 7;
  assert.equal(enterSanctumState(st, 50), true);
  assert.equal(st.sanctumKeys, 1);
  assert.equal(st.stage, 50);
  assert.equal(st.floorEncounters, 0);

  // Cannot re-enter another Sanctum while already inside a Sanctum
  assert.deepEqual(canEnterSanctum(st, 50), { ok: false, reason: 'already_in_sanctum' });
  assert.equal(enterSanctumState(st, 50), false);
  assert.equal(st.sanctumKeys, 1);
});

test('Sanctum chamber layout, Great Boss drops, and blind-try difficulty vs upgraded clear', () => {
  const chamber = generateSanctumChamber();
  assert.equal(chamber.grid[chamber.spawn.y][chamber.spawn.x], 0);
  assert.equal(chamber.grid[chamber.bossCell.y][chamber.bossCell.x], 0);
  assert.equal(chamber.grid[chamber.stairs.y][chamber.stairs.x], 0);
  assert.ok(chamber.explored.has(crawlKey(chamber.bossCell.x, chamber.bossCell.y)));
  assert.ok(chamber.explored.has(crawlKey(chamber.stairs.x, chamber.stairs.y)));

  for (let i = 0; i < 40; i++) {
    const rPre = rollSanctumDropRarity(false, false, () => i / 40);
    assert.ok(rPre >= 2 && rPre <= 3);
    const rPost = rollSanctumDropRarity(true, true, () => i / 40);
    assert.ok(rPost >= 2 && rPost <= 4);
  }
  assert.equal(rollSanctumDropRarity(true, false, () => 0.05), 4);

  const boss49 = createEnemy(49, true);
  const boss50 = createEnemy(50, true);
  assert.equal(boss50.isSanctumBoss, true);
  assert.equal(boss50.isMidBoss, false);
  assert.equal(boss50.isGreatDemon, false);
  assert.ok(boss50.maxHp > boss49.maxHp * 3);
  assert.ok(boss50.atk > boss49.atk * 2);

  // Simulate deterministic combat: a hero who clears 49F loses blind on 50F,
  // while +20 upgraded Legend 49F-tier gear defeats 50F Great Boss
  const st = createDefaultState();
  const buildSet = (rarity: 1 | 3, level: number) => {
    const eq = { ...st.equipped };
    for (const slot of SLOT_ORDER) {
      eq[slot] = {
        ...generateItem({ stage: 49, forcedRarity: rarity, forcedSlot: slot }),
        level,
        subStats:
          rarity === 3
            ? [
                { key: 'atkPct', val: 12, boosts: 1 },
                { key: 'critRate', val: 8, boosts: 1 },
                { key: 'armorPen', val: 14, boosts: 1 },
                { key: 'bossDmg', val: 16, boosts: 1 },
              ]
            : [
                { key: 'atkPct', val: 5, boosts: 0 },
                { key: 'critRate', val: 4, boosts: 0 },
              ],
      };
    }
    return calcHeroStats(eq, false);
  };
  const simulateTurnsToKill = (stats: ReturnType<typeof calcHeroStats>, enemy: ReturnType<typeof createEnemy>) => {
    const nonCritHit = calcHitDamage(stats, enemy.defRate, true, 0, 1, 1);
    const critHit = calcHitDamage(stats, enemy.defRate, true, 1, 1, 1);
    const pCrit = Math.min(1, stats.critRate / 100);
    const avgHit = nonCritHit * (1 - pCrit) + critHit * pCrit;
    const enemyHitFreq = enemy.isKeyKeeper ? 0.5 : 1.0;
    return {
      ttkTurns: enemy.maxHp / Math.max(1, avgHit),
      surviveTurns: stats.hp / Math.max(1, enemy.atk * enemyHitFreq),
    };
  };

  const blindHero = buildSet(1, 5);
  const blindVs49 = simulateTurnsToKill(blindHero, boss49);
  const blindVs50 = simulateTurnsToKill(blindHero, boss50);
  assert.ok(
    blindVs49.surviveTurns > blindVs49.ttkTurns,
    `Blind 49F hero should beat 49F boss (survive=${blindVs49.surviveTurns.toFixed(1)}t, ttk=${blindVs49.ttkTurns.toFixed(1)}t)`,
  );
  assert.ok(
    blindVs50.surviveTurns < blindVs50.ttkTurns,
    `Blind 49F hero should lose to 50F Great Boss (survive=${blindVs50.surviveTurns.toFixed(1)}t, ttk=${blindVs50.ttkTurns.toFixed(1)}t)`,
  );

  const gearedHero = buildSet(3, 20);
  const gearedVs50 = simulateTurnsToKill(gearedHero, boss50);
  assert.ok(
    gearedVs50.surviveTurns > gearedVs50.ttkTurns,
    `Upgraded 49F Legend+20 hero should beat 50F Great Boss (survive=${gearedVs50.surviveTurns.toFixed(1)}t, ttk=${gearedVs50.ttkTurns.toFixed(1)}t)`,
  );
});

test('parseSaveState persists sanctumKeys/clearedSanctumMax and safely migrates legacy Sanctum saves', () => {
  const base = createDefaultState();
  const saved = parseSaveState(
    JSON.stringify({
      ...base,
      stage: 49,
      maxStage: 50,
      sanctumKeys: 3,
      clearedSanctumMax: 0,
    }),
  );
  assert.ok(saved !== null);
  assert.equal(saved.sanctumKeys, 3);
  assert.equal(saved.clearedSanctumMax, 0);

  // Legacy save without clearedSanctumMax stuck on 50F retreats safely to 49F
  const legacyAt50 = parseSaveState(
    JSON.stringify({
      stage: 50,
      maxStage: 50,
      equipped: base.equipped,
    }),
  );
  assert.ok(legacyAt50 !== null);
  assert.equal(legacyAt50.stage, 49);
  assert.equal(legacyAt50.sanctumKeys, 0);
  assert.equal(legacyAt50.clearedSanctumMax, 0);

  // Legacy save at 125F infers clearedSanctumMax >= 100
  const legacyAt125 = parseSaveState(
    JSON.stringify({
      stage: 125,
      maxStage: 125,
      cleared100: true,
      equipped: base.equipped,
    }),
  );
  assert.ok(legacyAt125 !== null);
  assert.equal(legacyAt125.clearedSanctumMax, 100);
});

test('SPRITE_REGISTRY and WALL_TEXTURE_GRIDS are valid, rectangular, and cover every biome/enemy spriteId', () => {
  const spriteKeys = Object.keys(SPRITE_REGISTRY) as Array<keyof typeof SPRITE_REGISTRY>;
  assert.equal(spriteKeys.length, 33);

  for (const key of spriteKeys) {
    const def = SPRITE_REGISTRY[key];
    assert.equal(
      validateSpriteDefinition(def),
      true,
      `Sprite "${key}" must have matching 2-frame rectangular dimensions and valid palette chars`,
    );
  }

  for (const biome of BIOMES) {
    for (const mob of biome.mobs) {
      assert.ok(mob.spriteId in SPRITE_REGISTRY, `Missing mob sprite "${mob.spriteId}"`);
    }
    assert.ok(biome.boss.spriteId in SPRITE_REGISTRY, `Missing boss sprite "${biome.boss.spriteId}"`);
  }

  const slime = createEnemy(1, false, -100);
  assert.ok(slime.spriteId in SPRITE_REGISTRY);

  const golden = createEnemy(10, false, 100);
  assert.equal(golden.spriteId, 'golden_slime');

  const boss50 = createEnemy(50, true);
  assert.ok(boss50.spriteId in SPRITE_REGISTRY);

  const demon100 = createEnemy(100, true);
  assert.equal(demon100.spriteId, 'great_demon');

  const wallKeys = Object.keys(WALL_TEXTURE_GRIDS) as Array<keyof typeof WALL_TEXTURE_GRIDS>;
  assert.deepEqual(wallKeys.sort(), ['crimson', 'dungeon', 'golden', 'jade', 'sanctum', 'void']);
  const allowedWallChars = new Set(['.', 'l', 'd', 'a', 'g']);
  for (const wk of wallKeys) {
    const grid = WALL_TEXTURE_GRIDS[wk];
    assert.equal(grid.length, 16, `Wall theme "${wk}" must be 16 rows`);
    for (const row of grid) {
      assert.equal(row.length, 16, `Wall theme "${wk}" row must be 16 cols`);
      for (const ch of row) {
        assert.ok(allowedWallChars.has(ch), `Invalid char "${ch}" in wall theme "${wk}"`);
      }
    }
  }

  assert.equal(resolveWallThemeKey(0, false), 'dungeon');
  assert.equal(resolveWallThemeKey(1, false), 'golden');
  assert.equal(resolveWallThemeKey(2, true), 'sanctum');
});

test('Mythic +40 upgrade cap, progressive stone-sink cost, save persistence, and 150F Sanctum difficulty', () => {
  const legendWep = generateItem({ stage: 149, forcedRarity: 3, forcedSlot: 'weapon' });
  const mythicWep = generateItem({ stage: 149, forcedRarity: 4, forcedSlot: 'weapon' });
  assert.equal(getMaxEquipLevel(legendWep), 20);
  assert.equal(getMaxEquipLevel(mythicWep), 40);

  // Lv20 -> Lv40 scales mainStat (+9%/lv past +20) and steepens stone cost as a late-game sink
  const m20 = { ...mythicWep, level: 20 };
  const m40 = { ...mythicWep, level: 40 };
  assert.equal(getMainStatVal(m20), Math.round(m20.mainStat.base * 3.4));
  assert.equal(getMainStatVal(m40), Math.round(m40.mainStat.base * 5.2));
  assert.ok(getUpgradeCost(m20) > getUpgradeCost({ ...mythicWep, level: 19 }));
  assert.ok(getUpgradeCost({ ...mythicWep, level: 39 }) > getUpgradeCost(m20) * 2);

  // Save parser keeps Mythic Lv40 while clamping Legend Lv30 down to Lv20
  const base = createDefaultState();
  const parsed = parseSaveState(
    JSON.stringify({
      ...base,
      stage: 149,
      maxStage: 150,
      cleared100: true,
      equipped: {
        ...base.equipped,
        weapon: m40,
        armor: { ...generateItem({ stage: 149, forcedRarity: 3, forcedSlot: 'armor' }), level: 30 },
      },
    }),
  );
  assert.ok(parsed !== null);
  assert.equal(parsed.equipped.weapon.level, 40);
  assert.equal(parsed.equipped.armor.level, 20);

  // 150F Sanctum boss kills +20 Mythic gear, whereas +40 Mythic gear defeats it cleanly
  const boss150 = createEnemy(150, true);
  const build149MythicSet = (level: number) => {
    const eq = { ...base.equipped };
    for (const slot of SLOT_ORDER) {
      eq[slot] = {
        ...generateItem({ stage: 149, forcedRarity: 4, forcedSlot: slot }),
        level,
        subStats: [
          { key: 'atkPct', val: 8 + Math.floor(level / 4) * 1.2, boosts: Math.floor(level / 16) },
          { key: 'critRate', val: 7 + Math.floor(level / 4) * 1.1, boosts: Math.floor(level / 16) },
          { key: 'armorPen', val: 10 + Math.floor(level / 4) * 1.3, boosts: Math.floor(level / 16) },
          { key: 'bossDmg', val: 14 + Math.floor(level / 4) * 2.0, boosts: Math.floor(level / 16) },
        ],
      };
    }
    return calcHeroStats(eq, true);
  };
  const sim = (stats: ReturnType<typeof calcHeroStats>) => {
    const c = stats.critDmg / 100;
    const critMult =
      stats.critRate <= 100
        ? 1 + (stats.critRate / 100) * (c - 1)
        : stats.critRate <= 200
          ? c * (1 + ((stats.critRate - 100) / 100) * 1.0)
          : c * (2.0 + ((stats.critRate - 200) / 100) * 2.0);
    const pen = stats.armorPen / 100;
    const defMult = Math.max(0.1, 1 - boss150.defRate * (1 - pen));
    const dmgPerTurn = stats.atk * (1 + stats.dmgPct / 100) * (1 + stats.bossDmg / 100) * critMult * defMult;
    return {
      ttkTurns: boss150.maxHp / dmgPerTurn,
      surviveTurns: stats.hp / boss150.atk,
    };
  };

  const at20 = sim(build149MythicSet(20));
  const at40 = sim(build149MythicSet(40));
  assert.ok(
    at20.surviveTurns < at20.ttkTurns,
    `Mythic+20 should lose to 150F Sanctum (survive=${at20.surviveTurns.toFixed(1)}t, ttk=${at20.ttkTurns.toFixed(1)}t)`,
  );
  assert.ok(
    at40.surviveTurns > at40.ttkTurns,
    `Mythic+40 should beat 150F Sanctum (survive=${at40.surviveTurns.toFixed(1)}t, ttk=${at40.ttkTurns.toFixed(1)}t)`,
  );
});

test('Mysterious Dungeon floor generates connected rooms, corridors, Monster House, pickups, and enemies', () => {
  const floor = generateMaze(25, 25, { stage: 5, monsterHouseChance: 1.0 });
  assert.ok(floor.rooms.length >= 5 && floor.rooms.length <= 6);
  assert.ok(floor.monsterHouseRoomId !== null, 'Monster House should be designated when chance=1');

  for (const room of floor.rooms) {
    assert.ok(room.w >= 3 && room.w <= 5 && room.h >= 3 && room.h <= 5);
    assert.ok(room.entrances.length >= 1, `Room ${room.id} must have at least 1 corridor entrance`);
    const path = bfsPath(floor.grid, floor.spawn.x, floor.spawn.y, room.cx, room.cy);
    assert.ok(path !== null, `Room ${room.id} must be reachable from spawn`);
  }

  const stairsPath = bfsPath(floor.grid, floor.spawn.x, floor.spawn.y, floor.stairs.x, floor.stairs.y);
  assert.ok(stairsPath !== null && stairsPath.length > 4);

  const events = placeMazeEvents(floor.depth, floor.stairs, Math.random, floor.rooms, floor.spawn);
  assert.ok(events.length >= 4);
  for (const ev of events) {
    assert.notEqual(ev.type, 'heal', 'Floor healing potions should not spawn');
    assert.ok(!(ev.x === floor.spawn.x && ev.y === floor.spawn.y), 'Loot should not spawn on hero spawn');
    assert.ok(ev.spriteId && ev.spriteId in SPRITE_REGISTRY, `Loot sprite "${ev.spriteId}" must exist`);
  }

  const stairsRoomId = floor.roomGrid[floor.stairs.y][floor.stairs.x];
  const enemies = placeDungeonEnemies({
    stage: 5,
    rooms: floor.rooms,
    startRoomId: 0,
    stairsRoomId,
    stairs: floor.stairs,
    spawn: floor.spawn,
  });
  const boss = enemies.find((e) => e.enemy.isBoss);
  assert.ok(boss && boss.id === 'boss_keykeeper' && boss.enemy.isKeyKeeper === true, 'Floor must spawn 1 roaming Key-Keeper boss');
  assert.ok(!(boss.x === floor.stairs.x && boss.y === floor.stairs.y), 'Key-Keeper must not be pinned on stairs');
  assert.notEqual(boss.roomId, 0, 'Key-Keeper must not spawn in start room');
  const mhMobs = enemies.filter((e) => e.roomId === floor.monsterHouseRoomId && !e.enemy.isBoss);
  assert.ok(mhMobs.length >= 4, `Monster House should spawn >= 4 mobs, got ${mhMobs.length}`);
  assert.equal(
    enemies.some((e) => e.x === floor.spawn.x && e.y === floor.spawn.y),
    false,
    'No enemy may spawn on hero spawn cell',
  );
});

test('revealDungeonTiles opens entire room on entry, while corridors reveal strictly 1 orthogonal step', () => {
  const floor = generateMaze(25, 25, { stage: 1, monsterHouseChance: 0 });
  const explored = new Set<string>();
  const r0 = floor.rooms[0];

  const enterRes = revealDungeonTiles(floor.grid, floor.roomGrid, floor.rooms, explored, r0.cx, r0.cy, 0);
  assert.equal(enterRes.enteredRoomId, r0.id);
  for (let y = r0.y - 1; y <= r0.y + r0.h; y++) {
    for (let x = r0.x - 1; x <= r0.x + r0.w; x++) {
      assert.equal(explored.has(crawlKey(x, y)), true, `Perimeter/interior tile (${x},${y}) must open`);
    }
  }

  const ent = r0.entrances[0];
  const corrExplored = new Set<string>();
  const corrRes = revealDungeonTiles(floor.grid, floor.roomGrid, floor.rooms, corrExplored, ent.x, ent.y, 0);
  assert.equal(corrRes.enteredRoomId, -1);
  assert.equal(corrExplored.has(crawlKey(ent.x, ent.y)), true);
  // Diagonal tiles around corridor must NOT be revealed (strictly 1-tile orthogonal torchlight)
  assert.equal(corrExplored.has(crawlKey(ent.x + 1, ent.y + 1)), false);
  assert.equal(corrExplored.has(crawlKey(ent.x - 1, ent.y - 1)), false);
});

test('Monster House corridor retreat, single-file enemy stepping, multi-enemy engagement, and resting thresholds', () => {
  // 5x5 layout: corridor at (1,2) leading into a 3x3 room [2..4, 1..3]
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  const roomGrid = [
    [-1, -1, -1, -1, -1, -1],
    [-1, -1, 0, 0, 0, -1],
    [-1, -1, 0, 0, 0, -1],
    [-1, -1, 0, 0, 0, -1],
    [-1, -1, -1, -1, -1, -1],
  ];
  const stairs = { x: 4, y: 2 };
  const mobA = {
    id: 'm1',
    x: 3,
    y: 2,
    roomId: 0,
    awakened: false,
    atkTimer: 0,
    shake: 0,
    flashTimer: 0,
    rareEscapeTimer: 10,
    enemy: createEnemy(5, false, -100),
  };
  const mobB = {
    id: 'm2',
    x: 4,
    y: 1,
    roomId: 0,
    awakened: false,
    atkTimer: 0,
    shake: 0,
    flashTimer: 0,
    rareEscapeTimer: 10,
    enemy: createEnemy(5, false, -100),
  };
  const keyKeeper = {
    id: 'boss_keykeeper',
    x: 4,
    y: 2,
    roomId: 0,
    awakened: false,
    prevCell: null,
    atkTimer: 0,
    shake: 0,
    flashTimer: 0,
    rareEscapeTimer: 6,
    enemy: createEnemy(5, true, -100),
  };
  const enemies = [mobA, mobB, keyKeeper];

  // Before entering room: regular mobs inside the room (d>=2) stay asleep; Key-Keeper holds on odd turns
  stepEnemiesTowardHero(grid, roomGrid, { x: 1, y: 2 }, stairs, enemies, 1);
  assert.equal(mobA.awakened, false);
  assert.equal(mobB.awakened, false);
  assert.deepEqual({ x: keyKeeper.x, y: keyKeeper.y }, { x: 4, y: 2 });

  // Key-Keeper roams 1 step on even turns (turnNumber % 2 === 0) even when unawakened
  stepEnemiesTowardHero(grid, roomGrid, { x: 1, y: 2 }, stairs, enemies, 2, () => 0.25);
  assert.equal(Math.abs(keyKeeper.x - 4) + Math.abs(keyKeeper.y - 2), 1);
  keyKeeper.x = 4;
  keyKeeper.y = 2;
  keyKeeper.prevCell = null;

  // After stepping into room doorway (2,2) from corridor (1,2), retreats 1 step back to (1,2) facing east (0 rad)
  const retreat = findChokeRetreatCell(grid, roomGrid, { x: 2, y: 2 }, 0, enemies, stairs, { x: 1, y: 2 });
  assert.ok(retreat !== null);
  assert.deepEqual(retreat.cell, { x: 1, y: 2 });
  assert.ok(Math.abs(retreat.faceAngle - 0) < 1e-6);

  // Room alert (as triggered on retreat): awakened regular enemies funnel single-file toward doorway (1,2)
  mobA.awakened = true;
  mobB.awakened = true;
  keyKeeper.awakened = true;
  stepEnemiesTowardHero(grid, roomGrid, { x: 1, y: 2 }, stairs, enemies, 1);
  assert.deepEqual({ x: mobA.x, y: mobA.y }, { x: 2, y: 2 });
  // On odd turns Key-Keeper stays in place; on even turns awakened Key-Keeper also advances
  assert.deepEqual({ x: keyKeeper.x, y: keyKeeper.y }, { x: 4, y: 2 });

  // Surrounded check: both orth-adjacent enemies engage simultaneously, front-facing sorted first
  mobA.x = 2;
  mobA.y = 2; // east of hero at (1,2) -> angle 0
  mobB.x = 1;
  mobB.y = 1; // north of hero at (1,2) -> angle -pi/2
  const engaged = getEngagedEnemies({ x: 1, y: 2 }, [mobB, mobA], 0);
  assert.equal(engaged.length, 2);
  assert.equal(engaged[0].id, 'm1');

  // Rest thresholds: enter <60%, exit >=85%
  assert.equal(shouldEnterRestMode(59, 100), true);
  assert.equal(shouldEnterRestMode(60, 100), false);
  assert.equal(shouldExitRestMode(84, 100), false);
  assert.equal(shouldExitRestMode(85, 100), true);

  // Mob flanking around stationary enemy on odd turn routes around occupied tile to reach hero
  const flankMob = {
    id: 'flank',
    x: 4,
    y: 2,
    roomId: 0,
    awakened: true,
    prevCell: null,
    atkTimer: 0,
    shake: 0,
    flashTimer: 0,
    rareEscapeTimer: 6,
    enemy: createEnemy(5, false, -100),
  };
  const blockingKeeper = {
    ...keyKeeper,
    x: 3,
    y: 2,
    awakened: true,
  };
  const heroAtKeeper = { x: 2, y: 2 };
  stepEnemiesTowardHero(grid, roomGrid, heroAtKeeper, stairs, [flankMob, blockingKeeper], 1);
  assert.equal(flankMob.x, 4);
  assert.ok(flankMob.y === 1 || flankMob.y === 3, 'Mob directly behind Key-Keeper must step sideways to flank');
  for (let step = 0; step < 3; step++) {
    stepEnemiesTowardHero(grid, roomGrid, heroAtKeeper, stairs, [flankMob, blockingKeeper], 1);
  }
  const finalDist = Math.abs(flankMob.x - heroAtKeeper.x) + Math.abs(flankMob.y - heroAtKeeper.y);
  assert.equal(finalDist, 1, 'Flanking mob must reach adjacent tile around hero while Key-Keeper blocks center');
});

test('shouldRetreatInRoom and findHeroSafePath prevent fighting boss while room mobs flank hero', () => {
  const mkMob = (id: string, x: number, y: number, isBoss = false) => ({
    id,
    x,
    y,
    roomId: 0,
    awakened: false,
    atkTimer: 0,
    shake: 0,
    flashTimer: 0,
    rareEscapeTimer: 10,
    enemy: createEnemy(5, isBoss, -100),
  });

  const boss = mkMob('boss', 3, 3, true);
  const mob1 = mkMob('m1', 5, 3, false);
  const mob2 = mkMob('m2', 5, 1, false);

  // 1 mob alone -> fight in room; 2 mobs -> retreat; boss alone -> fight in room; boss + 1 mob -> retreat!
  assert.equal(shouldRetreatInRoom([mob1], 0), false);
  assert.equal(shouldRetreatInRoom([mob1, mob2], 0), true);
  assert.equal(shouldRetreatInRoom([boss], 0), false);
  assert.equal(shouldRetreatInRoom([boss, mob1], 0), true);

  // 5x5 open room [1..5, 1..5] with boss at center (3,3)
  const roomGrid5 = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  // Navigating from (1,3) to mob/item at (5,3) must route around boss (3,3) AND its 4 adjacent tiles
  const safePath = findHeroSafePath(roomGrid5, 1, 3, 5, 3, [boss]);
  assert.ok(safePath !== null && safePath.length > 5);
  for (const step of safePath) {
    const dBoss = Math.abs(step.x - boss.x) + Math.abs(step.y - boss.y);
    assert.ok(dBoss >= 2, `Safe path step (${step.x},${step.y}) must keep distance >= 2 from boss`);
  }

  // Navigating to boss itself routes directly
  const bossPath = findHeroSafePath(roomGrid5, 1, 3, boss.x, boss.y, [boss]);
  assert.ok(bossPath !== null && bossPath.length === 3);

  // Narrow 3x3 choke where every path passes adjacent to boss still avoids boss tile itself
  const narrowGrid = [
    [1, 1, 1, 1, 1],
    [1, 1, 0, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 0, 1, 1],
    [1, 1, 1, 1, 1],
  ];
  const narrowBoss = mkMob('nboss', 2, 2, true);
  const narrowPath = findHeroSafePath(narrowGrid, 1, 2, 3, 2, [narrowBoss]);
  assert.ok(narrowPath !== null);
});

test('Boots main stat is dmgPct, aspd is removed, and legacy saves migrate aspd cleanly', () => {
  assert.equal(SLOTS.boots.mainType, 'dmgPct');
  assert.equal(SLOTS.boots.mainLabel, '与ダメージ');
  assert.equal(
    SUB_POOL.some((s) => (s.key as string) === 'aspd'),
    false,
  );

  const boots = generateItem({ stage: 5, forcedRarity: 2, forcedSlot: 'boots' });
  assert.equal(boots.mainStat.type, 'dmgPct');

  const base = createDefaultState();
  const legacySave = JSON.stringify({
    ...base,
    equipped: {
      ...base.equipped,
      boots: {
        ...boots,
        mainStat: { type: 'aspd', base: 14, label: '攻撃速度', unit: '%' },
        subStats: [{ key: 'aspd', val: 6.5, boosts: 1 }],
      },
      weapon: {
        ...base.equipped.weapon,
        subStats: [
          { key: 'dmgPct', val: 4.0, boosts: 0 },
          { key: 'aspd', val: 5.5, boosts: 0 },
        ],
      },
    },
  });
  const parsed = parseSaveState(legacySave);
  assert.ok(parsed !== null);
  assert.equal(parsed.equipped.boots.mainStat.type, 'dmgPct');
  assert.equal(parsed.equipped.boots.subStats[0].key, 'dmgPct');
  // Weapon already had dmgPct so migrated substat must pick another non-duplicate SUB_POOL key
  assert.equal(
    parsed.equipped.weapon.subStats.some((s) => (s.key as string) === 'aspd'),
    false,
  );
  assert.equal(new Set(parsed.equipped.weapon.subStats.map((s) => s.key)).size, parsed.equipped.weapon.subStats.length);
});

test('snapCardinalAngle and cardinalAngleFromDelta always snap strictly to 4 cardinal directions', () => {
  const valid = new Set([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
  for (const sample of [0, 0.23, 1.35, -1.49, 2.9, -3.05, Math.PI * 1.98]) {
    const snapped = snapCardinalAngle(sample);
    assert.ok(valid.has(snapped), `Expected exact cardinal angle, got ${snapped} for ${sample}`);
  }
  assert.equal(cardinalAngleFromDelta(1, 0), 0);
  assert.equal(cardinalAngleFromDelta(0, 1), Math.PI / 2);
  assert.equal(cardinalAngleFromDelta(-1, 0), Math.PI);
  assert.equal(cardinalAngleFromDelta(0, -1), -Math.PI / 2);
});

test('Key-Keeper moves once every 2 turns and pickExplorationTarget prioritizes Key-Keeper when floor explored without key', () => {
  const grid = [
    [1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  const roomGrid = [
    [-1, -1, -1, -1, -1, -1],
    [-1, 0, 0, 0, 0, -1],
    [-1, 0, 0, 0, 0, -1],
    [-1, 0, 0, 0, 0, -1],
    [-1, -1, -1, -1, -1, -1],
  ];
  const stairs = { x: 4, y: 1 };
  const keeper = {
    id: 'boss_keykeeper',
    x: 4,
    y: 3,
    roomId: 0,
    awakened: true,
    prevCell: null,
    atkTimer: 0,
    shake: 0,
    flashTimer: 0,
    rareEscapeTimer: 6,
    enemy: createEnemy(5, true, -100),
  };

  // Odd turn: Key-Keeper does not move
  stepEnemiesTowardHero(grid, roomGrid, { x: 1, y: 1 }, stairs, [keeper], 1);
  assert.deepEqual({ x: keeper.x, y: keeper.y }, { x: 4, y: 3 });

  // Even turn: Awakened Key-Keeper steps 1 tile closer to hero
  stepEnemiesTowardHero(grid, roomGrid, { x: 1, y: 1 }, stairs, [keeper], 2);
  const dAfter = Math.abs(keeper.x - 1) + Math.abs(keeper.y - 1);
  assert.equal(dAfter, 4);

  // When whole floor explored & stepped without key, target becomes Key-Keeper instead of stairs
  const explored = new Set<string>();
  const stepped = new Set<string>();
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 4; x++) {
      explored.add(crawlKey(x, y));
      stepped.add(crawlKey(x, y));
    }
  }
  const targetKeeper = pickExplorationTarget(
    grid,
    1,
    1,
    0,
    explored,
    stepped,
    stairs,
    [],
    () => 0,
    undefined,
    undefined,
    undefined,
    { hasFloorKey: false, enemies: [keeper] },
  );
  assert.deepEqual(targetKeeper.target, { x: keeper.x, y: keeper.y });
});

test('getTurnSpeedScale slows base x1 pace to 1/3 while scaling x2 and x4 proportionally', () => {
  const s1 = getTurnSpeedScale(1);
  const s2 = getTurnSpeedScale(2);
  const s4 = getTurnSpeedScale(4);
  assert.ok(Math.abs(s1 - 1 / 3) < 1e-6);
  assert.ok(Math.abs(s2 - s1 * 2) < 1e-6);
  assert.ok(Math.abs(s4 - s1 * 4) < 1e-6);
});

test('Sanctum key drops probabilistically from any regular Key-Keeper boss at reduced chance', () => {
  assert.ok(SANCTUM_KEY_DROP_CHANCE > 0 && SANCTUM_KEY_DROP_CHANCE <= 0.2);
  assert.equal(rollSanctumKeyDrop(true, () => 0.01), true);
  assert.equal(rollSanctumKeyDrop(true, () => SANCTUM_KEY_DROP_CHANCE - 0.001), true);
  assert.equal(rollSanctumKeyDrop(true, () => SANCTUM_KEY_DROP_CHANCE), false);
  assert.equal(rollSanctumKeyDrop(true, () => 0.5), false);
  assert.equal(rollSanctumKeyDrop(false, () => 0.0), false);
});








