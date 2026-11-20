import { useState, type DragEvent } from 'react';
import {
  MAX_BAG_SIZE,
  MAX_STASH_SIZE,
  MYTHIC_MAX_EQUIP_LEVEL,
  PERSONAL_SLOTS,
  RARITIES,
  SHARED_ARTIFACT_SLOTS,
  SLOT_ORDER,
  SLOTS,
  SUB_MAP,
  UNIQUE_AFFIX_MAP,
} from '../game/constants';
import { fmt, getMainStatVal } from '../game/items';
import {
  calcPartyMemberStats,
  getActiveMembers,
  getMemberEquippedSet,
  JOB_DEFS,
  JOB_ORDER,
} from '../game/party';
import type {
  DragItemPayload,
  EquippedSet,
  JobId,
  PartyState,
  SlotKey,
  WindowKey,
} from '../game/types';
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
  party: PartyState;
  cleared100: boolean;
  selectedMemberId: JobId;
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
  onSelectMember: (id: JobId) => void;
  onSelectSlot: (slot: SlotKey) => void;
  onDropEquip: (payload: DragItemPayload) => void;
  onUpgradeItem: (id: string) => void;
  onReforgeSubstat: (id: string, subIdx: number) => void;
  onAutoEquip: (memberId: JobId) => void;
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
  party,
  cleared100,
  selectedMemberId,
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
  onSelectMember,
  onSelectSlot,
  onDropEquip,
  onUpgradeItem,
  onReforgeSubstat,
  onAutoEquip,
  onToggleLock,
  onOpenWindow,
  onClose,
}: EquippedWindowProps) {
  const [hoveredSlot, setHoveredSlot] = useState<SlotKey | null>(null);

  const member = party.roster[selectedMemberId] ?? party.roster[party.activeIds[0]];
  const memberDef = JOB_DEFS[member.id];
  const memberEquipped = getMemberEquippedSet(member, equipped);
  const activeMembers = getActiveMembers(party);
  const memberStats = calcPartyMemberStats(member, equipped, cleared100, activeMembers);
  const unlockedMembers = JOB_ORDER.map((id) => party.roster[id]).filter((m) => m.unlocked);
  const activeItem = memberEquipped[selectedSlot];

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

  const renderSlotCard = (slotKey: SlotKey) => {
    const it = memberEquipped[slotKey];
    const sInfo = SLOTS[slotKey];
    const rInfo = RARITIES[it.rarity];
    const selected = selectedSlot === slotKey;
    const isDropCandidate = draggedItem?.slot === slotKey;
    const isHovered = hoveredSlot === slotKey && isDropCandidate;
    const affix = it.uniqueAffix ? UNIQUE_AFFIX_MAP[it.uniqueAffix.key] : null;

    return (
      <button
        key={`${member.id}-${slotKey}-${it.id}`}
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
        <div className="mt-0.5 flex items-center justify-between gap-1 text-[11px] text-slate-100">
          <span>
            {sInfo.mainLabel}:{' '}
            <strong>
              +{fmt(getMainStatVal(it))}
              {sInfo.unit}
            </strong>{' '}
            {it.rarity === 4 && (
              <span className="mythic-text text-[10px] font-extrabold">[+{MYTHIC_MAX_EQUIP_LEVEL}]</span>
            )}
          </span>
          {affix && (
            <span className="shrink-0 rounded bg-fuchsia-500/25 px-1 text-[9px] font-bold text-fuchsia-200">
              {affix.icon} {affix.label}
            </span>
          )}
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
      isDropOver={Boolean(draggedItem && hoveredSlot === draggedItem.slot)}
      dropHintText={
        draggedItem
          ? PERSONAL_SLOTS.includes(draggedItem.slot)
            ? `⚔️ ドロップして ${memberDef.name} の「${SLOTS[draggedItem.slot].label}」に装備`
            : `✨ ドロップしてパーティ共有「${SLOTS[draggedItem.slot].label}」に装備`
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
          <button
            type="button"
            data-testid="btn-auto-equip"
            disabled={isRollingUpgrade}
            onClick={() => onAutoEquip(member.id)}
            title="バッグ内からより強い個人装備・共有遺物を自動で付け替えます"
            className="rounded-md border border-amber-400/60 bg-amber-600/25 px-2 py-0.5 text-[11px] font-extrabold text-amber-200 transition hover:bg-amber-600/40 disabled:opacity-40"
          >
            ⚡ おまかせ装備
          </button>
        </>
      }
      headerRight={
        <>
          <button
            type="button"
            disabled={isRollingUpgrade}
            onClick={() => onOpenWindow('party')}
            className="rounded-md border border-purple-400/60 bg-purple-600/25 px-2 py-1 text-[11px] font-bold text-purple-100 transition hover:bg-purple-600/40 disabled:opacity-40"
          >
            👥 編成
          </button>
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
        {/* Top Party Member Switcher Bar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-400/20 bg-slate-900/75 px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {unlockedMembers.map((m) => {
              const d = JOB_DEFS[m.id];
              const isSelected = m.id === member.id;
              const isActive = party.activeIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`equip-member-tab-${m.id}`}
                  disabled={isRollingUpgrade}
                  onClick={() => onSelectMember(m.id)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold transition ${
                    isSelected
                      ? 'border-sky-300 bg-sky-500/25 text-white ring-1 ring-sky-400/70'
                      : 'border-slate-500/35 bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span>{d.icon}</span>
                  <span>{d.name}</span>
                  <span className="text-[10px] text-slate-400">Lv.{m.level}</span>
                  {!isActive && <span className="text-[9px] text-slate-500">(控)</span>}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-300">
            <span>
              ATK <strong className="text-white">{fmt(Math.round(memberStats.atk))}</strong>
            </span>
            <span>
              HP <strong className="text-emerald-300">{fmt(memberStats.hp)}</strong>
            </span>
            <span>
              会心 <strong className="text-amber-300">{memberStats.critRate.toFixed(0)}%</strong>
            </span>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] overflow-hidden max-md:flex max-md:flex-col">
          {/* Desktop Left Column: Personal (2) + Shared Artifacts (4) */}
          <div className="hidden min-h-0 flex-col gap-1.5 border-r border-slate-400/20 p-2.5 md:flex">
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
              <div className="flex items-center justify-between text-[10px] font-extrabold text-amber-300">
                <span>👤 {memberDef.name}の個人装備（2枠）</span>
                <span className="font-normal text-slate-400">D&D可</span>
              </div>
              {PERSONAL_SLOTS.map((slotKey) => renderSlotCard(slotKey))}

              <div className="mt-1 flex items-center justify-between border-t border-white/10 pt-1.5 text-[10px] font-extrabold text-sky-300">
                <span>✨ パーティ共有遺物（4枠）</span>
                <span className="font-normal text-slate-400">全員適用</span>
              </div>
              {SHARED_ARTIFACT_SLOTS.map((slotKey) => renderSlotCard(slotKey))}
            </div>
          </div>

          {/* Mobile Top Compact 6-Slot Selector */}
          <div className="grid shrink-0 grid-cols-3 gap-1.5 border-b border-slate-400/20 bg-slate-900/60 p-2 max-[420px]:grid-cols-2 md:hidden">
            {SLOT_ORDER.map((slotKey) => {
              const it = memberEquipped[slotKey];
              const sInfo = SLOTS[slotKey];
              const rInfo = RARITIES[it.rarity];
              const selected = selectedSlot === slotKey;
              return (
                <button
                  key={`${member.id}-${slotKey}-${it.id}`}
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
              onReforgeSubstat={onReforgeSubstat}
              onToggleLock={onToggleLock}
            />
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}
