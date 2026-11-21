import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BIOMES,
  CHEST_BATCH_MAX,
  EQUIP_SLOT_ORDER,
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
  ACCESSORY_AXES,
  ACCESSORY_AXIS_ORDER,
  ACCESSORY_COMBOS,
  FOLLOW_UP_DAMAGE_RATIO,
  ICE_PURE_THIRD_HIT_RATIO,
  MAX_EXTRA_MULTI_HITS,
  getAccessoryCombo,
  getAccessoryComboId,
  getExpectedMultiHitMultiplier,
  resolveTurnAttackPlan,
  rollExtraHits,
} from './accessories';
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
  rollMobArchetype,
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
import {
  computeSynthesisPreview,
  countReadySynthesisRecipes,
  executeSynthesis,
  getEligibleSynthesisCandidates,
  isSynthesisRecipeUnlocked,
  MYTHIC_REFORGE_COUNT,
  pickWeightedOutcomeFromMaterials,
  SYNTHESIS_MATERIAL_COUNT,
  SYNTHESIS_STONE_REFUND_RATE,
} from './synthesis';
import type { AccessoryAxis, AccessoryComboId, EquippedSet, HeroStats } from './types';

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

  const common = generateItem({ stage: 10, forcedRarity: 0, forcedSlot: 'accessory', forcedAxis: 'lightning' });
  const epic = generateItem({ stage: 10, forcedRarity: 2, forcedSlot: 'accessory', forcedAxis: 'fire' });
  const legend = generateItem({ stage: 10, forcedRarity: 3, forcedSlot: 'accessory', forcedAxis: 'dark' });
  const mythic = generateItem({ stage: 10, forcedRarity: 4, forcedSlot: 'accessory', forcedAxis: 'ice' });

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

test('Fixed-cap accessories (ice, fire, lightning, dark) do not inflate with stage', () => {
  for (const axis of ACCESSORY_AXIS_ORDER) {
    const r1 = generateItem({ stage: 1, forcedRarity: 3, forcedSlot: 'accessory', forcedAxis: axis });
    const r800 = generateItem({ stage: 800, forcedRarity: 3, forcedSlot: 'accessory', forcedAxis: axis });
    // Same stage-independent ceiling and upgrade cost
    assert.ok(r800.mainStat.base <= 25 && r1.mainStat.base <= 25);
    assert.equal(getUpgradeCost(r1), getUpgradeCost(r800));
  }
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
  const acc = generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'accessory', forcedAxis: 'lightning' });

  const resCommon = partitionBulkSalvage([weakCommon, lockedCommon, highHpArmor], 'common', state.equipped);
  assert.equal(resCommon.salvagedCount, 1);
  assert.equal(resCommon.kept.length, 2);

  // 'weaker' must never salvage fixed-cap accessories or stronger armor
  const resWeaker = partitionBulkSalvage([highHpArmor, acc], 'weaker', state.equipped);
  assert.equal(resWeaker.salvagedCount, 0);
  assert.equal(resWeaker.kept.length, 2);
});

