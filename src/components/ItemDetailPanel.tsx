import { MAX_EQUIP_LEVEL, MYTHIC_MAX_EQUIP_LEVEL, RARITIES, SLOTS, SUB_MAP, SUBSTAT_STEP_INTERVAL } from '../game/constants';
import { fmt, formatStatDiff, getMainStatVal, getMaxEquipLevel, getSalvageValue, getUpgradeCost } from '../game/items';
import type { Item, ItemLocation } from '../game/types';
import { RarityName } from './RarityName';

interface ItemDetailPanelProps {
  item: Item | null;
  location: 'equipped' | ItemLocation;
  equippedInSlot: Item | null;
  stones: number;
  isRollingUpgrade: boolean;
  rouletteActiveIdx: number | null;
  lastBoostedSubIdx: number | null;
  upgradeFeedback: string;
  emptyMessage: string;
  onEquipItem?: (id: string) => void;
  onMoveLocation?: (id: string) => void;
  moveLocationDisabled?: boolean;
  onUpgradeItem: (id: string) => void;
  onToggleLock: (id: string) => void;
  onSalvageSingle?: (id: string) => void;
  salvageBonusPct?: number;
}

export function ItemDetailPanel({
  item,
  location,
  equippedInSlot,
  stones,
  isRollingUpgrade,
  rouletteActiveIdx,
  lastBoostedSubIdx,
  upgradeFeedback,
  emptyMessage,
  onEquipItem,
  onMoveLocation,
  moveLocationDisabled = false,
  onUpgradeItem,
  onToggleLock,
  onSalvageSingle,
  salvageBonusPct = 0,
}: ItemDetailPanelProps) {
  if (!item) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs leading-relaxed text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  const isEquipped = location === 'equipped';
  const rInfo = RARITIES[item.rarity];
  const sInfo = SLOTS[item.slot];
  const upgCost = getUpgradeCost(item);
  const maxLv = getMaxEquipLevel(item);
  const isMaxLv = item.level >= maxLv;
  const canAfford = stones >= upgCost;
  const nextBoostLv = item.level + (SUBSTAT_STEP_INTERVAL - (item.level % SUBSTAT_STEP_INTERVAL));
  const salvageVal = getSalvageValue(item, salvageBonusPct);

  const mainVal = getMainStatVal(item);
  const eqMainVal = equippedInSlot ? getMainStatVal(equippedInSlot) : 0;
  const mainDiff = mainVal - eqMainVal;
  const diffInfo = formatStatDiff(mainDiff, sInfo.unit);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
        {/* Item Header */}
        <div
          className="rounded-lg border p-2.5"
          style={{ borderColor: rInfo.border, background: rInfo.bg }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-sm font-extrabold">
              {item.icon} <RarityName item={item} />{' '}
              {item.level > 0 && <span className="text-amber-400">+{item.level}</span>}
            </div>
            <span
              className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold"
              style={{ color: rInfo.color, borderColor: rInfo.color }}
            >
              {rInfo.name}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-[11px] text-slate-300">
            <span>
              {sInfo.label} /{' '}
              {sInfo.isFixedCap ? `固定上限 (取得St.${item.stage})` : `階層装備: St.${item.stage}`}
            </span>
            <span>
              強化: {item.level} / {maxLv}{' '}
              {isEquipped && <strong className="text-sky-400">[装備中]</strong>}
              {location === 'stash' && <strong className="text-emerald-300">[倉庫保管中]</strong>}
            </span>
          </div>
          {item.rarity === 4 && (
            <div className="mythic-text mt-1 text-[11px] font-extrabold">
              ✨ ミシック特性：強化上限 +{MYTHIC_MAX_EQUIP_LEVEL}（サブステ成長最大10回）
            </div>
          )}
        </div>

        {/* Main & Substats */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-black/25 px-2.5 py-2">
          <div className="text-[10px] font-bold text-slate-400">
            メインステータス（{item.level >= MAX_EQUIP_LEVEL ? '+21以降は毎回+9%' : '強化で毎回+12%'}）
          </div>
          <div className="flex items-center justify-between rounded bg-white/[0.03] px-2 py-1 text-xs">
            <span className="text-slate-200">{sInfo.mainLabel}</span>
            <span>
              <strong className="text-sm text-white">
                +{fmt(mainVal)}
                {sInfo.unit}
              </strong>{' '}
              {!isEquipped && equippedInSlot && (
                <span
                  className={`ml-1 font-bold ${
                    diffInfo.tone === 'up'
                      ? 'text-emerald-400'
                      : diffInfo.tone === 'down'
                        ? 'text-rose-400'
                        : 'text-slate-400'
                  }`}
                >
                  ({diffInfo.text})
                </span>
              )}
            </span>
          </div>

          <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-slate-400">
            <span>
              サブステータス（+{SUBSTAT_STEP_INTERVAL}毎に
              {item.subStats.length < 4 ? '新規解放' : 'ランダム成長'}）
            </span>
            {!isMaxLv && <span className="text-amber-400">次: +{nextBoostLv}</span>}
          </div>

          {item.subStats.map((sub, sIdx) => {
            const def = SUB_MAP[sub.key];
            const isRoulette = rouletteActiveIdx === sIdx;
            const isFlashed = lastBoostedSubIdx === sIdx;
            return (
              <div
                key={`${sub.key}-${sIdx}`}
                data-sub-idx={sIdx}
                className={`flex items-center justify-between rounded px-2 py-1 text-xs transition ${
                  isRoulette
                    ? 'bg-sky-400/35 ring-1 ring-sky-400'
                    : isFlashed
                      ? 'bg-amber-400/30 ring-1 ring-amber-400'
                      : 'bg-white/[0.02]'
                }`}
              >
                <span className="text-slate-200">
                  {def.label}
                  {sub.boosts > 0 && (
                    <span className="ml-1.5 rounded border border-amber-400/45 bg-amber-500/20 px-1 text-[10px] font-extrabold text-amber-300">
                      ▲{sub.boosts}
                    </span>
                  )}
                </span>
                <span className="font-bold text-slate-100">
                  +{sub.val.toFixed(1)}
                  {def.unit}
                </span>
              </div>
            );
          })}

          {Array.from({ length: Math.max(0, 4 - item.subStats.length) }).map((_, emptyIdx) => (
            <div
              key={`empty-${emptyIdx}`}
              className="flex items-center justify-between rounded px-2 py-1 text-xs text-slate-500"
            >
              <span>（未解放スロット）</span>
              <span>+{SUBSTAT_STEP_INTERVAL}到達で解放</span>
            </div>
          ))}
        </div>

        {/* Comparison Card when inspecting Bag or Stash item */}
        {!isEquipped && equippedInSlot && (
          <div className="rounded-lg border border-slate-400/20 bg-slate-900/60 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-slate-400">
              <span className="shrink-0">現在装備中の{sInfo.label}と比較</span>
              <span className="truncate text-slate-300">
                {equippedInSlot.icon} <RarityName item={equippedInSlot} />{' '}
                {equippedInSlot.level > 0 && (
                  <span className="text-amber-400">+{equippedInSlot.level}</span>
                )}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-200">
              <span>
                {sInfo.mainLabel}:{' '}
                <strong>
                  +{fmt(eqMainVal)}
                  {sInfo.unit}
                </strong>
              </span>
              <span className="text-[10px] text-slate-400">
                {equippedInSlot.subStats.length}オプ
              </span>
            </div>
            {equippedInSlot.subStats.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                {equippedInSlot.subStats.map((sub, idx) => (
                  <span key={`${sub.key}-${idx}`}>
                    {SUB_MAP[sub.key].label}+{sub.val.toFixed(1)}%
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div
          data-testid="upgrade-feedback"
          className={
            upgradeFeedback
              ? 'rounded-md border border-amber-400/25 bg-amber-500/10 px-2 py-1 text-center text-xs font-bold text-amber-300'
              : 'hidden'
          }
        >
          {upgradeFeedback}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid shrink-0 grid-cols-2 gap-1.5 border-t border-white/10 pt-2">
        {!isEquipped && onEquipItem && (
          <button
            type="button"
            disabled={isRollingUpgrade}
            onClick={() => onEquipItem(item.id)}
            className={`${onMoveLocation ? '' : 'col-span-2'} whitespace-nowrap rounded-md border border-blue-400 bg-gradient-to-br from-blue-600 to-blue-700 px-2 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40`}
          >
            ⚔️ 装備する
          </button>
        )}

        {!isEquipped && onMoveLocation && (
          <button
            type="button"
            disabled={isRollingUpgrade || moveLocationDisabled}
            onClick={() => onMoveLocation(item.id)}
            className="whitespace-nowrap rounded-md border border-emerald-400/60 bg-emerald-700/35 px-2 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-600/45 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {location === 'bag' ? '📦 倉庫へ預ける' : '🎒 バッグへ戻す'}
          </button>
        )}

        <button
          type="button"
          data-testid="btn-detail-upgrade"
          disabled={isMaxLv || !canAfford || isRollingUpgrade}
          onClick={() => onUpgradeItem(item.id)}
          className="whitespace-nowrap rounded-md border border-amber-400 bg-gradient-to-br from-amber-700 to-amber-900 px-2 py-1.5 text-xs font-bold text-amber-100 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isMaxLv ? '🔨 最大強化済み' : `🔨 強化 (+1) [💎${fmt(upgCost)}]`}
        </button>

        <button
          type="button"
          disabled={isRollingUpgrade}
          onClick={() => onToggleLock(item.id)}
          className="whitespace-nowrap rounded-md border border-slate-400/25 bg-slate-800 px-2 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 disabled:opacity-40"
        >
          {item.locked ? '🔓 ロック解除' : '🔒 ロックする'}
        </button>

        {!isEquipped && onSalvageSingle && (
          <button
            type="button"
            disabled={item.locked || isRollingUpgrade}
            onClick={() => onSalvageSingle(item.id)}
            className="col-span-2 whitespace-nowrap rounded-md border border-red-400/50 bg-red-900/35 px-2 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-700/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {item.locked
              ? '🔒 ロック中は分解できません'
              : `💎 分解して強化石 +${fmt(salvageVal)} 獲得`}
          </button>
        )}
      </div>
    </div>
  );
}
