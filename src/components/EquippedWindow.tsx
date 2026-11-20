import { useState, type DragEvent } from 'react';
import {
  MAX_BAG_SIZE,
  MAX_EQUIP_LEVEL,
  MAX_STASH_SIZE,
  MYTHIC_MAX_EQUIP_LEVEL,
  RARITIES,
  SLOT_ORDER,
  SLOTS,
  SUB_MAP,
  SUBSTAT_STEP_INTERVAL,
} from '../game/constants';
import { fmt, getMainStatVal } from '../game/items';
import type { DragItemPayload, EquippedSet, SlotKey, WindowKey } from '../game/types';
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
  bagCount: number;
  stashCount: number;
  selectedSlot: SlotKey;
  draggedItem: DragItemPayload | null;
  isRollingUpgrade: boolean;
  rouletteActiveIdx: number | null;
  lastBoostedSubIdx: number | null;
  upgradeFeedback: string;
  onFocus: () => void;
  onMovePosition: (pos: WindowPos) => void;
  onResizeWindow: (size: WindowSize) => void;
  onSelectSlot: (slot: SlotKey) => void;
  onDropEquip: (payload: DragItemPayload) => void;
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
  const [hoveredSlot, setHoveredSlot] = useState<SlotKey | null>(null);

  const activeItem = equipped[selectedSlot];

  const handleSlotDragOver = (e: DragEvent<HTMLElement>, slotKey: SlotKey) => {
    if (!draggedItem || isRollingUpgrade) return;
    if (draggedItem.slot !== slotKey) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (hoveredSlot !== slotKey) setHoveredSlot(slotKey);
  };

  const handleSlotDrop = (e: DragEvent<HTMLElement>, slotKey: SlotKey) => {
    e.preventDefault();
    setHoveredSlot(null);
    if (!draggedItem || isRollingUpgrade) return;
    if (draggedItem.slot !== slotKey) return;
    onDropEquip(draggedItem);
  };

  const handleContainerDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!draggedItem || isRollingUpgrade) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHoveredSlot(draggedItem.slot);
  };

  const handleContainerDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHoveredSlot(null);
    if (!draggedItem || isRollingUpgrade) return;
    onDropEquip(draggedItem);
  };

  return (
    <FloatingWindow
      id="equipped-window"
      ariaLabel="装備中の武具"
      open={open}
      zIndex={zIndex}
      position={position}
      size={windowSize}
      minSize={{ width: 520, height: 480 }}
      isDropOver={Boolean(draggedItem && hoveredSlot === draggedItem.slot)}
      dropHintText={
        draggedItem
          ? `⚔️ ドロップして「${SLOTS[draggedItem.slot].label}」に装備する`
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
          <span>🛡️ 装備中</span>
          <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/35 bg-sky-400/10 px-2 py-0.5 text-xs font-bold text-sky-200">
            💎 {fmt(stones)}
          </span>
          <span className="hidden text-[11px] font-medium text-slate-400 xl:inline">
            Lv{MAX_EQUIP_LEVEL}（神話Lv{MYTHIC_MAX_EQUIP_LEVEL}）・+{SUBSTAT_STEP_INTERVAL}毎解放
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
      <div className="grid min-h-0 flex-1 grid-cols-[230px_minmax(0,1fr)] overflow-hidden max-md:flex max-md:flex-col">
        {/* Desktop Left Column: 6 Equipped Drop Slots */}
        <div className="hidden min-h-0 flex-col gap-1.5 border-r border-slate-400/20 p-2.5 md:flex">
          <div className="text-[11px] font-bold text-slate-400">
            装備スロット（D&Dで付け替え可）
          </div>
          <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
            {SLOT_ORDER.map((slotKey) => {
              const it = equipped[slotKey];
              const sInfo = SLOTS[slotKey];
              const rInfo = RARITIES[it.rarity];
              const selected = selectedSlot === slotKey;
              const isDropCandidate = draggedItem?.slot === slotKey;
              const isHovered = hoveredSlot === slotKey && isDropCandidate;

              return (
                <button
                  key={it.id}
                  type="button"
                  data-slot-card={slotKey}
                  onClick={() => !isRollingUpgrade && onSelectSlot(slotKey)}
                  onDragOver={(e) => handleSlotDragOver(e, slotKey)}
                  onDrop={(e) => handleSlotDrop(e, slotKey)}
                  className={`flex w-full flex-col rounded-lg border px-2.5 py-1.5 text-left transition ${
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
                    <span className="truncate text-xs font-bold">
                      {it.icon} <RarityName item={it} />{' '}
                      {it.level > 0 && <span className="text-amber-400">+{it.level}</span>}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {isDropCandidate ? (
                        <span className="font-bold text-emerald-300">⬇ここへ</span>
                      ) : (
                        <>
                          {it.locked ? '🔒 ' : ''}
                          {sInfo.isFixedCap ? '固定上限' : `St.${it.stage}`}
                        </>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-100">
                    {sInfo.mainLabel}:{' '}
                    <strong>
                      +{fmt(getMainStatVal(it))}
                      {sInfo.unit}
                    </strong>{' '}
                    {it.rarity === 4 && (
                      <span className="mythic-text text-[10px] font-extrabold">[上限+{MYTHIC_MAX_EQUIP_LEVEL}]</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-slate-400">
                    {it.subStats.map((s) => `${SUB_MAP[s.key].label}+${s.val.toFixed(1)}%`).join(' / ')}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Mobile Top Compact 6-Slot Selector */}
        <div className="grid shrink-0 grid-cols-3 gap-1.5 border-b border-slate-400/20 bg-slate-900/60 p-2 max-[420px]:grid-cols-2 md:hidden">
          {SLOT_ORDER.map((slotKey) => {
            const it = equipped[slotKey];
            const sInfo = SLOTS[slotKey];
            const rInfo = RARITIES[it.rarity];
            const selected = selectedSlot === slotKey;
            return (
              <button
                key={it.id}
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
                    {it.icon} {sInfo.label}
                  </span>
                  <span className="shrink-0 text-[10px] text-amber-400">
                    {it.level > 0 ? `+${it.level}` : 'Lv0'}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-slate-200">
                  {sInfo.mainLabel} +{fmt(getMainStatVal(it))}
                  {sInfo.unit}
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
            equippedInSlot={activeItem}
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
    </FloatingWindow>
  );
}
