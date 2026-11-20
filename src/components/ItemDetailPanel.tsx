import {
  MAX_EQUIP_LEVEL,
  MYTHIC_MAX_EQUIP_LEVEL,
  PERSONAL_SLOTS,
  RARITIES,
  SLOTS,
  SUB_MAP,
  SUBSTAT_STEP_INTERVAL,
  UNIQUE_AFFIX_MAP,
} from '../game/constants';
import {
  fmt,
  formatStatDiff,
  getItemRollQuality,
  getMainStatVal,
  getMaxEquipLevel,
  getReforgeCost,
  getSalvageValue,
  getUpgradeCost,
} from '../game/items';
import { JOB_DEFS } from '../game/party';
import type { Item, ItemLocation, JobId, PartyMemberState } from '../game/types';
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
  onReforgeSubstat?: (id: string, subIdx: number) => void;
  onToggleLock: (id: string) => void;
  onSalvageSingle?: (id: string) => void;
  salvageBonusPct?: number;
  targetMemberLabel?: string;
  selectableMembers?: PartyMemberState[];
  selectedMemberId?: JobId;
  onSelectMember?: (id: JobId) => void;
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
  onReforgeSubstat,
  onToggleLock,
  onSalvageSingle,
  salvageBonusPct = 0,
  targetMemberLabel,
  selectableMembers,
  selectedMemberId,
  onSelectMember,
}: ItemDetailPanelProps) {
  if (!item) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs leading-relaxed text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  const isEquipped = location === 'equipped';
  const isPersonalSlot = PERSONAL_SLOTS.includes(item.slot);
  const rInfo = RARITIES[item.rarity];
  const sInfo = SLOTS[item.slot];
  const upgCost = getUpgradeCost(item);
  const reforgeCost = getReforgeCost(item);
  const maxLv = getMaxEquipLevel(item);
  const isMaxLv = item.level >= maxLv;
  const canAfford = stones >= upgCost;
  const canAffordReforge = stones >= reforgeCost;
  const nextBoostLv = item.level + (SUBSTAT_STEP_INTERVAL - (item.level % SUBSTAT_STEP_INTERVAL));
  const salvageVal = getSalvageValue(item, salvageBonusPct);
  const quality = getItemRollQuality(item);
  const affixDef = item.uniqueAffix ? UNIQUE_AFFIX_MAP[item.uniqueAffix.key] : null;

  const mainVal = getMainStatVal(item);
  const eqMainVal = equippedInSlot ? getMainStatVal(equippedInSlot) : 0;
  const mainDiff = mainVal - eqMainVal;
  const diffInfo = formatStatDiff(mainDiff, sInfo.unit);

  const qualityClass =
    quality.grade === 'S'
      ? 'border-amber-300/70 bg-amber-400/20 text-amber-200'
      : quality.grade === 'A'
        ? 'border-sky-400/60 bg-sky-500/20 text-sky-200'
        : quality.grade === 'B'
          ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-200'
          : 'border-slate-500/45 bg-slate-700/40 text-slate-300';

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
            <div className="flex shrink-0 items-center gap-1">
              <span
                title="サブステ・特性ロール品質（高いほど厳選良品）"
                className={`rounded border px-1.5 py-0.5 text-[10px] font-extrabold ${qualityClass}`}
              >
                品質{quality.pct}% [{quality.grade}]
              </span>
              <span
                className="rounded border px-1.5 py-0.5 text-[10px] font-bold"
                style={{ color: rInfo.color, borderColor: rInfo.color }}
              >
                {rInfo.name}
              </span>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-[11px] text-slate-300">
            <span>
              {sInfo.label}（{isPersonalSlot ? '個人装備' : '共有遺物'}） /{' '}
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

        {/* Unique Affix Callout */}
        {item.uniqueAffix && affixDef && (
          <div
            data-testid="item-unique-affix"
            className="rounded-lg border border-fuchsia-400/50 bg-fuchsia-950/35 px-2.5 py-1.5"
          >
            <div className="flex items-center justify-between text-[11px] font-extrabold text-fuchsia-200">
              <span>
                {affixDef.icon} 固有特性：{affixDef.label}
              </span>
              <span className="rounded bg-fuchsia-500/25 px-1.5 py-0.2 text-[10px] text-fuchsia-100">
                レア刻印
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-fuchsia-100/90">
              {affixDef.desc(item.uniqueAffix.val)}
            </div>
          </div>
        )}

        {/* Quick target selector for personal equipment in Bag/Stash */}
        {!isEquipped && isPersonalSlot && selectableMembers && onSelectMember && selectedMemberId && (
          <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-sky-400/25 bg-sky-950/30 px-2.5 py-1.5">
            <span className="text-[10px] font-bold text-sky-200">装備・比較対象キャラ:</span>
            <div className="flex flex-wrap gap-1">
              {selectableMembers.map((m) => {
                const d = JOB_DEFS[m.id];
                const active = m.id === selectedMemberId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelectMember(m.id)}
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-bold transition ${
                      active
                        ? 'border-sky-300 bg-sky-500/35 text-white'
                        : 'border-slate-500/40 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {d.icon} {d.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
              {item.subStats.length < 4 ? '新規解放' : 'ランダム成長'}・1枠のみ再鍛造可）
            </span>
            {!isMaxLv && <span className="text-amber-400">次: +{nextBoostLv}</span>}
          </div>

          {item.subStats.map((sub, sIdx) => {
            const def = SUB_MAP[sub.key];
            const isRoulette = rouletteActiveIdx === sIdx;
            const isFlashed = lastBoostedSubIdx === sIdx;
            const isReforgedSlot = item.reforgedSubIdx === sIdx;
            const canReforgeThisSlot =
              Boolean(onReforgeSubstat) &&
              (item.reforgedSubIdx === null ||
                item.reforgedSubIdx === undefined ||
                item.reforgedSubIdx === sIdx);

            return (
              <div
                key={`${sub.key}-${sIdx}`}
                data-sub-idx={sIdx}
                className={`flex items-center justify-between gap-1.5 rounded px-2 py-1 text-xs transition ${
                  isRoulette
                    ? 'bg-sky-400/35 ring-1 ring-sky-400'
                    : isFlashed
                      ? 'bg-amber-400/30 ring-1 ring-amber-400'
                      : isReforgedSlot
                        ? 'bg-fuchsia-500/10 ring-1 ring-fuchsia-400/35'
                        : 'bg-white/[0.02]'
                }`}
              >
                <span className="min-w-0 truncate text-slate-200">
                  {def.label}
                  {sub.boosts > 0 && (
                    <span className="ml-1.5 rounded border border-amber-400/45 bg-amber-500/20 px-1 text-[10px] font-extrabold text-amber-300">
                      ▲{sub.boosts}
                    </span>
                  )}
                  {isReforgedSlot && (
                    <span className="ml-1 rounded bg-fuchsia-500/25 px-1 text-[9px] font-bold text-fuchsia-200">
                      再鍛造枠
                    </span>
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="font-bold text-slate-100">
                    +{sub.val.toFixed(1)}
                    {def.unit}
                  </span>
                  {canReforgeThisSlot && onReforgeSubstat && (
                    <button
                      type="button"
                      data-testid={`btn-reforge-sub-${sIdx}`}
                      disabled={!canAffordReforge || isRollingUpgrade}
                      title="このサブステ枠を別のステータスへ抽選し直します（1装備につき1枠のみ固定）"
                      onClick={() => onReforgeSubstat(item.id, sIdx)}
                      className="rounded border border-fuchsia-400/55 bg-fuchsia-900/45 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-100 transition hover:bg-fuchsia-800/60 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      🎲 💎{fmt(reforgeCost)}
                    </button>
                  )}
                </div>
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
              <span className="shrink-0">
                {isPersonalSlot && targetMemberLabel
                  ? `${targetMemberLabel}の${sInfo.label}と比較`
                  : `現在の共有${sInfo.label}と比較`}
              </span>
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
            {isPersonalSlot && targetMemberLabel ? `⚔️ ${targetMemberLabel}に装備` : '✨ 共有遺物に装備'}
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
