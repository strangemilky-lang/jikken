import { useState, type DragEvent } from 'react';
import { getAccessoryCombo } from '../game/accessories';
import {
  EQUIP_SLOT_ORDER,
  EQUIP_SLOTS,
  MAX_BAG_SIZE,
  MAX_STASH_SIZE,
  MYTHIC_MAX_EQUIP_LEVEL,
  RARITIES,
  SUB_MAP,
} from '../game/constants';
import { calcHeroStats, fmt, getItemMainStatMeta, getMainStatVal } from '../game/items';
import type { DragItemPayload, EquipSlotKey, EquippedSet, WindowKey } from '../game/types';
import { FloatingWindow, type WindowPos, type WindowSize } from './FloatingWindow';
import { ItemDetailPanel } from './ItemDetailPanel';
import { RarityName } from './RarityName';

interface EquippedWindowProps {
  open: boolean;
  zIndex: number;
  position: WindowPos;
  windowSize: WindowSize;
  stones: number;
  equipped: EquippedSet;
  cleared100: boolean;
  bagCount: number;
  stashCount: number;
  selectedSlot: EquipSlotKey;
  draggedItem: DragItemPayload | null;
  isRollingUpgrade: boolean;
  rouletteActiveIdx: number | null;
  lastBoostedSubIdx: number | null;
  upgradeFeedback: string;
  onFocus: () => void;
  onMovePosition: (pos: WindowPos) => void;
  onResizeWindow: (size: WindowSize) => void;
  onSelectSlot: (slot: EquipSlotKey) => void;
  onDropEquip: (payload: DragItemPayload, targetSlot?: EquipSlotKey) => void;
  onUpgradeItem: (id: string) => void;
  onToggleLock: (id: string) => void;
  onOpenWindow: (win: WindowKey) => void;
  onClose: () => void;
}

