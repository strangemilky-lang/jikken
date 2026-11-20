import { PERSONAL_SLOTS, SHARED_ARTIFACT_SLOTS, SLOTS } from './constants';
import { calcHeroStats, clamp, generateItem, getMainStatVal } from './items';
import type {
  EquippedSet,
  GameState,
  HeroStats,
  Item,
  JobId,
  PartyMemberState,
  PartyState,
  SlotKey,
} from './types';

export const MAX_SKILL_LEVEL = 5;

export interface SkillDef {
  id: string;
  name: string;
  icon: string;
  kind: 'active' | 'passive';
  cd?: number;
  maxLevel: number;
  summary: (lv: number) => string;
}

export interface JobDef {
  id: JobId;
  name: string;
  jobName: string;
  icon: string;
  roleLabel: string;
  accentColor: string;
  defaultUnlocked: boolean;
  unlockStage: number;
  recruitStoneCost: number;
  atkMult: number;
  hpMult: number;
  critOffset: number;
  threatWeight: number;
  activeSkillCd: number;
  skills: [SkillDef, SkillDef, SkillDef];
}

export const JOB_ORDER: JobId[] = ['warrior', 'mage', 'cleric', 'ranger', 'assassin'];

export const JOB_DEFS: Record<JobId, JobDef> = {
  warrior: {
    id: 'warrior',
    name: 'アレス',
    jobName: '戦士',
    icon: '🛡️',
    roleLabel: '前衛・盾＆反撃',
    accentColor: '#f59e0b',
    defaultUnlocked: true,
    unlockStage: 1,
    recruitStoneCost: 0,
    atkMult: 0.52,
    hpMult: 1.28,
    critOffset: -2,
    threatWeight: 2.9,
    activeSkillCd: 3,
    skills: [
      {
        id: 'warrior_bash',
        name: 'ガードバッシュ',
        icon: '⚔️',
        kind: 'active',
        cd: 3,
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `3T毎: ${140 + lv * 22}%重撃＋自身に被ダメ${25 + lv * 6}%軽減シールド`,
      },
      {
        id: 'warrior_fortress',
        name: '不動の構え',
        icon: '🏰',
        kind: 'passive',
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `最大HP+${lv * 14}%・常時被ダメ-${lv * 4}%・かばう率UP`,
      },
      {
        id: 'warrior_counter',
        name: '反撃の闘志',
        icon: '🔥',
        kind: 'passive',
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `被弾時 ${lv > 0 ? 18 + lv * 10 : 0}% で攻撃力${90 + lv * 15}%の反撃斬撃`,
      },
    ],
  },
  mage: {
    id: 'mage',
    name: 'リナ',
    jobName: '魔導士',
    icon: '🔥',
    roleLabel: '後衛・範囲火力',
    accentColor: '#38bdf8',
    defaultUnlocked: true,
    unlockStage: 1,
    recruitStoneCost: 0,
    atkMult: 0.64,
    hpMult: 0.76,
    critOffset: 2,
    threatWeight: 0.8,
    activeSkillCd: 4,
    skills: [
      {
        id: 'mage_storm',
        name: 'ファイアストーム',
        icon: '☄️',
        kind: 'active',
        cd: 4,
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `4T毎: 同室/隣接の敵全員へ ${120 + lv * 22}%範囲魔法（単体時は+25%）`,
      },
      {
        id: 'mage_amp',
        name: '魔力増幅',
        icon: '✨',
        kind: 'passive',
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `攻撃力+${lv * 9}%・スキル威力+${lv * 12}%`,
      },
      {
        id: 'mage_pierce',
        name: '元素貫通',
        icon: '💠',
        kind: 'passive',
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `防御貫通+${lv * 6}%・与ダメージ+${lv * 5}%`,
      },
    ],
  },
  cleric: {
    id: 'cleric',
    name: 'セラ',
    jobName: '僧侶',
    icon: '✨',
    roleLabel: '後衛・回復＆支援',
    accentColor: '#4ade80',
    defaultUnlocked: true,
    unlockStage: 1,
    recruitStoneCost: 0,
    atkMult: 0.44,
    hpMult: 0.90,
    critOffset: 0,
    threatWeight: 0.9,
    activeSkillCd: 3,
    skills: [
      {
        id: 'cleric_heal',
        name: '聖なる癒やし',
        icon: '💚',
        kind: 'active',
        cd: 3,
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `3T毎: HP減の味方を ${24 + lv * 6}%回復（満タン時は聖光${120 + lv * 18}%攻撃）`,
      },
      {
        id: 'cleric_aura',
        name: '祝福のオーラ',
        icon: '🌟',
        kind: 'passive',
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `味方全員の会心率+${lv * 4}%・会心ダメ+${lv * 9}%`,
      },
      {
        id: 'cleric_prayer',
        name: '慈愛の祈り',
        icon: '🕊️',
        kind: 'passive',
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `回復量+${lv * 16}%・戦闘勝利時の全体HP回復+${lv * 3}%`,
      },
    ],
  },
  ranger: {
    id: 'ranger',
    name: 'カイト',
    jobName: '狩人',
    icon: '🏹',
    roleLabel: '中衛・連撃＆トレハン',
    accentColor: '#a3e635',
    defaultUnlocked: false,
    unlockStage: 3,
    recruitStoneCost: 20,
    atkMult: 0.58,
    hpMult: 0.90,
    critOffset: 6,
    threatWeight: 1.0,
    activeSkillCd: 3,
    skills: [
      {
        id: 'ranger_multi',
        name: 'マルチショット',
        icon: '🏹',
        kind: 'active',
        cd: 3,
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `3T毎: ${lv >= 3 ? 3 : 2}連射（各${68 + lv * 11}%ダメ・ボス戦でも集中連撃）`,
      },
      {
        id: 'ranger_snipe',
        name: '急所見切り',
        icon: '🎯',
        kind: 'passive',
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `会心率+${lv * 6}%・ボス特攻+${lv * 9}%`,
      },
      {
        id: 'ranger_treasure',
        name: 'トレジャーセンス',
        icon: '💎',
        kind: 'passive',
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `味方全体の強化石獲得+${lv * 6}%・装備ドロップ率+${lv * 4}%`,
      },
    ],
  },
  assassin: {
    id: 'assassin',
    name: 'クロエ',
    jobName: '暗殺者',
    icon: '🗡️',
    roleLabel: '遊撃・超会心＆初撃',
    accentColor: '#e879f9',
    defaultUnlocked: false,
    unlockStage: 8,
    recruitStoneCost: 60,
    atkMult: 0.66,
    hpMult: 0.80,
    critOffset: 12,
    threatWeight: 0.95,
    activeSkillCd: 3,
    skills: [
      {
        id: 'assassin_edge',
        name: 'ファントムエッジ',
        icon: '⚡',
        kind: 'active',
        cd: 3,
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `3T毎: 確定会心(+1段階)の ${145 + lv * 24}%一撃（防御貫通+20%）`,
      },
      {
        id: 'assassin_ambush',
        name: '初撃必殺',
        icon: '💥',
        kind: 'passive',
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `HP満タンの敵への与ダメージ+${lv * 24}%（雑魚ワンパン特化）`,
      },
      {
        id: 'assassin_drain',
        name: '血の渇望',
        icon: '🩸',
        kind: 'passive',
        maxLevel: MAX_SKILL_LEVEL,
        summary: (lv) =>
          `与ダメージの ${lv * 4}% を自己HP吸収・会心ダメ+${lv * 10}%`,
      },
    ],
  },
};