test('parseSaveState migrates legacy 3-slot wave-based save cleanly to 4 slots', () => {
  const legacyAcc = generateItem({ stage: 8, forcedRarity: 3, forcedSlot: 'accessory', forcedAxis: 'fire' });
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
  assert.deepEqual(SLOT_ORDER, ['weapon', 'armor', 'acc1', 'acc2']);
  assert.equal(migrated.equipped.weapon.slot, 'weapon');
  assert.equal(migrated.equipped.armor.slot, 'armor');
  assert.equal(migrated.equipped.acc1.slot, 'accessory');
  assert.equal(migrated.equipped.acc2.slot, 'accessory');
  assert.equal(migrated.equipped.acc1.id, legacyAcc.id);
  assert.equal(migrated.inventory[0].slot, 'accessory');
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

test('getEquipTierStage steps every 5 floors and stays balanced through 1000F across 4 slots', () => {
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
  const acc1 = generateItem({ stage: 1000, forcedRarity: 4, forcedSlot: 'accessory', forcedAxis: 'ice' });
  const acc2 = generateItem({ stage: 1000, forcedRarity: 4, forcedSlot: 'accessory', forcedAxis: 'dark' });
  const stats1000 = calcHeroStats(
    {
      weapon: w1000,
      armor: a1000,
      acc1,
      acc2,
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
  const baseStats: HeroStats = {
    atk: 1000,
    hp: 5000,
    critRate: 100,
    critDmg: 300,
    dmgPct: 0,
    armorPen: 0,
    rawArmorPen: 0,
    bossDmg: 0,
    multiHitRate: 0,
    comboId: 'ice+fire',
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
  const mythicLightning = generateItem({ stage: 100, forcedRarity: 4, forcedSlot: 'accessory', forcedAxis: 'lightning' });
  mythicLightning.level = 20;
  mythicLightning.subStats = [{ key: 'critRate', val: 30, boosts: 5 }];
  const withHighCrit: EquippedSet = {
    ...st.equipped,
    acc1: mythicLightning,
    acc2: { ...mythicLightning, id: 'm_lt_2' },
    weapon: { ...st.equipped.weapon, subStats: [{ key: 'critRate' as const, val: 25, boosts: 4 }] },
  };
  const pre100 = calcHeroStats(withHighCrit, false);
  const post100 = calcHeroStats(withHighCrit, true);
  assert.equal(pre100.critRate, 100);
  assert.ok(post100.critRate > 120 && post100.critRate <= 300);

  // Compare equal 40-roll Mythic+20 allocations deterministically:
  // crit-focused (lightning+lightning) should modestly lead over balanced, never 2x+
  const makeFullMythic = (
    rolls: { critRate: number; critDmg: number; atkPct: number; dmgPct: number },
    accAxes: [AccessoryAxis, AccessoryAxis] = ['lightning', 'fire'],
  ) => {
    const eq: EquippedSet = {
      weapon: generateItem({ stage: 100, forcedRarity: 4, forcedSlot: 'weapon' }),
      armor: generateItem({ stage: 100, forcedRarity: 4, forcedSlot: 'armor' }),
      acc1: generateItem({ stage: 100, forcedRarity: 4, forcedSlot: 'accessory', forcedAxis: accAxes[0] }),
      acc2: generateItem({ stage: 100, forcedRarity: 4, forcedSlot: 'accessory', forcedAxis: accAxes[1] }),
    };
    for (const slot of EQUIP_SLOT_ORDER) {
      eq[slot] = {
        ...eq[slot],
        rarity: 4,
        level: 20,
        stage: 100,
        mainStat: {
          ...eq[slot].mainStat,
          base:
            slot === 'weapon'
              ? 50000
              : slot === 'armor'
                ? 300000
                : slot === 'acc1'
                  ? ACCESSORY_AXES[accAxes[0]].base * 3.7
                  : ACCESSORY_AXES[accAxes[1]].base * 3.7,
        },
        subStats: [
          { key: 'critRate', val: +((rolls.critRate * 3.85) / 4).toFixed(1), boosts: 0 },
          { key: 'critDmg', val: +((rolls.critDmg * 6.2) / 4).toFixed(1), boosts: 0 },
          { key: 'atkPct', val: +((rolls.atkPct * 4.4) / 4).toFixed(1), boosts: 0 },
          { key: 'dmgPct', val: +((rolls.dmgPct * 3.95) / 4).toFixed(1), boosts: 0 },
        ],
      };
    }
    return calcHeroStats(eq, true);
  };
  const cap100 = makeFullMythic({ critRate: 3, critDmg: 12, atkPct: 12, dmgPct: 13 }, ['fire', 'fire']);
  const balanced = makeFullMythic({ critRate: 10, critDmg: 10, atkPct: 10, dmgPct: 10 }, ['lightning', 'fire']);
  const critMax = makeFullMythic({ critRate: 28, critDmg: 6, atkPct: 6, dmgPct: 0 }, ['lightning', 'lightning']);
  const vsBalanced = critMax.offlinePower / balanced.offlinePower;
  const vsCap100 = critMax.offlinePower / cap100.offlinePower;
  assert.ok(vsBalanced > 1.02 && vsBalanced < 1.55, `Expected modest crit lead vs balanced, got ${vsBalanced.toFixed(3)}`);
  assert.ok(vsCap100 > 1.1 && vsCap100 < 1.8, `Expected modest crit lead vs cap100, got ${vsCap100.toFixed(3)}`);
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
  const r1 = { ...generateItem({ stage: 4, forcedRarity: 1, forcedSlot: 'accessory', forcedAxis: 'lightning' }), id: 'r1' };
  const inventory = [w1, a1, w2, r1];

  // Weapon tab sorted by rarity: [w2, w1]
  const weaponTab = filterAndSortStorageItems(inventory, 'weapon', 'rarity');
  assert.deepEqual(
    weaponTab.map((i) => i.id),
    ['w2', 'w1'],
  );

  // Axis filter selects matching accessory only
  const lightningTab = filterAndSortStorageItems(inventory, 'lightning', 'rarity');
  assert.deepEqual(
    lightningTab.map((i) => i.id),
    ['r1'],
  );

  // Salvaging w2 advances to w1 (next weapon in weapon tab), never a1
  assert.equal(getNextSelectedStorageId(weaponTab, 'w2'), 'w1');

  // Salvaging the last weapon in the weapon tab yields null (never jumps to armor/acc)
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
  assert.ok(boss50.maxHp > boss49.maxHp * 1.8);
  assert.ok(boss50.atk > boss49.atk * 2);

  // Simulate deterministic combat: a hero who clears 49F loses blind on 50F,
  // while +20 upgraded Legend 49F-tier gear defeats 50F Great Boss
  const buildSet = (rarity: 1 | 3, level: number) => {
    const mkSub = () =>
      rarity === 3
        ? [
            { key: 'atkPct' as const, val: 12, boosts: 1 },
            { key: 'critRate' as const, val: 8, boosts: 1 },
            { key: 'armorPen' as const, val: 14, boosts: 1 },
            { key: 'bossDmg' as const, val: 16, boosts: 1 },
          ]
        : [
            { key: 'atkPct' as const, val: 5, boosts: 0 },
            { key: 'critRate' as const, val: 4, boosts: 0 },
          ];
    const eq: EquippedSet = {
      weapon: { ...generateItem({ stage: 49, forcedRarity: rarity, forcedSlot: 'weapon' }), level, subStats: mkSub() },
      armor: { ...generateItem({ stage: 49, forcedRarity: rarity, forcedSlot: 'armor' }), level, subStats: mkSub() },
      acc1: {
        ...generateItem({ stage: 49, forcedRarity: rarity, forcedSlot: 'accessory', forcedAxis: 'ice' }),
        level,
        subStats: mkSub(),
      },
      acc2: {
        ...generateItem({ stage: 49, forcedRarity: rarity, forcedSlot: 'accessory', forcedAxis: 'dark' }),
        level,
        subStats: mkSub(),
      },
    };
    return calcHeroStats(eq, false);
  };
  const simulateTurnsToKill = (stats: ReturnType<typeof calcHeroStats>, enemy: ReturnType<typeof createEnemy>) => {
    const nonCritHit = calcHitDamage(stats, enemy.defRate, true, 0, 1, 1);
    const critHit = calcHitDamage(stats, enemy.defRate, true, 1, 1, 1);
    const pCrit = Math.min(1, stats.critRate / 100);
    const avgHit = (nonCritHit * (1 - pCrit) + critHit * pCrit) * getExpectedMultiHitMultiplier(stats.multiHitRate, stats.comboId);
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
    const mkSub = () => [
      { key: 'atkPct' as const, val: 8 + Math.floor(level / 4) * 1.4, boosts: Math.floor(level / 16) },
      { key: 'critRate' as const, val: 8 + Math.floor(level / 4) * 1.3, boosts: Math.floor(level / 16) },
      { key: 'armorPen' as const, val: 10 + Math.floor(level / 4) * 1.4, boosts: Math.floor(level / 16) },
      { key: 'bossDmg' as const, val: 16 + Math.floor(level / 4) * 2.2, boosts: Math.floor(level / 16) },
    ];
    const eq: EquippedSet = {
      weapon: { ...generateItem({ stage: 149, forcedRarity: 4, forcedSlot: 'weapon' }), level, subStats: mkSub() },
      armor: { ...generateItem({ stage: 149, forcedRarity: 4, forcedSlot: 'armor' }), level, subStats: mkSub() },
      acc1: {
        ...generateItem({ stage: 149, forcedRarity: 4, forcedSlot: 'accessory', forcedAxis: 'ice' }),
        level,
        subStats: mkSub(),
      },
      acc2: {
        ...generateItem({ stage: 149, forcedRarity: 4, forcedSlot: 'accessory', forcedAxis: 'fire' }),
        level,
        subStats: mkSub(),
      },
    };
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
    const multiMult = getExpectedMultiHitMultiplier(stats.multiHitRate, stats.comboId);
    const dmgPerTurn =
      stats.atk * (1 + stats.dmgPct / 100) * (1 + stats.bossDmg / 100) * critMult * defMult * multiMult;
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

test('aspd is removed from SUB_POOL, multiHitRate is Ice-only, and legacy aspd/boots saves migrate cleanly', () => {
  assert.equal(
    SUB_POOL.some((s) => (s.key as string) === 'aspd' || (s.key as string) === 'multiHitRate'),
    false,
  );
  assert.equal(ACCESSORY_AXES.ice.mainType, 'multiHitRate');
  assert.equal(SLOTS.acc1.shortLabel, 'アクセ1');
  assert.equal(SLOTS.acc2.shortLabel, 'アクセ2');

  const iceAcc = generateItem({ stage: 5, forcedRarity: 2, forcedSlot: 'accessory', forcedAxis: 'ice' });
  assert.equal(iceAcc.mainStat.type, 'multiHitRate');

  const base = createDefaultState();
  const legacySave = JSON.stringify({
    ...base,
    equipped: {
      weapon: {
        ...base.equipped.weapon,
        subStats: [
          { key: 'dmgPct', val: 4.0, boosts: 0 },
          { key: 'aspd', val: 5.5, boosts: 0 },
        ],
      },
      armor: base.equipped.armor,
      boots: {
        ...iceAcc,
        id: 'legacy_boots',
        slot: 'boots',
        accAxis: undefined,
        rarity: 3,
        level: 10,
        mainStat: { type: 'aspd', base: 14, label: '攻撃速度', unit: '%' },
        subStats: [{ key: 'aspd', val: 6.5, boosts: 1 }],
      },
    },
  });
  const parsed = parseSaveState(legacySave);
  assert.ok(parsed !== null);
  assert.equal(parsed.equipped.acc1.id, 'legacy_boots');
  assert.equal(parsed.equipped.acc1.slot, 'accessory');
  assert.equal(parsed.equipped.acc1.accAxis, 'ice');
  assert.equal(parsed.equipped.acc1.mainStat.type, 'multiHitRate');
  assert.equal(parsed.equipped.acc1.subStats[0].key, 'dmgPct');
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

test('At 100% exploration without floor key, pickExplorationTarget patrols every room instead of circling stairs', () => {
  let seed = 42;
  const seededRng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  // 1) Pure patrol lap test: hero in stairs room with unstepped corner tiles around stairs
  const floor = generateMaze(25, 25, { stage: 3, monsterHouseChance: 0, rng: seededRng });
  const explored = new Set<string>(floor.depth.keys());
  const visitedRooms = new Set<number>(floor.rooms.map((r) => r.id));
  const stairsRoomId = floor.roomGrid[floor.stairs.y][floor.stairs.x];
  // Only hero's current tile stepped — plenty of unstepped tiles remain around the stairs!
  let hx = floor.stairs.x;
  let hy = floor.stairs.y;
  const stepped = new Set<string>([crawlKey(hx, hy)]);

  const patrolVisited = new Set<number>([stairsRoomId]);
  let patrolTargetRoomId: number | null = null;
  const visitedOrder: number[] = [stairsRoomId];
  let sawCycleReset = false;

  for (let step = 0; step < 300; step++) {
    const picked = pickExplorationTarget(
      floor.grid,
      hx,
      hy,
      0,
      explored,
      stepped,
      floor.stairs,
      [],
      seededRng,
      floor.roomGrid,
      floor.rooms,
      visitedRooms,
      {
        hasFloorKey: false,
        enemies: [],
        patrolVisitedRooms: patrolVisited,
        patrolTargetRoomId,
      },
    );
    assert.equal(picked.reason, 'patrol', '100% explored room floor without key must enter patrol mode');
    assert.ok(picked.patrolRoomId !== undefined);
    if (picked.patrolCycleReset) {
      sawCycleReset = true;
      break;
    }
    if (patrolTargetRoomId === null) {
      assert.notEqual(picked.patrolRoomId, stairsRoomId, 'Must leave stairs room instead of circling stairs');
    }
    patrolTargetRoomId = picked.patrolRoomId;

    const path = bfsPath(floor.grid, hx, hy, picked.target.x, picked.target.y);
    assert.ok(path && path.length >= 2, 'Patrol room target must be reachable');
    hx = path[1].x;
    hy = path[1].y;
    stepped.add(crawlKey(hx, hy));

    const rId = floor.roomGrid[hy][hx];
    if (rId >= 0) {
      if (!patrolVisited.has(rId)) {
        visitedOrder.push(rId);
      }
      patrolVisited.add(rId);
      if (patrolTargetRoomId === rId) {
        patrolTargetRoomId = null;
      }
    }
  }

  assert.equal(
    patrolVisited.size,
    floor.rooms.length,
    `Patrol lap must visit all ${floor.rooms.length} rooms, visited ${visitedOrder.join(',')}`,
  );
  assert.equal(sawCycleReset, true, 'Patrol must cleanly reset for another lap after visiting every room');

  // 2) Multi-floor simulation: roaming Key-Keeper is reliably encountered via room patrol
  for (let trial = 0; trial < 25; trial++) {
    const m = generateMaze(25, 25, { stage: 4 + trial, monsterHouseChance: 0, rng: seededRng });
    const allExplored = new Set<string>(m.depth.keys());
    const allVisited = new Set<number>(m.rooms.map((r) => r.id));
    const stRoomId = m.roomGrid[m.stairs.y][m.stairs.x];
    const otherRooms = m.rooms.filter((r) => r.id !== stRoomId);
    const keeperRoom = otherRooms[Math.floor(seededRng() * otherRooms.length)];
    const keeper = {
      id: 'boss_keykeeper',
      x: keeperRoom.cx,
      y: keeperRoom.cy,
      roomId: keeperRoom.id,
      awakened: false,
      prevCell: null,
      atkTimer: 0,
      shake: 0,
      flashTimer: 0,
      rareEscapeTimer: 6,
      enemy: createEnemy(4 + trial, true, -100),
    };

    let px = m.stairs.x;
    let py = m.stairs.y;
    const pStepped = new Set<string>([crawlKey(px, py)]);
    let pVisited = new Set<number>([stRoomId]);
    let pTarget: number | null = null;
    let foundKeeper = false;

    for (let turn = 1; turn <= 260; turn++) {
      const heroRoom = m.roomGrid[py][px];
      if (
        keeper.awakened ||
        (heroRoom >= 0 && heroRoom === keeper.roomId) ||
        Math.abs(px - keeper.x) + Math.abs(py - keeper.y) <= 1
      ) {
        foundKeeper = true;
        break;
      }

      const picked = pickExplorationTarget(
        m.grid,
        px,
        py,
        0,
        allExplored,
        pStepped,
        m.stairs,
        [],
        seededRng,
        m.roomGrid,
        m.rooms,
        allVisited,
        {
          hasFloorKey: false,
          enemies: [keeper],
          patrolVisitedRooms: pVisited,
          patrolTargetRoomId: pTarget,
        },
      );
      if (picked.patrolCycleReset) {
        pVisited = new Set<number>(heroRoom >= 0 ? [heroRoom] : []);
      }
      pTarget = picked.patrolRoomId ?? null;

      const path = bfsPath(m.grid, px, py, picked.target.x, picked.target.y);
      assert.ok(path && path.length >= 2);
      px = path[1].x;
      py = path[1].y;
      pStepped.add(crawlKey(px, py));

      const enteredRoom = m.roomGrid[py][px];
      if (enteredRoom >= 0) {
        pVisited.add(enteredRoom);
        if (pTarget === enteredRoom) pTarget = null;
      }

      stepEnemiesTowardHero(m.grid, m.roomGrid, { x: px, y: py }, m.stairs, [keeper], turn, seededRng);
    }

    assert.equal(foundKeeper, true, `Trial ${trial}: room patrol must encounter roaming Key-Keeper`);
  }
});

test('Step 1: turn-based mob pacing achieves 4-6T on fresh tier, 2-3T on upgraded tier, and 1T on past floors', () => {
  const buildDeterministicSet = (stage: number, rarity: 1 | 2, level: number) => {
    const tierStage = getEquipTierStage(stage);
    const rMult = RARITIES[rarity].mainMult;
    const mkSub = () => [
      { key: 'atkPct' as const, val: rarity === 2 ? 7 : 4, boosts: 0 },
      { key: 'critRate' as const, val: rarity === 2 ? 5 : 3, boosts: 0 },
    ];
    const weapon = generateItem({ stage, forcedRarity: rarity, forcedSlot: 'weapon' });
    weapon.mainStat.base = Math.round(9 * Math.pow(1.14, tierStage - 1) * rMult);
    weapon.level = level;
    weapon.subStats = mkSub();

    const armor = generateItem({ stage, forcedRarity: rarity, forcedSlot: 'armor' });
    armor.mainStat.base = Math.round(55 * Math.pow(1.14, tierStage - 1) * rMult);
    armor.level = level;
    armor.subStats = mkSub();

    const acc1 = generateItem({ stage, forcedRarity: rarity, forcedSlot: 'accessory', forcedAxis: 'ice' });
    acc1.mainStat.base = +(ACCESSORY_AXES.ice.base * rMult).toFixed(1);
    acc1.level = level;
    acc1.subStats = mkSub();

    const acc2 = generateItem({ stage, forcedRarity: rarity, forcedSlot: 'accessory', forcedAxis: 'fire' });
    acc2.mainStat.base = +(ACCESSORY_AXES.fire.base * rMult).toFixed(1);
    acc2.level = level;
    acc2.subStats = mkSub();

    return calcHeroStats({ weapon, armor, acc1, acc2 }, false);
  };

  const calcExpectedTurns = (stats: ReturnType<typeof calcHeroStats>, enemy: ReturnType<typeof createEnemy>) => {
    const nonCrit = calcHitDamage(stats, enemy.defRate, enemy.isBoss, 0, 1, 1);
    const crit = calcHitDamage(stats, enemy.defRate, enemy.isBoss, 1, 1, 1);
    const pCrit = Math.min(1, stats.critRate / 100);
    const avgTurnDmg =
      (nonCrit * (1 - pCrit) + crit * pCrit) * getExpectedMultiHitMultiplier(stats.multiHitRate, stats.comboId);
    return enemy.maxHp / Math.max(1, avgTurnDmg);
  };

  // Freshly arrived at 6F wearing previous 1F-tier Rare+10 gear -> 4-6 turns
  const freshSt6Hero = buildDeterministicSet(1, 1, 10);
  const mob6 = createEnemy(6, false, -100, 'normal');
  const freshTtk6 = calcExpectedTurns(freshSt6Hero, mob6);
  assert.ok(
    freshTtk6 >= 3.5 && freshTtk6 <= 6.8,
    `Expected fresh 6F mob TTK around 4-6 turns, got ${freshTtk6.toFixed(2)}`,
  );

  // Freshly arrived at 26F wearing previous 21F-tier Epic+6 gear -> 4-6 turns
  const freshSt26Hero = buildDeterministicSet(21, 2, 6);
  const mob26 = createEnemy(26, false, -100, 'normal');
  const freshTtk26 = calcExpectedTurns(freshSt26Hero, mob26);
  assert.ok(
    freshTtk26 >= 3.8 && freshTtk26 <= 6.8,
    `Expected fresh 26F mob TTK around 4-6 turns, got ${freshTtk26.toFixed(2)}`,
  );

  // Updated 6F Rare+10 gear vs 6F mob -> 2-3 turns
  const upgradedSt6Hero = buildDeterministicSet(6, 1, 10);
  const upgradedTtk6 = calcExpectedTurns(upgradedSt6Hero, mob6);
  assert.ok(
    upgradedTtk6 >= 1.8 && upgradedTtk6 <= 3.5,
    `Expected upgraded 6F mob TTK around 2-3 turns, got ${upgradedTtk6.toFixed(2)}`,
  );

  // Revisiting 1F with 6F Rare+10 gear -> 1-turn sweep!
  const mob1 = createEnemy(1, false, -100, 'normal');
  const sweepTtk1 = calcExpectedTurns(upgradedSt6Hero, mob1);
  assert.ok(sweepTtk1 <= 1.25, `Expected 1-turn sweep on 1F with 6F gear, got ${sweepTtk1.toFixed(2)}`);
});

test('Step 1: mob archetypes (normal/armored/striker) apply from stage 3+ with distinct DEF/HP/ATK profiles', () => {
  assert.equal(rollMobArchetype(1, () => 0.99), 'normal');
  assert.equal(rollMobArchetype(2, () => 0.99), 'normal');
  assert.equal(rollMobArchetype(3, () => 0.2), 'normal');
  assert.equal(rollMobArchetype(3, () => 0.6), 'armored');
  assert.equal(rollMobArchetype(3, () => 0.9), 'striker');

  const normal = createEnemy(12, false, -100, 'normal');
  const armored = createEnemy(12, false, -100, 'armored');
  const striker = createEnemy(12, false, -100, 'striker');

  assert.equal(normal.archetype, 'normal');
  assert.equal(armored.archetype, 'armored');
  assert.equal(striker.archetype, 'striker');
  assert.ok(armored.name.includes('[重装]'));
  assert.ok(striker.name.includes('[強襲]'));
  assert.ok(armored.defRate > normal.defRate + 0.18);
  assert.ok(armored.maxHp > normal.maxHp);
  assert.ok(armored.atk < normal.atk);
  assert.ok(striker.atk > normal.atk * 1.2);
  assert.ok(striker.maxHp < normal.maxHp * 0.85);
});

test('Step 1: parseSaveState migrates temporary 3-party saves back to 1-hero without losing upgraded weapons/armors', () => {
  const base = createDefaultState();
  const warriorWep = { ...generateItem({ stage: 12, forcedRarity: 2, forcedSlot: 'weapon' }), level: 8 };
  const mageWep = { ...generateItem({ stage: 18, forcedRarity: 3, forcedSlot: 'weapon' }), level: 12 };
  const clericArmor = { ...generateItem({ stage: 15, forcedRarity: 3, forcedSlot: 'armor' }), level: 10 };

  const partySave = JSON.stringify({
    ...base,
    stage: 18,
    maxStage: 20,
    equipped: {
      ...base.equipped,
      weapon: warriorWep,
    },
    party: {
      activeIds: ['warrior', 'mage', 'cleric'],
      roster: {
        warrior: { equipment: { weapon: warriorWep, armor: base.equipped.armor } },
        mage: { equipment: { weapon: mageWep, armor: base.equipped.armor } },
        cleric: { equipment: { weapon: base.equipped.weapon, armor: clericArmor } },
      },
    },
    inventory: [],
    stash: [],
  });

  const parsed = parseSaveState(partySave);
  assert.ok(parsed !== null);
  // Keeps strongest weapon (mageWep) and strongest armor (clericArmor) equipped
  assert.equal(parsed.equipped.weapon.id, mageWep.id);
  assert.equal(parsed.equipped.armor.id, clericArmor.id);
  // Rescues warrior's upgraded weapon safely into inventory instead of deleting it
  assert.ok(
    parsed.inventory.some((it) => it.id === warriorWep.id),
    'Warrior upgraded weapon must be preserved in bag during 3-party->1-hero migration',
  );
});

test('Step 2: equipment synthesis upgrades 9 same-rarity items to +1 rarity at maxStage with proportional slot lottery and 60% stone refund', () => {
  assert.equal(SYNTHESIS_MATERIAL_COUNT, 9);
  assert.equal(MYTHIC_REFORGE_COUNT, 3);
  assert.equal(SYNTHESIS_STONE_REFUND_RATE, 0.6);

  const st = createDefaultState();
  st.stage = 5;
  st.maxStage = 26;
  st.stones = 100;

  // 9 unlocked Common weapons (some upgraded) + 1 locked Common weapon + 1 Common in stash
  const mats = Array.from({ length: 9 }, (_, i) => ({
    ...generateItem({ stage: 2, forcedRarity: 0, forcedSlot: 'weapon' }),
    id: `c_wep_${i}`,
    level: i === 0 ? 4 : 0,
    spentStones: i === 0 ? 150 : 0,
  }));
  const lockedCommon = {
    ...generateItem({ stage: 2, forcedRarity: 0, forcedSlot: 'weapon' }),
    id: 'c_locked',
    locked: true,
  };
  const stashCommon = {
    ...generateItem({ stage: 2, forcedRarity: 0, forcedSlot: 'weapon' }),
    id: 'c_stash',
  };
  st.inventory = [...mats, lockedCommon];
  st.stash = [stashCommon];

  // Eligible candidates strictly exclude locked and stash items, and sort lowest level first
  const eligible = getEligibleSynthesisCandidates(st.inventory, 0, 'all');
  assert.equal(eligible.length, 9);
  assert.equal(eligible.some((i) => i.id === 'c_locked'), false);
  assert.equal(eligible.some((i) => i.id === 'c_stash'), false);
  assert.equal(eligible[eligible.length - 1].id, 'c_wep_0'); // Lv+4 item sorted last for auto-fill safety
  assert.equal(countReadySynthesisRecipes(st.inventory, false), 1);

  // Preview computes 100% weapon + 60% stone refund (floor(150 * 0.6) = 90)
  const preview = computeSynthesisPreview(mats);
  assert.equal(preview.refundStones, 90);
  assert.equal(preview.slotProbabilities.length, 1);
  assert.equal(preview.slotProbabilities[0].slot, 'weapon');
  assert.equal(preview.slotProbabilities[0].pct, 100);

  // Attempting to include a locked item fails cleanly
  const badLocked = executeSynthesis(st, 0, [...mats.slice(0, 8).map((m) => m.id), 'c_locked']);
  assert.equal(badLocked.ok, false);

  // Valid 9-weapon Common synthesis -> 100% Rare weapon at maxStage (26) + 90 stones refunded
  const res = executeSynthesis(st, 0, mats.map((m) => m.id), () => 0.5);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.resultItem.rarity, 1);
    assert.equal(res.resultItem.slot, 'weapon');
    assert.equal(res.resultItem.stage, 26);
    assert.equal(res.refundStones, 90);
  }
  assert.equal(st.stones, 190);
  // 9 consumed + 1 added + 1 locked kept = 2 items in bag
  assert.equal(st.inventory.length, 2);
  assert.ok(st.inventory.some((i) => i.id === 'c_locked'));
  assert.equal(st.stash.length, 1);
});

test('Step 2: mixed-slot synthesis weights by input ratio, and cleared100 gates Legend->Mythic and Mythic x3 re-forge', () => {
  const st = createDefaultState();
  st.maxStage = 120;
  st.cleared100 = false;

  assert.equal(isSynthesisRecipeUnlocked(0, false), true);
  assert.equal(isSynthesisRecipeUnlocked(2, false), true);
  assert.equal(isSynthesisRecipeUnlocked(3, false), false);
  assert.equal(isSynthesisRecipeUnlocked(4, false), false);
  assert.equal(isSynthesisRecipeUnlocked(3, true), true);
  assert.equal(isSynthesisRecipeUnlocked(4, true), true);

  // 6 Legend weapons + 3 Legend armors -> 67% weapon / 33% armor
  const legends = [
    ...Array.from({ length: 6 }, (_, i) => ({
      ...generateItem({ stage: 80, forcedRarity: 3, forcedSlot: 'weapon' }),
      id: `l_w_${i}`,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      ...generateItem({ stage: 80, forcedRarity: 3, forcedSlot: 'armor' }),
      id: `l_a_${i}`,
    })),
  ];
  st.inventory = [...legends];

  // Blocked before cleared100
  const blocked = executeSynthesis(st, 3, legends.map((m) => m.id));
  assert.equal(blocked.ok, false);

  // Unlocked after cleared100; rng=0.8 picks index 7 (armor), rng=0.1 picks index 0 (weapon)
  st.cleared100 = true;
  const preview = computeSynthesisPreview(legends);
  assert.equal(preview.slotProbabilities[0].slot, 'weapon');
  assert.equal(preview.slotProbabilities[0].pct, 67);
  assert.equal(preview.slotProbabilities[1].slot, 'armor');
  assert.equal(preview.slotProbabilities[1].pct, 33);

  const mythicRes = executeSynthesis(st, 3, legends.map((m) => m.id), () => 0.8);
  assert.equal(mythicRes.ok, true);
  if (mythicRes.ok) {
    assert.equal(mythicRes.resultItem.rarity, 4);
    assert.equal(mythicRes.resultItem.slot, 'armor');
    assert.equal(mythicRes.resultItem.stage, 120);
  }

  // Mythic x3 re-forge (requires exactly 3 Mythic items + cleared100)
  const mythics = Array.from({ length: 3 }, (_, i) => ({
    ...generateItem({ stage: 110, forcedRarity: 4, forcedSlot: 'accessory', forcedAxis: 'lightning' }),
    id: `m_r_${i}`,
    spentStones: 500,
  }));
  st.inventory = [...mythics];
  st.stones = 0;

  const reforgeRes = executeSynthesis(st, 4, mythics.map((m) => m.id), () => 0.2);
  assert.equal(reforgeRes.ok, true);
  if (reforgeRes.ok) {
    assert.equal(reforgeRes.recipe.isMythicReforge, true);
    assert.equal(reforgeRes.resultItem.rarity, 4);
    assert.equal(reforgeRes.resultItem.slot, 'accessory');
    assert.equal(reforgeRes.resultItem.accAxis, 'lightning');
    assert.equal(reforgeRes.refundStones, 900); // floor(1500 * 0.6)
  }
  assert.equal(st.stones, 900);
  assert.equal(st.inventory.length, 1);
});

test('Step 3: multi-hit rate scaling, cap at 5 total hits, and pure Ice 3rd+ hit bonus', () => {
  assert.equal(FOLLOW_UP_DAMAGE_RATIO, 0.55);
  assert.equal(ICE_PURE_THIRD_HIT_RATIO, 0.63);
  assert.equal(MAX_EXTRA_MULTI_HITS, 4);

  assert.equal(rollExtraHits(0, () => 0.0), 0);
  assert.equal(rollExtraHits(50, () => 0.49), 1);
  assert.equal(rollExtraHits(50, () => 0.51), 0);
  assert.equal(rollExtraHits(100, () => 0.99), 1);
  assert.equal(rollExtraHits(150, () => 0.49), 2);
  assert.equal(rollExtraHits(150, () => 0.51), 1);
  assert.equal(rollExtraHits(250, () => 0.49), 3);
  // Capped at MAX_EXTRA_MULTI_HITS (4 extra = 5 total hits/turn)
  assert.equal(rollExtraHits(550, () => 0.0), 4);

  // Pure ice+ice boosts 3rd+ hits from 0.55 to 0.63
  const baseStats: HeroStats = {
    atk: 1000,
    hp: 5000,
    critRate: 0,
    critDmg: 200,
    dmgPct: 0,
    armorPen: 0,
    rawArmorPen: 0,
    bossDmg: 0,
    multiHitRate: 200, // guaranteed 3 hits
    comboId: 'ice+ice',
    mythicCount: 0,
    offlinePower: 0,
  };
  const dummyMob = { hp: 50000, maxHp: 50000, defRate: 0, isBoss: false, archetype: 'normal' as const };
  const icePlan = resolveTurnAttackPlan(baseStats, dummyMob, false, () => 0.99, 1.0);
  assert.equal(icePlan.hits.length, 3);
  assert.equal(icePlan.hits[0].dmg, 1000);
  assert.equal(icePlan.hits[1].dmg, 550);
  assert.equal(icePlan.hits[2].dmg, 630);
});

test('Step 3: all 10 Resonance Combos are order-independent, have unique 3D VFX styles, and apply distinct effects', () => {
  const seenIds = new Set<AccessoryComboId>();
  const slashStyles = new Set<string>();

  for (const a of ACCESSORY_AXIS_ORDER as AccessoryAxis[]) {
    for (const b of ACCESSORY_AXIS_ORDER as AccessoryAxis[]) {
      const idAB = getAccessoryComboId(a, b);
      const idBA = getAccessoryComboId(b, a);
      assert.equal(idAB, idBA, `Combo ID must be symmetric for (${a}, ${b})`);
      seenIds.add(idAB);
    }
  }
  assert.equal(seenIds.size, 10, '4 axes with replacement must yield exactly 10 unique combos');

  for (const id of seenIds) {
    const def = ACCESSORY_COMBOS[id];
    assert.ok(def, `Missing combo definition for ${id}`);
    slashStyles.add(def.vfx.slashStyle);
  }
  assert.equal(slashStyles.size, 10, 'Every Resonance Combo must have its own distinct 3D slashStyle');

  const mkStats = (comboId: AccessoryComboId, overrides: Partial<HeroStats> = {}): HeroStats => ({
    atk: 1000,
    hp: 5000,
    critRate: 0,
    critDmg: 200,
    dmgPct: 0,
    armorPen: 0,
    rawArmorPen: 0,
    bossDmg: 0,
    multiHitRate: 0,
    comboId,
    mythicCount: 0,
    offlinePower: 0,
    ...overrides,
  });

  // 1. fire+fire: +12% dmg vs enemy >= 60% HP, normal below 60%
  const highHpEnemy = { hp: 800, maxHp: 1000, defRate: 0, isBoss: false, archetype: 'normal' as const };
  const lowHpEnemy = { hp: 500, maxHp: 1000, defRate: 0, isBoss: false, archetype: 'normal' as const };
  assert.equal(resolveTurnAttackPlan(mkStats('fire+fire'), highHpEnemy, false, () => 0.99, 1.0).totalDmg, 1120);
  assert.equal(resolveTurnAttackPlan(mkStats('fire+fire'), lowHpEnemy, false, () => 0.99, 1.0).totalDmg, 1000);

  // 2. lightning+lightning: +22% critDmg in calcHeroStats
  const st = createDefaultState();
  const lt1 = generateItem({ stage: 10, forcedRarity: 2, forcedSlot: 'accessory', forcedAxis: 'lightning' });
  const lt2 = generateItem({ stage: 10, forcedRarity: 2, forcedSlot: 'accessory', forcedAxis: 'lightning' });
  lt1.subStats = [];
  lt2.subStats = [];
  const ltStats = calcHeroStats(
    {
      weapon: { ...st.equipped.weapon, subStats: [] },
      armor: { ...st.equipped.armor, subStats: [] },
      acc1: lt1,
      acc2: lt2,
    },
    false,
  );
  assert.equal(ltStats.comboId, 'lightning+lightning');
  assert.equal(ltStats.critDmg, 172); // 150 base + 22 pure lightning combo

  // 3. dark+dark: excess armorPen > 100% converts 35% to heavy/boss dmg (capped +40%)
  const armoredMob = { hp: 5000, maxHp: 5000, defRate: 0.4, isBoss: false, archetype: 'armored' as const };
  const darkPlan = resolveTurnAttackPlan(
    mkStats('dark+dark', { armorPen: 100, rawArmorPen: 140 }),
    armoredMob,
    false,
    () => 0.99,
    1.0,
  );
  // Excess = 40 -> +14% dmg vs armored, defRate fully ignored by 100% pen -> 1140
  assert.equal(darkPlan.totalDmg, 1140);

  // 4. ice+fire: final hit of multi-hit +15%
  const iceFirePlan = resolveTurnAttackPlan(
    mkStats('ice+fire', { multiHitRate: 100 }),
    highHpEnemy,
    false,
    () => 0.99,
    1.0,
  );
  assert.equal(iceFirePlan.hits.length, 2);
  assert.equal(iceFirePlan.hits[0].dmg, 1000);
  assert.equal(iceFirePlan.hits[1].dmg, Math.round(1000 * 0.55 * 1.15)); // 633

  // 5. ice+lightning: follow-up hits gain +10% critRate
  const iceLtPlan = resolveTurnAttackPlan(
    mkStats('ice+lightning', { multiHitRate: 100, critRate: 90 }),
    highHpEnemy,
    false,
    () => 0.95, // fails 90% on hit 1, succeeds 100% on hit 2
    1.0,
  );
  assert.equal(iceLtPlan.hits[0].critTier, 0);
  assert.equal(iceLtPlan.hits[1].critTier, 1);

  // 6. ice+dark: 2nd+ hits gain +12% armorPen
  const iceDarkPlan = resolveTurnAttackPlan(
    mkStats('ice+dark', { multiHitRate: 100, armorPen: 20 }),
    armoredMob,
    false,
    () => 0.99,
    1.0,
  );
  assert.equal(iceDarkPlan.hits[0].effectiveArmorPen, 20);
  assert.equal(iceDarkPlan.hits[1].effectiveArmorPen, 32);

  // 7. fire+lightning: crit hits gain +8% dmg
  const fireLtPlan = resolveTurnAttackPlan(
    mkStats('fire+lightning', { critRate: 100, critDmg: 200 }),
    highHpEnemy,
    false,
    () => 0.1,
    1.0,
  );
  assert.equal(fireLtPlan.hits[0].dmg, 2160); // 1000 * 2.0 * 1.08

  // 8. fire+dark: +10% dmg vs heavy/boss
  const fireDarkPlan = resolveTurnAttackPlan(mkStats('fire+dark'), armoredMob, false, () => 0.99, 1.0);
  assert.equal(fireDarkPlan.hits[0].dmg, 660); // 1000 * 1.1 * (1 - 0.4)

  // 9. lightning+dark: crit hits gain +12% armorPen
  const ltDarkPlan = resolveTurnAttackPlan(
    mkStats('lightning+dark', { critRate: 100, armorPen: 30 }),
    armoredMob,
    false,
    () => 0.1,
    1.0,
  );
  assert.equal(ltDarkPlan.hits[0].effectiveArmorPen, 42);

  // 10. getAccessoryCombo resolves from items directly
  const comboFromItems = getAccessoryCombo(
    generateItem({ stage: 1, forcedSlot: 'accessory', forcedAxis: 'dark' }),
    generateItem({ stage: 1, forcedSlot: 'accessory', forcedAxis: 'ice' }),
  );
  assert.equal(comboFromItems.id, 'ice+dark');
});

test('Step 3: synthesis preserves accessory axis ratios proportionally', () => {
  const ice6 = Array.from({ length: 6 }, (_, i) => ({
    ...generateItem({ stage: 10, forcedRarity: 1, forcedSlot: 'accessory', forcedAxis: 'ice' }),
    id: `syn_ice_${i}`,
  }));
  const fire3 = Array.from({ length: 3 }, (_, i) => ({
    ...generateItem({ stage: 10, forcedRarity: 1, forcedSlot: 'accessory', forcedAxis: 'fire' }),
    id: `syn_fire_${i}`,
  }));
  const mixed = [...ice6, ...fire3];
  const preview = computeSynthesisPreview(mixed);
  assert.equal(preview.slotProbabilities.length, 2);
  assert.equal(preview.slotProbabilities[0].accAxis, 'ice');
  assert.equal(preview.slotProbabilities[0].pct, 67);
  assert.equal(preview.slotProbabilities[1].accAxis, 'fire');
  assert.equal(preview.slotProbabilities[1].pct, 33);

  assert.deepEqual(pickWeightedOutcomeFromMaterials(mixed, () => 0.1), { slot: 'accessory', accAxis: 'ice' });
  assert.deepEqual(pickWeightedOutcomeFromMaterials(mixed, () => 0.8), { slot: 'accessory', accAxis: 'fire' });
});

test('Step 3: parseSaveState performs lossless 6-slot to 4-slot migration (top 2 equipped, extras to bag/stash)', () => {
  const base = createDefaultState();
  const makeLegacySlot = (id: string, legacySlot: string, rarity: 0 | 1 | 2 | 3 | 4, level: number, spentStones: number) => ({
    id,
    name: `旧${legacySlot}`,
    slot: legacySlot,
    rarity,
    level,
    stage: 30,
    icon: '💍',
    mainStat: { type: 'critRate', base: 10, label: '会心率', unit: '%' },
    subStats: [{ key: 'atkPct', val: 5, boosts: 0 }],
    locked: false,
    spentStones,
  });

  // 4 legacy accessories with distinct power rankings:
  // gauntlets (R4, Lv20) -> dark (#1)
  // ring      (R3, Lv15) -> lightning (#2)
  // necklace  (R2, Lv10) -> fire (rescued to bag)
  // boots     (R1, Lv5)  -> ice  (overflows bag -> rescued to stash!)
  const fullBag59 = Array.from({ length: 59 }, (_, i) => ({
    ...generateItem({ stage: 10, forcedSlot: 'weapon' }),
    id: `bag_fill_${i}`,
  }));

  const legacy6SlotSave = JSON.stringify({
    ...base,
    stage: 35,
    maxStage: 35,
    equipped: {
      weapon: base.equipped.weapon,
      armor: base.equipped.armor,
      ring: makeLegacySlot('old_ring', 'ring', 3, 15, 400),
      necklace: makeLegacySlot('old_neck', 'necklace', 2, 10, 200),
      gauntlets: makeLegacySlot('old_gaunt', 'gauntlets', 4, 20, 900),
      boots: makeLegacySlot('old_boots', 'boots', 1, 5, 50),
    },
    inventory: fullBag59,
    stash: [],
  });

  const migrated = parseSaveState(legacy6SlotSave);
  assert.ok(migrated !== null);

  // Top 2 highest-value accessories equipped into acc1 & acc2
  assert.equal(migrated.equipped.acc1.id, 'old_gaunt');
  assert.equal(migrated.equipped.acc1.accAxis, 'dark');
  assert.equal(migrated.equipped.acc2.id, 'old_ring');
  assert.equal(migrated.equipped.acc2.accAxis, 'lightning');

  // Both rescued accessories are placed at the front of the bag, and the 1 overflow bag item moves safely into stash (61 total items, zero loss!)
  assert.equal(migrated.inventory.length, MAX_BAG_SIZE);
  assert.equal(migrated.stash.length, 1);
  const allPreserved = [...migrated.inventory, ...migrated.stash];
  assert.equal(allPreserved.length, 61);
  assert.ok(migrated.inventory.some((it) => it.id === 'old_neck' && it.accAxis === 'fire'));
  assert.ok(migrated.inventory.some((it) => it.id === 'old_boots' && it.accAxis === 'ice'));
  assert.ok(migrated.stash.some((it) => it.id === 'bag_fill_58'));
});