export function EquippedWindow({
  open,
  zIndex,
  position,
  windowSize,
  stones,
  equipped,
  cleared100,
  bagCount,
  stashCount,
  selectedSlot,
  draggedItem,
  isRollingUpgrade,
  rouletteActiveIdx,
  lastBoostedSubIdx,
  upgradeFeedback,
  onFocus,
  onMovePosition,
  onResizeWindow,
  onSelectSlot,
  onDropEquip,
  onUpgradeItem,
  onToggleLock,
  onOpenWindow,
  onClose,
}: EquippedWindowProps) {
  const [hoveredSlot, setHoveredSlot] = useState<EquipSlotKey | null>(null);

  const stats = calcHeroStats(equipped, cleared100);
  const combo = getAccessoryCombo(equipped.acc1, equipped.acc2);
  const activeItem = equipped[selectedSlot];

  const canSlotAccept = (slotKey: EquipSlotKey, payload: DragItemPayload | null) => {
    if (!payload) return false;
    return EQUIP_SLOTS[slotKey].acceptsItemSlot === payload.slot;
  };

  const handleSlotDragOver = (e: DragEvent<HTMLElement>, slotKey: EquipSlotKey) => {
    if (!draggedItem || isRollingUpgrade) return;
    if (!canSlotAccept(slotKey, draggedItem)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (hoveredSlot !== slotKey) setHoveredSlot(slotKey);
  };

  const handleSlotDrop = (e: DragEvent<HTMLElement>, slotKey: EquipSlotKey) => {
    e.preventDefault();
    e.stopPropagation();
    setHoveredSlot(null);
    if (!draggedItem || isRollingUpgrade) return;
    if (!canSlotAccept(slotKey, draggedItem)) return;
    onDropEquip(draggedItem, slotKey);
  };

  const handleContainerDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!draggedItem || isRollingUpgrade) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const fallbackSlot: EquipSlotKey =
      draggedItem.slot === 'accessory'
        ? selectedSlot === 'acc1' || selectedSlot === 'acc2'
          ? selectedSlot
          : 'acc1'
        : draggedItem.slot;
    setHoveredSlot(fallbackSlot);
  };

  const handleContainerDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = hoveredSlot ?? undefined;
    setHoveredSlot(null);
    if (!draggedItem || isRollingUpgrade) return;
    onDropEquip(draggedItem, target);
  };

  const renderSlotCard = (slotKey: EquipSlotKey) => {
    const it = equipped[slotKey];
    const slotDef = EQUIP_SLOTS[slotKey];
    const meta = getItemMainStatMeta(it);
    const rInfo = RARITIES[it.rarity];
    const selected = selectedSlot === slotKey;
    const isDropCandidate = canSlotAccept(slotKey, draggedItem);
    const isHovered = hoveredSlot === slotKey && isDropCandidate;

    return (
      <button
        key={`${slotKey}-${it.id}`}
        type="button"
        data-slot-card={slotKey}
        onClick={() => !isRollingUpgrade && onSelectSlot(slotKey)}
        onDragOver={(e) => handleSlotDragOver(e, slotKey)}
        onDrop={(e) => handleSlotDrop(e, slotKey)}
        className={`flex w-full flex-col rounded-lg border px-2.5 py-2 text-left transition ${
          isHovered
            ? 'bg-emerald-500/25 ring-2 ring-emerald-400'
            : isDropCandidate
              ? 'ring-2 ring-emerald-400/70'
              : selected
                ? 'ring-2 ring-sky-400'
                : 'hover:brightness-110'
        }`}
        style={{ borderColor: isDropCandidate ? '#34d399' : rInfo.border, background: rInfo.bg }}
      >
        <div className="flex w-full items-center justify-between gap-1">
          <span className="text-[10px] font-extrabold text-slate-300">
            {slotDef.label}
            {meta.axisDef && (
              <span
                className="ml-1.5 rounded px-1 py-0.2 text-[9px] font-bold"
                style={{ color: meta.axisDef.color, background: meta.axisDef.bgTint }}
              >
                {meta.axisDef.icon} {meta.axisDef.name}
              </span>
            )}
          </span>
          <span className="shrink-0 text-[10px] text-slate-400">
            {isDropCandidate ? (
              <span className="font-bold text-emerald-300">⬇ここへ</span>
            ) : (
              <>
                {it.locked ? '🔒 ' : ''}
                {meta.isFixedCap ? '固定上限' : `St.${it.stage}`}
              </>
            )}
          </span>
        </div>
        <div className="mt-0.5 flex w-full items-center justify-between gap-1">
          <span className="truncate text-xs font-bold">
            {it.icon} <RarityName item={it} />{' '}
            {it.level > 0 && <span className="text-amber-400">+{it.level}</span>}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-1 text-[11px] text-slate-100">
          <span>
            {meta.mainLabel}:{' '}
            <strong>
              +{fmt(getMainStatVal(it))}
              {meta.unit}
            </strong>{' '}
            {it.rarity === 4 && (
              <span className="mythic-text text-[10px] font-extrabold">[+{MYTHIC_MAX_EQUIP_LEVEL}]</span>
            )}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-slate-400">
          {it.subStats.map((s) => `${SUB_MAP[s.key].label}+${s.val.toFixed(1)}%`).join(' / ')}
        </div>
      </button>
    );
  };

  return (
    <FloatingWindow
      id="equipped-window"
      ariaLabel="装備中の武具"
      open={open}
      zIndex={zIndex}
      position={position}
      size={windowSize}
      minSize={{ width: 540, height: 500 }}
      isDropOver={Boolean(draggedItem && hoveredSlot && canSlotAccept(hoveredSlot, draggedItem))}
      dropHintText={
        draggedItem
          ? draggedItem.slot === 'accessory'
            ? '💍 アクセ1またはアクセ2にドロップして装着'
            : `⚔️ ドロップして「${EQUIP_SLOTS[draggedItem.slot].label}」に装備`
          : undefined
      }
      onFocus={onFocus}
      onMovePosition={onMovePosition}
      onResize={onResizeWindow}
      onDragOver={handleContainerDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHoveredSlot(null);
        }
      }}
      onDrop={handleContainerDrop}
      headerLeft={
        <>
          <span>🛡️ 装備中 (4枠)</span>
          <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/35 bg-sky-400/10 px-2 py-0.5 text-xs font-bold text-sky-200">
            💎 {fmt(stones)}
          </span>
        </>
      }
      headerRight={
        <>
          <button
            type="button"
            disabled={isRollingUpgrade}
            onClick={() => onOpenWindow('bag')}
            className="rounded-md border border-blue-400/60 bg-blue-600/25 px-2 py-1 text-[11px] font-bold text-blue-100 transition hover:bg-blue-600/40 disabled:opacity-40 md:hidden"
          >
            🎒 {bagCount}/{MAX_BAG_SIZE}
          </button>
          <button
            type="button"
            disabled={isRollingUpgrade}
            onClick={() => onOpenWindow('stash')}
            className="rounded-md border border-emerald-400/50 bg-emerald-600/25 px-2 py-1 text-[11px] font-bold text-emerald-100 transition hover:bg-emerald-600/40 disabled:opacity-40 md:hidden"
          >
            📦 {stashCount}/{MAX_STASH_SIZE}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isRollingUpgrade}
            className="rounded-md border border-slate-400/25 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 disabled:opacity-40"
          >
            ✕ 閉じる
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Hero Combat Summary Bar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-400/20 bg-slate-900/75 px-3 py-1.5 text-[11px] text-slate-300">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              攻撃 <strong className="text-white">{fmt(Math.round(stats.atk))}</strong>
            </span>
            <span>
              HP <strong className="text-emerald-300">{fmt(stats.hp)}</strong>
            </span>
            <span>
              連撃 <strong className="text-sky-300">{Math.round(stats.multiHitRate)}%</strong>
            </span>
            <span>
              与ダメ <strong className="text-rose-300">+{stats.dmgPct.toFixed(0)}%</strong>
            </span>
            <span>
              会心 <strong className="text-amber-300">{stats.critRate.toFixed(0)}%</strong>
            </span>
            <span>
              会心倍 <strong className="text-amber-200">{Math.round(stats.critDmg)}%</strong>
            </span>
            <span>
              貫通 <strong className="text-purple-300">{Math.round(stats.rawArmorPen)}%</strong>
            </span>
          </div>
          <span className="text-[10px] text-slate-500">同種アクセ2個積みOK</span>
        </div>

        {/* Active 2-Accessory Resonance Combo Banner */}
        <div
          data-testid="resonance-combo-banner"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-400/20 px-3 py-1.5 text-xs"
          style={{ background: combo.badgeBg }}
        >
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">{combo.icons}</span>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-extrabold" style={{ color: combo.accentColor }}>
                共鳴：{combo.name}
              </span>
              <span className="text-[11px] text-slate-200">{combo.effectText}</span>
            </div>
          </div>
          <span className="rounded border border-white/15 bg-black/35 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
            演出: {combo.vfxLabel}
          </span>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)] overflow-hidden max-md:flex max-md:flex-col">
          {/* Desktop Left Column: 4 Spacious Slot Cards */}
          <div className="hidden min-h-0 flex-col gap-2 border-r border-slate-400/20 p-2.5 md:flex">
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
              {EQUIP_SLOT_ORDER.map((slotKey) => renderSlotCard(slotKey))}
            </div>
          </div>

          {/* Mobile Top Compact 2x2 Slot Selector */}
          <div className="grid shrink-0 grid-cols-2 gap-1.5 border-b border-slate-400/20 bg-slate-900/60 p-2 md:hidden">
            {EQUIP_SLOT_ORDER.map((slotKey) => {
              const it = equipped[slotKey];
              const slotDef = EQUIP_SLOTS[slotKey];
              const meta = getItemMainStatMeta(it);
              const rInfo = RARITIES[it.rarity];
              const selected = selectedSlot === slotKey;
              return (
                <button
                  key={`${slotKey}-${it.id}`}
                  type="button"
                  data-mobile-slot-card={slotKey}
                  onClick={() => !isRollingUpgrade && onSelectSlot(slotKey)}
                  className={`flex min-w-0 flex-col rounded-lg border px-2 py-1.5 text-left transition ${
                    selected ? 'ring-2 ring-sky-400' : 'opacity-85 hover:opacity-100'
                  }`}
                  style={{ borderColor: rInfo.border, background: rInfo.bg }}
                >
                  <div className="flex items-center justify-between gap-1 text-[11px] font-bold">
                    <span className="truncate">
                      {it.icon} {slotDef.shortLabel}
                    </span>
                    <span className="shrink-0 text-[10px] text-amber-400">
                      {it.level > 0 ? `+${it.level}` : 'Lv0'}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-slate-200">
                    {meta.mainLabel} +{fmt(getMainStatVal(it))}
                    {meta.unit}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right / Bottom: Spacious Detail & Upgrade Panel */}
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <ItemDetailPanel
              item={activeItem}
              location="equipped"
              equipped={equipped}
              stones={stones}
              isRollingUpgrade={isRollingUpgrade}
              rouletteActiveIdx={rouletteActiveIdx}
              lastBoostedSubIdx={lastBoostedSubIdx}
              upgradeFeedback={upgradeFeedback}
              emptyMessage="スロットを選択してください。"
              onUpgradeItem={onUpgradeItem}
              onToggleLock={onToggleLock}
            />
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}