export function expToNextLevel(level: number): number {
  return Math.max(20, Math.round(28 * Math.pow(1.22, Math.max(0, level - 1))));
}

export function createStarterMember(
  id: JobId,
  overrideWeapon?: Item,
  overrideArmor?: Item,
): PartyMemberState {
  const def = JOB_DEFS[id];
  const skills: Record<string, number> = {};
  for (const sk of def.skills) {
    skills[sk.id] = 0;
  }
  return {
    id,
    unlocked: def.defaultUnlocked,
    level: 1,
    exp: 0,
    unspentSp: 1, // 開始時から1SPを所持してすぐスキル振りを体験可能
    skills,
    equipment: {
      weapon:
        overrideWeapon ??
        generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'weapon', isStarter: true }),
      armor:
        overrideArmor ??
        generateItem({ stage: 1, forcedRarity: 0, forcedSlot: 'armor', isStarter: true }),
    },
  };
}

export function createDefaultPartyState(leaderWeapon?: Item, leaderArmor?: Item): PartyState {
  const roster = {} as Record<JobId, PartyMemberState>;
  for (const id of JOB_ORDER) {
    roster[id] =
      id === 'warrior'
        ? createStarterMember(id, leaderWeapon, leaderArmor)
        : createStarterMember(id);
  }
  return {
    activeIds: ['warrior', 'mage', 'cleric'],
    roster,
  };
}

