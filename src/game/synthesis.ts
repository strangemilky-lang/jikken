import { ACCESSORY_AXES, inferAccessoryAxis } from './accessories';
import { RARITIES } from './constants';
import { generateItem, matchesStorageFilter } from './items';
import type { AccessoryAxis, GameState, Item, ItemSlot, RarityId, StorageFilter } from './types';

export const SYNTHESIS_MATERIAL_COUNT = 9;
export const MYTHIC_REFORGE_COUNT = 3;
export const SYNTHESIS_STONE_REFUND_RATE = 0.6;

export interface SynthesisRecipe {
  sourceRarity: RarityId;
  targetRarity: RarityId;
  requiredCount: 9 | 3;
  isMythicReforge: boolean;
  requiresCleared100: boolean;
  shortLabel: string;
  title: string;
}

export const SYNTHESIS_RECIPES: SynthesisRecipe[] = [
  {
    sourceRarity: 0,
    targetRarity: 1,
    requiredCount: SYNTHESIS_MATERIAL_COUNT,
    isMythicReforge: false,
    requiresCleared100: false,
    shortLabel: 'コモン→レア',
    title: 'コモン×9 → レア×1',
  },
  {
    sourceRarity: 1,
    targetRarity: 2,
    requiredCount: SYNTHESIS_MATERIAL_COUNT,
    isMythicReforge: false,
    requiresCleared100: false,
    shortLabel: 'レア→エピック',
    title: 'レア×9 → エピック×1',
  },
  {
    sourceRarity: 2,
    targetRarity: 3,
    requiredCount: SYNTHESIS_MATERIAL_COUNT,
    isMythicReforge: false,
    requiresCleared100: false,
    shortLabel: 'エピック→レジェ',
    title: 'エピック×9 → レジェンダリー×1',
  },
  {
    sourceRarity: 3,
    targetRarity: 4,
    requiredCount: SYNTHESIS_MATERIAL_COUNT,
    isMythicReforge: false,
    requiresCleared100: true,
    shortLabel: 'レジェ→ミシック',
    title: 'レジェンダリー×9 → ミシック×1',
  },
  {
    sourceRarity: 4,
    targetRarity: 4,
    requiredCount: MYTHIC_REFORGE_COUNT,
    isMythicReforge: true,
    requiresCleared100: true,
    shortLabel: 'ミシック再錬成',
    title: 'ミシック×3 → ミシック再錬成×1',
  },
];

export function getSynthesisRecipe(sourceRarity: RarityId): SynthesisRecipe {
  return SYNTHESIS_RECIPES[sourceRarity] ?? SYNTHESIS_RECIPES[0];
}

export function isSynthesisRecipeUnlocked(sourceRarity: RarityId, cleared100: boolean): boolean {
  const recipe = getSynthesisRecipe(sourceRarity);
  return !recipe.requiresCleared100 || cleared100;
}

/**
 * 合成候補（バッグ内のみ・ロック除外・該当レアリティ）。
 * 自動セット時に強化済みや高階層品を巻き込みにくいよう、低Lv・低投資・低ステージ順に整列する。
 */
