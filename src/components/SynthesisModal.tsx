import { useEffect, useMemo, useRef, useState } from 'react';
import { ACCESSORY_AXES, ACCESSORY_AXIS_ORDER } from '../game/accessories';
import { RARITIES, SUB_MAP } from '../game/constants';
import { fmt, getItemMainStatMeta, getMainStatVal } from '../game/items';
import {
  computeSynthesisPreview,
  getEligibleSynthesisCandidates,
  getSynthesisRecipe,
  isSynthesisRecipeUnlocked,
  SYNTHESIS_RECIPES,
  SYNTHESIS_STONE_REFUND_RATE,
  type SynthesisExecutionResult,
} from '../game/synthesis';
import type { EquipSlotKey, Item, RarityId, StorageFilter } from '../game/types';
import { RarityName } from './RarityName';

interface SynthesisModalProps {
  open: boolean;
  inventory: Item[];
  maxStage: number;
  cleared100: boolean;
  autoSalvageRarity: number;
  onChangeAutoSalvage: (val: number) => void;
  onSynthesize: (sourceRarity: RarityId, materialIds: string[]) => SynthesisExecutionResult;
  onEquipResult: (itemId: string, targetSlot?: EquipSlotKey) => void;
  onClose: () => void;
}

const AUTO_SALVAGE_LABELS: Record<number, string> = {
  [-1]: 'しない（すべて入手）',
  0: 'コモン以下',
  1: 'レア以下',
  2: 'エピック以下',
  3: 'レジェンド以下',
};

const SYNTH_FILTER_TABS: Array<{ key: StorageFilter; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'weapon', label: '⚔️ 武器' },
  { key: 'armor', label: '🛡️ 防具' },
  ...ACCESSORY_AXIS_ORDER.map((axis) => ({
    key: axis as StorageFilter,
    label: `${ACCESSORY_AXES[axis].icon} ${ACCESSORY_AXES[axis].shortLabel}`,
  })),
];