export function getActiveMembers(party: PartyState): PartyMemberState[] {
  return party.activeIds.map((id) => party.roster[id]);
}

export function grantPartyExp(
  party: PartyState,
  baseExp: number,
): Array<{ id: JobId; newLevel: number; gainedSp: number }> {
  if (baseExp <= 0) return [];
  const activeSet = new Set<JobId>(party.activeIds);
  const levelUps: Array<{ id: JobId; newLevel: number; gainedSp: number }> = [];

  for (const id of JOB_ORDER) {
    const member = party.roster[id];
    if (!member.unlocked) continue;
    const gain = activeSet.has(id) ? baseExp : Math.max(1, Math.floor(baseExp * 0.5));
    member.exp += gain;
    let gainedLevels = 0;
    while (member.exp >= expToNextLevel(member.level)) {
      member.exp -= expToNextLevel(member.level);
      member.level += 1;
      member.unspentSp += 1;
      gainedLevels += 1;
    }
    if (gainedLevels > 0) {
      levelUps.push({ id, newLevel: member.level, gainedSp: gainedLevels });
    }
  }
  return levelUps;
}

export function allocateSkillPoint(member: PartyMemberState, skillId: string): boolean {
  if (member.unspentSp <= 0) return false;
  const def = JOB_DEFS[member.id];
  const skillDef = def.skills.find((s) => s.id === skillId);
  if (!skillDef) return false;
  const cur = member.skills[skillId] ?? 0;
  if (cur >= skillDef.maxLevel) return false;
  member.skills[skillId] = cur + 1;
  member.unspentSp -= 1;
  return true;
}

export function getSpentSkillPoints(member: PartyMemberState): number {
  let spent = 0;
  for (const sk of JOB_DEFS[member.id].skills) {
    spent += Math.max(0, member.skills[sk.id] ?? 0);
  }
  return spent;
}

export function resetMemberSkills(member: PartyMemberState): number {
  const spent = getSpentSkillPoints(member);
  if (spent <= 0) return 0;
  for (const sk of JOB_DEFS[member.id].skills) {
    member.skills[sk.id] = 0;
  }
  member.unspentSp += spent;
  return spent;
}

export function canRecruitCharacter(
  party: PartyState,
  id: JobId,
  maxStage: number,
  stones: number,
): { unlocked: boolean; canFree: boolean; canPay: boolean; unlockStage: number; stoneCost: number } {
  const member = party.roster[id];
  const def = JOB_DEFS[id];
  if (member.unlocked) {
    return {
      unlocked: true,
      canFree: false,
      canPay: false,
      unlockStage: def.unlockStage,
      stoneCost: def.recruitStoneCost,
    };
  }
  const canFree = maxStage >= def.unlockStage;
  const canPay = !canFree && stones >= def.recruitStoneCost;
  return {
    unlocked: false,
    canFree,
    canPay,
    unlockStage: def.unlockStage,
    stoneCost: def.recruitStoneCost,
  };
}