export function getEligibleSynthesisCandidates(
  inventory: Item[],
  sourceRarity: RarityId,
  slotFilter: StorageFilter = 'all',
): Item[] {
  return inventory
    .filter((it) => {
      if (it.rarity !== sourceRarity) return false;
      if (it.locked) return false;
      if (!matchesStorageFilter(it, slotFilter)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      if ((a.spentStones || 0) !== (b.spentStones || 0)) {
        return (a.spentStones || 0) - (b.spentStones || 0);
      }
      if (a.stage !== b.stage) return a.stage - b.stage;
      return a.id.localeCompare(b.id);
    });
}

export function countReadySynthesisRecipes(inventory: Item[], cleared100: boolean): number {
  let ready = 0;
  for (const recipe of SYNTHESIS_RECIPES) {
    if (!isSynthesisRecipeUnlocked(recipe.sourceRarity, cleared100)) continue;
    const count = getEligibleSynthesisCandidates(inventory, recipe.sourceRarity, 'all').length;
    if (count >= recipe.requiredCount) ready += 1;
  }
  return ready;
}

export type SynthesisOutputBucketKey = 'weapon' | 'armor' | `acc:${AccessoryAxis}`;

export interface SlotProbability {
  key: SynthesisOutputBucketKey;
  slot: ItemSlot;
  accAxis?: AccessoryAxis;
  label: string;
  icon: string;
  count: number;
  pct: number;
}

export interface SynthesisPreview {
  totalSpentStones: number;
  refundStones: number;
  slotProbabilities: SlotProbability[];
}

function getBucketForItem(item: Item): {
  key: SynthesisOutputBucketKey;
  slot: ItemSlot;
  accAxis?: AccessoryAxis;
  label: string;
  icon: string;
} {
  if (item.slot === 'weapon') {
    return { key: 'weapon', slot: 'weapon', label: '武器', icon: '⚔️' };
  }
  if (item.slot === 'armor') {
    return { key: 'armor', slot: 'armor', label: '防具', icon: '🛡️' };
  }
  const axis = inferAccessoryAxis(item);
  const def = ACCESSORY_AXES[axis];
  return {
    key: `acc:${axis}`,
    slot: 'accessory',
    accAxis: axis,
    label: `アクセ(${def.shortLabel})`,
    icon: def.icon,
  };
}

export function computeSynthesisPreview(materials: Item[]): SynthesisPreview {
  const totalSpentStones = materials.reduce((sum, it) => sum + Math.max(0, it.spentStones || 0), 0);
  const refundStones = Math.floor(totalSpentStones * SYNTHESIS_STONE_REFUND_RATE);

  const buckets = new Map<
    SynthesisOutputBucketKey,
    { slot: ItemSlot; accAxis?: AccessoryAxis; label: string; icon: string; count: number }
  >();

  for (const m of materials) {
    const b = getBucketForItem(m);
    const existing = buckets.get(b.key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(b.key, {
        slot: b.slot,
        accAxis: b.accAxis,
        label: b.label,
        icon: b.icon,
        count: 1,
      });
    }
  }

  const total = Math.max(1, materials.length);
  const slotProbabilities: SlotProbability[] = Array.from(buckets.entries())
    .map(([key, info]) => ({
      key,
      slot: info.slot,
      accAxis: info.accAxis,
      label: info.label,
      icon: info.icon,
      count: info.count,
      pct: Math.round((info.count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalSpentStones,
    refundStones,
    slotProbabilities,
  };
}

/**
 * 投入した素材の部位・アクセ軸の比率どおりに抽選する（同部位/同軸9個なら100%その部位・軸）。
 */
export function pickWeightedOutcomeFromMaterials(
  materials: Item[],
  rng: () => number = Math.random,
): { slot: ItemSlot; accAxis?: AccessoryAxis } {
  if (materials.length === 0) return { slot: 'weapon' };
  const idx = Math.min(materials.length - 1, Math.floor(Math.max(0, rng()) * materials.length));
  const picked = materials[idx];
  if (picked.slot === 'accessory') {
    return { slot: 'accessory', accAxis: inferAccessoryAxis(picked) };
  }
  return { slot: picked.slot };
}

export type SynthesisExecutionResult =
  | {
      ok: true;
      resultItem: Item;
      refundStones: number;
      recipe: SynthesisRecipe;
      consumedCount: number;
    }
  | {
      ok: false;
      error: string;
    };

export function executeSynthesis(
  state: GameState,
  sourceRarity: RarityId,
  materialIds: string[],
  rng: () => number = Math.random,
): SynthesisExecutionResult {
  const recipe = getSynthesisRecipe(sourceRarity);
  if (!isSynthesisRecipeUnlocked(sourceRarity, state.cleared100)) {
    return {
      ok: false,
      error: `${recipe.shortLabel}は100階「大魔王」討伐後に解禁されます。`,
    };
  }

  const uniqueIds = Array.from(new Set(materialIds));
  if (uniqueIds.length !== recipe.requiredCount) {
    return {
      ok: false,
      error: `${RARITIES[sourceRarity].name}装備を${recipe.requiredCount}個選択してください。`,
    };
  }

  const byId = new Map<string, Item>();
  for (const it of state.inventory) {
    byId.set(it.id, it);
  }

  const materials: Item[] = [];
  for (const id of uniqueIds) {
    const found = byId.get(id);
    if (!found) {
      return { ok: false, error: '選択された素材がバッグ内に見つかりません。' };
    }
    if (found.locked) {
      return { ok: false, error: 'ロック中の装備は合成素材にできません。' };
    }
    if (found.rarity !== sourceRarity) {
      return { ok: false, error: '同じレアリティの装備のみ合成できます。' };
    }
    materials.push(found);
  }

  const preview = computeSynthesisPreview(materials);
  const outcome = pickWeightedOutcomeFromMaterials(materials, rng);
  const consumedSet = new Set(uniqueIds);

  state.inventory = state.inventory.filter((it) => !consumedSet.has(it.id));

  const resultItem = generateItem({
    stage: state.maxStage,
    forcedSlot: outcome.slot,
    forcedAxis: outcome.accAxis ?? null,
    forcedRarity: recipe.targetRarity,
    isBoss: true,
    cleared100: state.cleared100,
  });

  state.inventory.unshift(resultItem);
  if (preview.refundStones > 0) {
    state.stones += preview.refundStones;
  }

  return {
    ok: true,
    resultItem,
    refundStones: preview.refundStones,
    recipe,
    consumedCount: materials.length,
  };
}