export function SynthesisModal({
  open,
  inventory,
  maxStage,
  cleared100,
  autoSalvageRarity,
  onChangeAutoSalvage,
  onSynthesize,
  onEquipResult,
  onClose,
}: SynthesisModalProps) {
  const [sourceRarity, setSourceRarity] = useState<RarityId>(0);
  const [slotFilter, setSlotFilter] = useState<StorageFilter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isForging, setIsForging] = useState(false);
  const [lastResult, setLastResult] = useState<{
    item: Item;
    refundStones: number;
    equipped: boolean;
    isMythicReforge: boolean;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const forgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (forgeTimerRef.current) clearTimeout(forgeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      if (forgeTimerRef.current) {
        clearTimeout(forgeTimerRef.current);
        forgeTimerRef.current = null;
      }
      setIsForging(false);
      setSelectedIds([]);
      setErrorMsg('');
    }
  }, [open]);

  const recipe = getSynthesisRecipe(sourceRarity);
  const unlocked = isSynthesisRecipeUnlocked(sourceRarity, cleared100);

  const allCandidatesForRarity = useMemo(
    () => getEligibleSynthesisCandidates(inventory, sourceRarity, 'all'),
    [inventory, sourceRarity],
  );

  const filteredCandidates = useMemo(
    () => getEligibleSynthesisCandidates(inventory, sourceRarity, slotFilter),
    [inventory, sourceRarity, slotFilter],
  );

  const validSelectedIds = useMemo(() => {
    const validSet = new Set(allCandidatesForRarity.map((it) => it.id));
    return selectedIds.filter((id) => validSet.has(id)).slice(0, recipe.requiredCount);
  }, [allCandidatesForRarity, selectedIds, recipe.requiredCount]);

  const selectedItems = useMemo(() => {
    const map = new Map(allCandidatesForRarity.map((it) => [it.id, it]));
    return validSelectedIds.map((id) => map.get(id)).filter((it): it is Item => Boolean(it));
  }, [allCandidatesForRarity, validSelectedIds]);

  const preview = useMemo(() => computeSynthesisPreview(selectedItems), [selectedItems]);

  if (!open) return null;

  const targetRInfo = RARITIES[recipe.targetRarity];
  const sourceRInfo = RARITIES[recipe.sourceRarity];
  const canExecute = unlocked && !isForging && selectedItems.length === recipe.requiredCount;
  const isConflictWithAutoSalvage = unlocked && sourceRarity <= autoSalvageRarity;
  const suggestedAutoSalvage = Math.max(-1, sourceRarity - 1);

  const handleSelectRecipe = (nextRarity: RarityId) => {
    if (isForging) return;
    setSourceRarity(nextRarity);
    setSelectedIds([]);
    setLastResult(null);
    setErrorMsg('');
  };

  const handleToggleItem = (itemId: string) => {
    if (isForging || !unlocked) return;
    setErrorMsg('');
    setSelectedIds((prev) => {
      if (prev.includes(itemId)) {
        return prev.filter((id) => id !== itemId);
      }
      if (prev.length >= recipe.requiredCount) return prev;
      return [...prev, itemId];
    });
  };

  const handleAutoFill = () => {
    if (isForging || !unlocked) return;
    setErrorMsg('');
    const currentSet = new Set(validSelectedIds);
    const next = [...validSelectedIds];
    for (const cand of filteredCandidates) {
      if (next.length >= recipe.requiredCount) break;
      if (!currentSet.has(cand.id)) {
        next.push(cand.id);
        currentSet.add(cand.id);
      }
    }
    setSelectedIds(next);
  };

  const handleClearSelection = () => {
    if (isForging) return;
    setSelectedIds([]);
    setErrorMsg('');
  };

  const handleRunSynthesis = () => {
    if (!canExecute) return;
    setErrorMsg('');
    setLastResult(null);
    setIsForging(true);

    const idsSnapshot = [...validSelectedIds];
    forgeTimerRef.current = setTimeout(() => {
      forgeTimerRef.current = null;
      const res = onSynthesize(sourceRarity, idsSnapshot);
      setIsForging(false);
      if (!res.ok) {
        setErrorMsg(res.error);
        return;
      }
      setSelectedIds([]);
      setLastResult({
        item: res.resultItem,
        refundStones: res.refundStones,
        equipped: false,
        isMythicReforge: res.recipe.isMythicReforge,
      });
    }, 320);
  };

  const handleEquipLastResult = (targetSlot?: EquipSlotKey) => {
    if (!lastResult || lastResult.equipped) return;
    onEquipResult(lastResult.item.id, targetSlot);
    setLastResult((prev) => (prev ? { ...prev, equipped: true } : null));
  };

  const altarSlots = Array.from({ length: recipe.requiredCount }, (_, idx) => selectedItems[idx] ?? null);
  const lastResultMeta = lastResult ? getItemMainStatMeta(lastResult.item) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="synthesis-modal-title"
      data-testid="synthesis-modal"
    >
      <div className="flex max-h-[92vh] w-[min(860px,96vw)] flex-col gap-3 overflow-y-auto rounded-xl border border-purple-400/50 bg-[#141e30] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.75)]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="synthesis-modal-title"
              className="flex items-center gap-2 text-base font-extrabold text-purple-200"
            >
              <span>⚗️ 装備合成の祭壇</span>
            </h2>
            <span className="rounded border border-slate-500/30 bg-black/35 px-2 py-0.5 text-[11px] text-slate-300">
              生成基準: St.{maxStage} · 強化石{Math.round(SYNTHESIS_STONE_REFUND_RATE * 100)}%返還
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isForging}
            className="rounded-md border border-slate-400/25 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 disabled:opacity-40"
          >
            ✕ 閉じる
          </button>
        </div>

        {/* Recipe Tabs */}
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="合成レシピ">
          {SYNTHESIS_RECIPES.map((rec) => {
            const isTabUnlocked = isSynthesisRecipeUnlocked(rec.sourceRarity, cleared100);
            const candCount = getEligibleSynthesisCandidates(inventory, rec.sourceRarity, 'all').length;
            const isReady = isTabUnlocked && candCount >= rec.requiredCount;
            const active = sourceRarity === rec.sourceRarity;
            const srcR = RARITIES[rec.sourceRarity];
            const tgtR = RARITIES[rec.targetRarity];
            return (
              <button
                key={rec.sourceRarity}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`synth-tab-${rec.sourceRarity}`}
                onClick={() => handleSelectRecipe(rec.sourceRarity)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold transition ${
                  active
                    ? 'border-purple-300 bg-purple-600/30 text-white shadow-[0_0_12px_rgba(192,132,252,0.3)]'
                    : isTabUnlocked
                      ? 'border-slate-500/30 bg-slate-800/85 text-slate-300 hover:bg-slate-700/85'
                      : 'border-slate-600/30 bg-slate-900/60 text-slate-500'
                }`}
              >
                <span style={{ color: isTabUnlocked ? tgtR.color : undefined }}>
                  {!isTabUnlocked ? '🔒 ' : rec.isMythicReforge ? '🌈 ' : ''}
                  {rec.shortLabel}
                </span>
                <span
                  className={`rounded px-1 py-0.2 text-[10px] tabular-nums ${
                    isReady
                      ? 'bg-emerald-500/25 font-extrabold text-emerald-300'
                      : 'bg-black/40 text-slate-400'
                  }`}
                  style={active && !isReady ? { color: srcR.color } : undefined}
                >
                  {candCount}/{rec.requiredCount}
                </span>
              </button>
            );
          })}
        </div>

        {/* Auto-Salvage Conflict Helper */}
        {isConflictWithAutoSalvage && (
          <div
            data-testid="synth-autosalvage-warning"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/45 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          >
            <span>
              ⚠️ 自動分解が「{AUTO_SALVAGE_LABELS[autoSalvageRarity] ?? '有効'}」のため、
              <strong style={{ color: sourceRInfo.color }}>{sourceRInfo.name}</strong>
              装備が自動で分解されます。素材を貯めるには設定を下げてください。
            </span>
            <button
              type="button"
              data-testid="btn-lower-autosalvage"
              onClick={() => onChangeAutoSalvage(suggestedAutoSalvage)}
              className="shrink-0 rounded-md border border-amber-300/70 bg-amber-600/35 px-2.5 py-1 text-[11px] font-bold text-amber-100 transition hover:bg-amber-600/55"
            >
              自動分解を「{AUTO_SALVAGE_LABELS[suggestedAutoSalvage]}」へ変更
            </button>
          </div>
        )}

        {/* Main 2-Column Body: Left = 3x3 Altar + Output / Right = Eligible Bag Picker */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[310px_minmax(0,1fr)]">
          {/* Left: Altar Grid + Actions + Result */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-slate-400/20 bg-black/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-extrabold" style={{ color: targetRInfo.color }}>
                {recipe.title}
              </span>
              <span className="font-bold text-slate-300 tabular-nums">
                {selectedItems.length} / {recipe.requiredCount}
              </span>
            </div>

            {!unlocked ? (
              <div className="flex min-h-[216px] flex-col items-center justify-center gap-2 rounded-lg border border-slate-600/35 bg-slate-900/70 p-4 text-center text-xs text-slate-400">
                <div className="text-2xl">🔒</div>
                <div className="font-bold text-slate-200">100階「大魔王」討伐で解禁</div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  100F玄室を突破すると、レジェンダリー×9→ミシック合成および不要ミシック×3の再錬成が解禁されます。
                </p>
              </div>
            ) : (
              <div
                data-testid="synth-altar-grid"
                className={`grid gap-1.5 ${
                  recipe.isMythicReforge ? 'grid-cols-3 py-6' : 'grid-cols-3'
                }`}
              >
                {altarSlots.map((slotItem, idx) => {
                  const rInfo = slotItem ? RARITIES[slotItem.rarity] : null;
                  const meta = slotItem ? getItemMainStatMeta(slotItem) : null;
                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={!slotItem || isForging}
                      onClick={() => slotItem && handleToggleItem(slotItem.id)}
                      title={slotItem ? `${slotItem.name}（クリックで外す）` : `素材スロット ${idx + 1}`}
                      className={`relative flex h-[68px] flex-col items-center justify-center rounded-lg border p-1 text-center transition ${
                        isForging
                          ? 'gacha-card-shake border-purple-300 bg-purple-600/25 shadow-[0_0_16px_rgba(192,132,252,0.45)]'
                          : slotItem
                            ? 'hover:brightness-110'
                            : 'border-dashed border-slate-600/60 bg-slate-900/50 text-slate-600'
                      }`}
                      style={
                        slotItem && rInfo && !isForging
                          ? { borderColor: rInfo.border, background: rInfo.bg }
                          : undefined
                      }
                    >
                      {slotItem && meta ? (
                        <>
                          <span className="text-lg leading-none">{slotItem.icon}</span>
                          <span className="mt-1 w-full truncate text-[9px] font-bold text-slate-100">
                            {meta.axisDef ? meta.axisDef.shortLabel : meta.slotLabel}
                            {slotItem.level > 0 ? `+${slotItem.level}` : ''}
                          </span>
                          <span className="text-[9px] text-slate-400">
                            {meta.isFixedCap ? '固定' : `St.${slotItem.stage}`}
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] font-semibold">+{idx + 1}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Slot/Axis Probability & Refund Preview */}
            <div className="flex flex-col gap-1.5 rounded-md border border-white/10 bg-slate-900/75 p-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">出現部位・軸の確率（投入比率）</span>
                {preview.refundStones > 0 && (
                  <span
                    data-testid="synth-refund-preview"
                    className="font-bold text-sky-300 tabular-nums"
                  >
                    返還 +{fmt(preview.refundStones)}💎
                  </span>
                )}
              </div>
              {preview.slotProbabilities.length === 0 ? (
                <div className="text-[10px] text-slate-500">
                  素材をセットすると部位・アクセ軸ごとの抽選率が表示されます（同種のみ投入で100%）
                </div>
              ) : (
                <div className="flex flex-wrap gap-1" data-testid="synth-slot-probs">
                  {preview.slotProbabilities.map((sp) => (
                    <span
                      key={sp.key}
                      className="rounded border border-slate-500/35 bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-100"
                    >
                      {sp.icon} {sp.label} {sp.pct}%
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="btn-synth-autofill"
                disabled={!unlocked || isForging || filteredCandidates.length === 0}
                onClick={handleAutoFill}
                className="flex-1 rounded-md border border-sky-400/60 bg-sky-700/40 px-2.5 py-1.5 text-xs font-bold text-sky-100 transition hover:bg-sky-600/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ✨ 自動セット
              </button>
              <button
                type="button"
                disabled={isForging || selectedItems.length === 0}
                onClick={handleClearSelection}
                className="rounded-md border border-slate-500/40 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                クリア
              </button>
            </div>

            <button
              type="button"
              data-testid="btn-synth-execute"
              disabled={!canExecute}
              onClick={handleRunSynthesis}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-extrabold transition ${
                canExecute
                  ? recipe.targetRarity === 4
                    ? 'border-pink-300 bg-gradient-to-r from-pink-600 via-purple-600 to-sky-600 text-white shadow-[0_0_18px_rgba(244,114,182,0.4)] hover:brightness-110'
                    : 'border-amber-300 bg-gradient-to-r from-purple-600 to-amber-600 text-white shadow-[0_0_16px_rgba(251,191,36,0.35)] hover:brightness-110'
                  : 'cursor-not-allowed border-slate-600/40 bg-slate-800/80 text-slate-500'
              }`}
            >
              {isForging
                ? '✨ 錬成中…'
                : `⚗️ ${recipe.isMythicReforge ? 'ミシックを再錬成する' : `${targetRInfo.name}を合成する`} (${selectedItems.length}/${recipe.requiredCount})`}
            </button>

            {errorMsg && (
              <div className="rounded border border-rose-400/50 bg-rose-950/50 px-2 py-1 text-center text-[11px] font-bold text-rose-200">
                {errorMsg}
              </div>
            )}

            {/* Forged Result Card */}
            {lastResult && lastResultMeta && (
              <div
                data-testid="synth-result-card"
                className="gacha-card-pop relative flex flex-col gap-1.5 overflow-hidden rounded-lg border p-2.5"
                style={{
                  borderColor: RARITIES[lastResult.item.rarity].border,
                  background: RARITIES[lastResult.item.rarity].bg,
                  boxShadow:
                    lastResult.item.rarity === 4
                      ? '0 0 20px rgba(244,114,182,0.35)'
                      : '0 0 14px rgba(251,191,36,0.28)',
                }}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span
                    className="font-extrabold"
                    style={{ color: RARITIES[lastResult.item.rarity].color }}
                  >
                    ✨ {lastResult.isMythicReforge ? '再錬成成功！' : '合成成功！'} [{RARITIES[lastResult.item.rarity].name}]
                  </span>
                  <span className="text-slate-300">
                    {lastResultMeta.isFixedCap ? '固定上限' : `St.${lastResult.item.stage}`}
                  </span>
                </div>
                <div className="truncate text-xs font-extrabold">
                  {lastResult.item.icon} <RarityName item={lastResult.item} />
                </div>
                <div className="text-[11px] font-semibold text-slate-100">
                  {lastResultMeta.mainLabel} +{fmt(getMainStatVal(lastResult.item))}
                  {lastResultMeta.unit}
                </div>
                <div className="text-[10px] text-slate-300">
                  {lastResult.item.subStats
                    .map((s) => `${SUB_MAP[s.key].label}+${s.val.toFixed(1)}%`)
                    .join(' · ')}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-sky-300">
                    {lastResult.refundStones > 0
                      ? `💎 強化石 +${fmt(lastResult.refundStones)} 返還済`
                      : 'バッグへ格納されました'}
                  </span>
                  {lastResult.item.slot === 'accessory' ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        data-testid="btn-synth-equip-result"
                        disabled={lastResult.equipped}
                        onClick={() => handleEquipLastResult('acc1')}
                        className="rounded border border-blue-400/70 bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white transition hover:bg-blue-500 disabled:opacity-45"
                      >
                        {lastResult.equipped ? '装備済' : '枠1に装備'}
                      </button>
                      <button
                        type="button"
                        disabled={lastResult.equipped}
                        onClick={() => handleEquipLastResult('acc2')}
                        className="rounded border border-indigo-400/70 bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white transition hover:bg-indigo-500 disabled:opacity-45"
                      >
                        {lastResult.equipped ? '装備済' : '枠2に装備'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid="btn-synth-equip-result"
                      disabled={lastResult.equipped}
                      onClick={() => handleEquipLastResult()}
                      className="rounded border border-blue-400/70 bg-blue-600 px-2.5 py-0.5 text-[11px] font-bold text-white transition hover:bg-blue-500 disabled:opacity-45"
                    >
                      {lastResult.equipped ? '装備済' : '今すぐ装備'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: Bag Candidate Selector */}
          <div className="flex min-h-[340px] flex-col gap-2 rounded-lg border border-slate-400/20 bg-black/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="text-xs font-bold text-slate-200">
                バッグ内の対象素材 ({filteredCandidates.length}個)
              </div>
              <span className="text-[10px] text-slate-400">
                ※装備中・🔒ロック中・倉庫内は自動除外
              </span>
            </div>

            {/* Slot / Axis Filter */}
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="素材の部位絞り込み">
              {SYNTH_FILTER_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={slotFilter === tab.key}
                  onClick={() => setSlotFilter(tab.key)}
                  className={`rounded px-2 py-0.5 text-[11px] transition ${
                    slotFilter === tab.key
                      ? 'border border-sky-400 bg-sky-400/20 font-bold text-white'
                      : 'border border-slate-500/25 bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Candidate List */}
            <div className="flex max-h-[380px] min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {filteredCandidates.length === 0 ? (
                <div className="my-auto py-8 text-center text-xs leading-relaxed text-slate-400">
                  バッグ内に未ロックの
                  <span className="font-bold" style={{ color: sourceRInfo.color }}>
                    「{sourceRInfo.name}」
                  </span>
                  装備がありません。
                  <br />
                  自動分解設定を調整すると素材を貯めやすくなります。
                </div>
              ) : (
                filteredCandidates.map((it) => {
                  const isPicked = validSelectedIds.includes(it.id);
                  const rInfo = RARITIES[it.rarity];
                  const meta = getItemMainStatMeta(it);
                  const disabledPick = !unlocked || isForging || (!isPicked && validSelectedIds.length >= recipe.requiredCount);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      disabled={disabledPick}
                      data-synth-candidate={it.id}
                      onClick={() => handleToggleItem(it.id)}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition ${
                        isPicked
                          ? 'border-purple-300 bg-purple-600/25 ring-1 ring-purple-300/70'
                          : 'bg-slate-800/85 hover:bg-slate-700/85 disabled:opacity-45'
                      }`}
                      style={!isPicked ? { borderColor: rInfo.border } : undefined}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-lg">{it.icon}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 text-xs font-bold">
                            <span className="truncate">
                              <RarityName item={it} />
                            </span>
                            {it.level > 0 && (
                              <span className="shrink-0 text-[11px] text-amber-300">+{it.level}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-300">
                            {meta.mainLabel} +{fmt(getMainStatVal(it))}
                            {meta.unit} · {meta.isFixedCap ? '固定上限' : `St.${it.stage}`}
                            {it.spentStones > 0 && (
                              <span className="ml-1.5 text-sky-300">
                                (返還+{fmt(Math.floor(it.spentStones * SYNTHESIS_STONE_REFUND_RATE))}💎)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-extrabold ${
                          isPicked
                            ? 'bg-purple-500 text-white'
                            : 'bg-slate-900/80 text-slate-400'
                        }`}
                      >
                        {isPicked ? '選択中 ✓' : '選択'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