export function recruitCharacter(
  state: GameState,
  id: JobId,
): { ok: boolean; paidStones: number } {
  const check = canRecruitCharacter(state.party, id, state.maxStage, state.stones);
  if (check.unlocked) return { ok: false, paidStones: 0 };
  if (!check.canFree && !check.canPay) return { ok: false, paidStones: 0 };

  const paidStones = check.canFree ? 0 : check.stoneCost;
  if (paidStones > 0) {
    state.stones -= paidStones;
  }
  const member = state.party.roster[id];
  member.unlocked = true;
  // 加入時に現在パーティ平均レベルに追いつきやすくするため最低レベル補正
  const activeAvgLv = Math.max(
    1,
    Math.floor(
      getActiveMembers(state.party).reduce((acc, m) => acc + m.level, 0) / state.party.activeIds.length,
    ),
  );
  if (member.level < activeAvgLv) {
    const diff = activeAvgLv - member.level;
    member.level = activeAvgLv;
    member.unspentSp += diff;
  }
  return { ok: true, paidStones };
}

export function setActivePartySlot(
  party: PartyState,
  slotIdx: 0 | 1 | 2,
  newId: JobId,
): boolean {
  const target = party.roster[newId];
  if (!target || !target.unlocked) return false;
  const existingIdx = party.activeIds.indexOf(newId);
  if (existingIdx === slotIdx) return false;
  if (existingIdx !== -1) {
    const prev = party.activeIds[slotIdx];
    party.activeIds[slotIdx] = newId;
    party.activeIds[existingIdx] = prev;
    return true;
  }
  party.activeIds[slotIdx] = newId;
  return true;
}

export function getMemberEquippedSet(
  member: PartyMemberState,
  sharedEquipped: EquippedSet,
): EquippedSet {
  return {
    weapon: member.equipment.weapon,
    armor: member.equipment.armor,
    ring: sharedEquipped.ring,
    necklace: sharedEquipped.necklace,
    gauntlets: sharedEquipped.gauntlets,
    boots: sharedEquipped.boots,
  };
}

export function syncLeaderEquipped(state: GameState): void {
  const leader = state.party.roster[state.party.activeIds[0]];
  if (!leader) return;
  state.equipped.weapon = leader.equipment.weapon;
  state.equipped.armor = leader.equipment.armor;
}

export interface MemberCombatStats extends HeroStats {
  threatWeight: number;
  damageReducePct: number;
  counterChancePct: number;
  counterDmgMult: number;
  vampiricPct: number;
  firstStrikePct: number;
  cleavePct: number;
  doubleHitPct: number;
  thornsPct: number;
  healPowerMult: number;
  skillMultBonus: number;
  activeSkillCd: number;
}

