import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHEST_BATCH_MAX,
  MAX_BAG_SIZE,
  MAX_EQUIP_LEVEL,
  MAX_STASH_SIZE,
  RARITIES,
  SLOT_ORDER,
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
  formatStatDiff,
  formatUpgradeMessage,
  generateItem,
  getEquipTierStage,
  getMainStatVal,
  getSalvageValue,
  getUpgradeCost,
  partitionBulkSalvage,
  rollSubstatMilestone,
} from './items';
import {
  bfsPath,
  crawlKey,
  createEnemy,
  generateMaze,
  pickEncounterAheadCell,
  pickExplorationTarget,
  placeMazeEvents,
  shouldTriggerRandomEncounter,
} from './maze';
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

test('All rarities have Lv20 cap, +4 intervals, and Legend/Mythic guarantee 4 initial substats', () => {
  assert.equal(MAX_EQUIP_LEVEL, 20);
  assert.equal(SUBSTAT_STEP_INTERVAL, 4);
  assert.ok(RARITIES.every((r) => r.maxLv === 20));

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

test('calcHeroStats & calcHitDamage handle dmgPct, bossDmg, armorPen, and mythic follow-up hits', () => {
  const baseState = createDefaultState();
  const mythicWeapon = generateItem({ stage: 10, forcedRarity: 4, forcedSlot: 'weapon' });
  const withMythic = { ...baseState.equipped, weapon: mythicWeapon };
  const mythicStats = calcHeroStats(withMythic, true);
  assert.equal(mythicStats.mythicCount, 1);

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
  const path = bfsPath(maze.grid, 1, 1, maze.stairs.x, maze.stairs.y);
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

  const res = pickExplorationTarget(grid, 2, 1, 0, explored, stepped, stairs, [], () => 0.2);
  assert.equal(res.reason, 'explore');
  assert.notDeepEqual(res.target, stairs);
  const path = bfsPath(grid, 2, 1, res.target.x, res.target.y);
  assert.ok(path && path.length >= 2);
  assert.notEqual(path[1].x, 1);

  explored.add(crawlKey(stairs.x, stairs.y));
  const foundStairs = pickExplorationTarget(grid, 2, 1, 0, explored, stepped, stairs, [], () => 0.2);
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
    aspd: 2.0,
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
  assert.ok(vsBalanced > 1.05 && vsBalanced < 1.30, `Expected modest crit lead vs balanced, got ${vsBalanced.toFixed(3)}`);
  assert.ok(vsCap100 > 1.15 && vsCap100 < 1.40, `Expected modest crit lead vs cap100, got ${vsCap100.toFixed(3)}`);
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