export function calcPartyMemberStats(
  member: PartyMemberState,
  sharedEquipped: EquippedSet,
  cleared100: boolean,
  activeMembers: PartyMemberState[],
): MemberCombatStats {
  const def = JOB_DEFS[member.id];
  const effectiveSet = getMemberEquippedSet(member, sharedEquipped);
  const base = calcHeroStats(effectiveSet, cleared100);

  // キャラレベル成長（1Lvごとに+4%の堅実な成長）
  const lvMult = 1 + Math.max(0, member.level - 1) * 0.04;

  let atkScale = def.atkMult * lvMult;
  let hpScale = def.hpMult * lvMult;
  let critRate = base.critRate + def.critOffset;
  let critDmg = base.critDmg;
  let dmgPct = base.dmgPct;
  let armorPen = base.armorPen;
  let bossDmg = base.bossDmg;
  let threatWeight = def.threatWeight;
  let damageReducePct = 0;
  let counterChancePct = 0;
  let counterDmgMult = 0.9;
  let vampiricPct = 0;
  let firstStrikePct = 0;
  let cleavePct = 0;
  let doubleHitPct = 0;
  let thornsPct = 0;
  let healPowerMult = 1;
  let skillMultBonus = 0;

  // 個人パッシブスキル適用
  const sk = member.skills;
  if (member.id === 'warrior') {
    const fort = sk.warrior_fortress ?? 0;
    hpScale *= 1 + fort * 0.14;
    damageReducePct += fort * 4;
    threatWeight += fort * 0.35;
    const cnt = sk.warrior_counter ?? 0;
    if (cnt > 0) {
      counterChancePct += 18 + cnt * 10;
      counterDmgMult = 0.9 + cnt * 0.15;
    }
  } else if (member.id === 'mage') {
    const amp = sk.mage_amp ?? 0;
    atkScale *= 1 + amp * 0.09;
    skillMultBonus += amp * 0.12;
    const pierce = sk.mage_pierce ?? 0;
    armorPen += pierce * 6;
    dmgPct += pierce * 5;
  } else if (member.id === 'cleric') {
    const prayer = sk.cleric_prayer ?? 0;
    healPowerMult += prayer * 0.16;
  } else if (member.id === 'ranger') {
    const snipe = sk.ranger_snipe ?? 0;
    critRate += snipe * 6;
    bossDmg += snipe * 9;
  } else if (member.id === 'assassin') {
    const ambush = sk.assassin_ambush ?? 0;
    firstStrikePct += ambush * 24;
    const drain = sk.assassin_drain ?? 0;
    vampiricPct += drain * 4;
    critDmg += drain * 10;
  }

  // パーティ全体パッシブオーラ（僧侶「祝福のオーラ」）
  for (const ally of activeMembers) {
    if (ally.id === 'cleric') {
      const auraLv = ally.skills.cleric_aura ?? 0;
      if (auraLv > 0) {
        critRate += auraLv * 4;
        critDmg += auraLv * 9;
      }
    }
  }

  // 装備固有特性（Unique Affix）合算（個人2枠＋共有遺物4枠）
  const itemsToScan: Item[] = [
    effectiveSet.weapon,
    effectiveSet.armor,
    effectiveSet.ring,
    effectiveSet.necklace,
    effectiveSet.gauntlets,
    effectiveSet.boots,
  ];
  for (const it of itemsToScan) {
    const af = it?.uniqueAffix;
    if (!af) continue;
    if (af.key === 'vampiric') vampiricPct += af.val;
    else if (af.key === 'first_strike') firstStrikePct += af.val;
    else if (af.key === 'cleave') cleavePct += af.val;
    else if (af.key === 'double_hit') doubleHitPct += af.val;
    else if (af.key === 'thorns') thornsPct += af.val;
  }

  const maxCritCap = cleared100 ? 300 : 100;
  const finalCritRate = clamp(critRate, 0, maxCritCap);
  const finalCritDmg = Math.max(100, critDmg);
  const finalAtk = Math.max(1, base.atk * atkScale);
  const finalHp = Math.max(20, Math.round(base.hp * hpScale));

  const c = finalCritDmg / 100;
  let critExpectedMult = 1;
  if (finalCritRate <= 100) {
    critExpectedMult = 1 + (finalCritRate / 100) * (c - 1);
  } else if (finalCritRate <= 200) {
    critExpectedMult = c * (1 + ((finalCritRate - 100) / 100) * 1.0);
  } else {
    critExpectedMult = c * (2.0 + (Math.min(finalCritRate - 200, 100) / 100) * 2.0);
  }

  return {
    atk: finalAtk,
    hp: finalHp,
    critRate: finalCritRate,
    critDmg: finalCritDmg,
    dmgPct,
    armorPen: Math.min(100, armorPen),
    bossDmg,
    mythicCount: base.mythicCount,
    offlinePower: finalAtk * (1 + dmgPct / 100) * critExpectedMult,
    threatWeight,
    damageReducePct: clamp(damageReducePct, 0, 70),
    counterChancePct: clamp(counterChancePct, 0, 80),
    counterDmgMult,
    vampiricPct: clamp(vampiricPct, 0, 40),
    firstStrikePct,
    cleavePct: clamp(cleavePct, 0, 100),
    doubleHitPct: clamp(doubleHitPct, 0, 75),
    thornsPct: clamp(thornsPct, 0, 150),
    healPowerMult,
    skillMultBonus,
    activeSkillCd: def.activeSkillCd,
  };
}

export function getPartyBonuses(
  party: PartyState,
  sharedEquipped: EquippedSet,
): {
  stoneBonusPct: number;
  dropBonusPct: number;
  victoryHealPct: number;
  totalUnspentSp: number;
} {
  let stoneBonusPct = 0;
  let dropBonusPct = 0;
  let victoryHealPct = 0;
  let totalUnspentSp = 0;

  const active = getActiveMembers(party);
  for (const m of active) {
    if (m.id === 'ranger') {
      const tr = m.skills.ranger_treasure ?? 0;
      stoneBonusPct += tr * 6;
      dropBonusPct += tr * 4;
    }
    if (m.id === 'cleric') {
      const pr = m.skills.cleric_prayer ?? 0;
      victoryHealPct += pr * 3;
    }
    for (const ps of ['weapon', 'armor'] as const) {
      const af = m.equipment[ps]?.uniqueAffix;
      if (af?.key === 'treasure') stoneBonusPct += af.val;
    }
  }
  for (const ss of SHARED_ARTIFACT_SLOTS) {
    const af = sharedEquipped[ss]?.uniqueAffix;
    if (af?.key === 'treasure') stoneBonusPct += af.val;
  }
  for (const id of JOB_ORDER) {
    if (party.roster[id].unlocked) {
      totalUnspentSp += party.roster[id].unspentSp;
    }
  }

  return { stoneBonusPct, dropBonusPct, victoryHealPct, totalUnspentSp };
}

export function pickEnemyTargetMember(
  livingMembers: Array<{ id: JobId; threatWeight: number }>,
  rng: () => number = Math.random,
): JobId | null {
  if (livingMembers.length === 0) return null;
  if (livingMembers.length === 1) return livingMembers[0].id;
  const total = livingMembers.reduce((sum, m) => sum + Math.max(0.1, m.threatWeight), 0);
  let r = rng() * total;
  for (const m of livingMembers) {
    r -= Math.max(0.1, m.threatWeight);
    if (r <= 0) return m.id;
  }
  return livingMembers[livingMembers.length - 1].id;
}

export function scoreItemForAutoEquip(item: Item): number {
  const main = getMainStatVal(item);
  const subSum = item.subStats.reduce((s, sub) => s + sub.val, 0);
  const affixBonus = item.uniqueAffix ? 1.08 : 1.0;
  if (SLOTS[item.slot].isFixedCap) {
    return (main * 2.4 + subSum * 1.4 + item.rarity * 12) * affixBonus;
  }
  return main * (1 + subSum * 0.008 + item.rarity * 0.04) * affixBonus;
}

export function findBestAutoEquipCandidate(
  inventory: Item[],
  current: Item,
  slot: SlotKey,
): Item | null {
  const currentScore = scoreItemForAutoEquip(current);
  let best: Item | null = null;
  let bestScore = currentScore;
  for (const it of inventory) {
    if (it.slot !== slot) continue;
    const sc = scoreItemForAutoEquip(it);
    if (sc > bestScore * 1.005) {
      bestScore = sc;
      best = it;
    }
  }
  return best;
}

export function calcEnemyExpReward(stage: number, isBoss: boolean, isSanctumBoss: boolean): number {
  const base = Math.round(10 * Math.pow(1.13, Math.min(stage - 1, 90)) * (stage > 90 ? Math.pow(1.06, stage - 90) : 1));
  if (isSanctumBoss) return Math.max(40, Math.round(base * 6));
  if (isBoss) return Math.max(20, Math.round(base * 2.6));
  return Math.max(6, base);
}
