import { useState, type DragEvent } from 'react';
import { MAX_BAG_SIZE, MAX_STASH_SIZE, RARITIES, SLOT_ORDER, SLOTS, SUB_MAP } from '../game/constants';
import { fmt, formatStatDiff, getMainStatVal } from '../game/items';
import type {
  DragItemPayload,
  EquippedSet,
  Item,
  ItemLocation,
  SalvageBulkMode,
  SlotKey,
  SortMode,
  WindowKey,
} from '../game/types';
import { FloatingWindow, type WindowPos, type WindowSize } from './FloatingWindow';
import { ItemDetailPanel } from './ItemDetailPanel';
import { RarityName } from './RarityName';

interface StorageWindowProps {
  location: ItemLocation;
  open: boolean;
  zIndex: number;
  position: WindowPos;
  windowSize: WindowSize;
  stones: number;
  equipped: EquippedSet;
  items: Item[];
  otherCount: number;
  filterSlot: 'all' | SlotKey;
  sortMode: SortMode;
  selectedItemId: string | null;
  mobileShowDetail: boolean;
  draggedItem: DragItemPayload | null;
  isRollingUpgrade: boolean;
  rouletteActiveIdx: number | null;
  lastBoostedSubIdx: number | null;
  upgradeFeedback: string;
  onFocus: () => void;
  onMovePosition: (pos: WindowPos) => void;
  onResizeWindow: (size: WindowSize) => void;
  onChangeFilter: (slot: 'all' | SlotKey) => void;
  onChangeSort: (mode: SortMode) => void;
  onSelectItem: (id: string) => void;
  onBackToList: () => void;
  onEquipItem: (id: string) => void;
  onMoveItem: (id: string) => void;
  onUpgradeItem: (id: string) => void;
  onToggleLock: (id: string) => void;
  onSalvageSingle: (id: string) => void;
  onSalvageBulk?: (mode: SalvageBulkMode) => void;
  onDragStartItem: (payload: DragItemPayload) => void;
  onDragEndItem: () => void;
  onDropFromOther: (payload: DragItemPayload) => void;
  onOpenWindow: (win: WindowKey) => void;
  onClose: () => void;
  salvageBonusPct?: number;
}

export function StorageWindow({
  location,
  open,
  zIndex,
  position,
  windowSize,
  stones,
  equipped,
  items,
  otherCount,
  filterSlot,
  sortMode,
  selectedItemId,
  mobileShowDetail,
  draggedItem,
  isRollingUpgrade,
  rouletteActiveIdx,
  lastBoostedSubIdx,
  upgradeFeedback,
  onFocus,
  onMovePosition,
  onResizeWindow,
  onChangeFilter,
  onChangeSort,
  onSelectItem,
  onBackToList,
  onEquipItem,
  onMoveItem,
  onUpgradeItem,
  onToggleLock,
  onSalvageSingle,
  onSalvageBulk,
  onDragStartItem,
  onDragEndItem,
  onDropFromOther,
  onOpenWindow,
  onClose,
  salvageBonusPct = 0,
}: StorageWindowProps) {
  const [isDropHover, setIsDropHover] = useState(false);

  const isBag = location === 'bag';
  const maxCapacity = isBag ? MAX_BAG_SIZE : MAX_STASH_SIZE;
  const otherMax = isBag ? MAX_STASH_SIZE : MAX_BAG_SIZE;
  const isOtherFull = otherCount >= otherMax;
  const canAcceptDrop = Boolean(draggedItem && draggedItem.source !== location && items.length < maxCapacity);

  let filteredItems = items.filter((it) => filterSlot === 'all' || it.slot === filterSlot);
  if (sortMode === 'rarity') {
    filteredItems = [...filteredItems].sort((a, b) => b.rarity - a.rarity || b.stage - a.stage);
  } else if (sortMode === 'stage') {
    filteredItems = [...filteredItems].sort((a, b) => b.stage - a.stage || b.rarity - a.rarity);
  } else if (sortMode === 'level') {
    filteredItems = [...filteredItems].sort((a, b) => b.level - a.level || b.rarity - a.rarity);
  }

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;
  const showingMobileDetail = mobileShowDetail && selectedItem !== null;

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!canAcceptDrop || isRollingUpgrade) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isDropHover) setIsDropHover(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDropHover(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDropHover(false);
    if (!draggedItem || !canAcceptDrop || isRollingUpgrade) return;
    onDropFromOther(draggedItem);
  };

  return (
    <FloatingWindow
      id={isBag ? 'bag-window' : 'stash-window'}
      ariaLabel={isBag ? 'バッグ（ドロップ一時保管）' : '倉庫（永久保管庫）'}
      open={open}
      zIndex={zIndex}
      position={position}
      size={windowSize}
      minSize={{ width: 580, height: 480 }}
      isDropOver={isDropHover && canAcceptDrop}
      dropHintText={
        isBag ? '🎒 ドロップしてバッグへ戻す' : '📦 ドロップして倉庫へ預ける（一括分解から保護）'
      }
      onFocus={onFocus}
      onMovePosition={onMovePosition}
      onResize={onResizeWindow}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      headerLeft={
        <>
          <span>
            {isBag ? '🎒 バッグ' : '📦 倉庫'} ({items.length}/{maxCapacity})
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/35 bg-sky-400/10 px-2 py-0.5 text-xs font-bold text-sky-200">
            💎 {fmt(stones)}
          </span>
          <span className="hidden text-[11px] font-medium text-slate-400 lg:inline">
            {isBag ? 'ドラッグで装備／倉庫へ移動' : '一括分解対象外・長期保管'}
          </span>
        </>
      }
      headerRight={
        <>
          <button
            type="button"
            disabled={isRollingUpgrade}
            onClick={() => onOpenWindow('equipped')}
            className="rounded-md border border-sky-400/50 bg-sky-500/20 px-2 py-1 text-[11px] font-bold text-sky-100 transition hover:bg-sky-500/35 disabled:opacity-40 md:hidden"
          >
            🛡️ 装備
          </button>
          <button
            type="button"
            disabled={isRollingUpgrade}
            onClick={() => onOpenWindow(isBag ? 'stash' : 'bag')}
            className="rounded-md border border-emerald-400/50 bg-emerald-600/25 px-2 py-1 text-[11px] font-bold text-emerald-100 transition hover:bg-emerald-600/40 disabled:opacity-40 md:hidden"
          >
            {isBag ? `📦 倉庫(${otherCount})` : `🎒 バッグ(${otherCount})`}
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
      {/* Body: Desktop 2-Pane / Mobile Master-Detail */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_330px] overflow-hidden max-lg:grid-cols-[minmax(0,1fr)_300px] max-md:flex max-md:flex-col">
        {/* Left / Master Pane: Filter, Sort, Draggable List, Bulk Salvage or Stash Note */}
        <div
          className={`flex min-h-0 flex-1 flex-col gap-2 border-r border-slate-400/20 p-2.5 max-md:border-r-0 ${
            showingMobileDetail ? 'max-md:hidden' : ''
          }`}
        >
          {/* Filters & Sort */}
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="部位フィルタ">
              <button
                type="button"
                role="tab"
                aria-selected={filterSlot === 'all'}
                onClick={() => onChangeFilter('all')}
                className={`rounded px-2 py-1 text-[11px] transition ${
                  filterSlot === 'all'
                    ? 'border border-sky-400 bg-sky-400/20 font-bold text-white'
                    : 'border border-slate-400/20 bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                すべて
              </button>
              {SLOT_ORDER.map((sk) => {
                const sDef = SLOTS[sk];
                return (
                  <button
                    key={sk}
                    type="button"
                    role="tab"
                    aria-selected={filterSlot === sk}
                    onClick={() => onChangeFilter(sk)}
                    className={`rounded px-2 py-1 text-[11px] transition ${
                      filterSlot === sk
                        ? 'border border-sky-400 bg-sky-400/20 font-bold text-white'
                        : 'border border-slate-400/20 bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sDef.icon} {sDef.label}
                  </button>
                );
              })}
            </div>
            <select
              aria-label="並び替え"
              value={sortMode}
              onChange={(e) => onChangeSort(e.target.value as SortMode)}
              className="rounded border border-slate-400/25 bg-slate-800 px-2 py-1 text-[11px] text-slate-100"
            >
              <option value="newest">新着順</option>
              <option value="rarity">レア度順</option>
              <option value="stage">ステージLv順</option>
              <option value="level">強化Lv順</option>
            </select>
          </div>

          {upgradeFeedback && !showingMobileDetail && (
            <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-center text-[11px] font-bold text-amber-300 md:hidden">
              {upgradeFeedback}
            </div>
          )}

          {/* Item Cards List */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
            {filteredItems.length === 0 ? (
              <div className="my-auto py-8 text-center text-xs leading-relaxed text-slate-400">
                {isBag ? (
                  <>
                    バッグに該当する装備はありません。
                    <br />
                    敵を倒してドロップを待ちましょう。
                  </>
                ) : (
                  <>
                    倉庫に該当する装備はありません。
                    <br />
                    バッグからドラッグ、または「📦 倉庫」で預けられます。
                  </>
                )}
              </div>
            ) : (
              filteredItems.map((it) => {
                const rInfo = RARITIES[it.rarity];
                const sInfo = SLOTS[it.slot];
                const selected = selectedItemId === it.id;
                const mainVal = getMainStatVal(it);
                const eqMainVal = getMainStatVal(equipped[it.slot]);
                const diffInfo = formatStatDiff(mainVal - eqMainVal, sInfo.unit);
                const isBeingDragged =
                  draggedItem?.itemId === it.id && draggedItem.source === location;

                return (
                  <div
                    key={it.id}
                    draggable={!isRollingUpgrade}
                    data-item-card={it.id}
                    onDragStart={(e) => {
                      if (isRollingUpgrade) {
                        e.preventDefault();
                        return;
                      }
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData(
                        'text/plain',
                        JSON.stringify({ itemId: it.id, source: location, slot: it.slot }),
                      );
                      onDragStartItem({ itemId: it.id, source: location, slot: it.slot });
                    }}
                    onDragEnd={() => {
                      setIsDropHover(false);
                      onDragEndItem();
                    }}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition md:cursor-grab md:active:cursor-grabbing ${
                      isBeingDragged
                        ? 'opacity-45'
                        : selected
                          ? 'bg-[#23334d] ring-1 ring-sky-400'
                          : 'bg-slate-800/90 hover:bg-[#263449]'
                    }`}
                    style={{ borderColor: selected ? '#38bdf8' : rInfo.border }}
                  >
                    <button
                      type="button"
                      data-select-item={it.id}
                      onClick={() => !isRollingUpgrade && onSelectItem(it.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-black/30 text-xl"
                        style={{ border: `1px solid ${rInfo.border}` }}
                      >
                        {it.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-xs font-bold">
                          <span className="truncate">
                            <RarityName item={it} />
                          </span>
                          {it.level > 0 && (
                            <span className="shrink-0 text-[11px] text-amber-400">+{it.level}</span>
                          )}
                          {it.locked && (
                            <span className="shrink-0" title="ロック中">
                              🔒
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-200">
                          <span className="font-semibold">
                            {sInfo.mainLabel}+{fmt(mainVal)}
                            {sInfo.unit}
                          </span>
                          <span
                            data-main-diff={it.id}
                            className={`rounded px-1 py-0.2 text-[10px] font-extrabold ${
                              diffInfo.tone === 'up'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : diffInfo.tone === 'down'
                                  ? 'bg-rose-500/15 text-rose-300'
                                  : 'bg-slate-700/70 text-slate-400'
                            }`}
                          >
                            {diffInfo.text}
                          </span>
                          <span className="text-slate-400">
                            {sInfo.isFixedCap ? '固定上限' : `St.${it.stage}`}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[10px] text-slate-400">
                          {it.subStats
                            .map((s) => `${SUB_MAP[s.key].label}+${s.val.toFixed(1)}%`)
                            .join(' · ')}
                        </div>
                      </div>
                    </button>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[10px] font-semibold text-slate-400">
                        {sInfo.label} · {it.subStats.length}オプ
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={isRollingUpgrade || isOtherFull}
                          title={isBag ? '倉庫へ預ける' : 'バッグへ戻す'}
                          onClick={() => onMoveItem(it.id)}
                          className="rounded border border-emerald-400/50 bg-emerald-700/35 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100 transition hover:bg-emerald-600/50 disabled:opacity-40"
                        >
                          {isBag ? '📦 倉庫' : '🎒 バッグ'}
                        </button>
                        <button
                          type="button"
                          disabled={isRollingUpgrade}
                          onClick={() => onEquipItem(it.id)}
                          className="rounded border border-blue-400/70 bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-blue-500 disabled:opacity-40"
                        >
                          装備
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer: Bulk Salvage for Bag / Safe Vault notice for Stash */}
          {isBag && onSalvageBulk ? (
            <div className="shrink-0 rounded-lg border border-slate-400/20 bg-black/25 p-2">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold text-slate-400">
                <span>一括分解（バッグ内のみ・ロック除外）</span>
                <span className="text-[10px] font-normal text-slate-500">倉庫・アクセ保護</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 max-[480px]:grid-cols-2">
                <button
                  type="button"
                  disabled={isRollingUpgrade}
                  onClick={() => onSalvageBulk('common')}
                  className="whitespace-nowrap rounded border border-red-400/45 bg-red-900/35 px-1.5 py-1 text-[11px] font-semibold text-red-200 transition hover:bg-red-700/50 disabled:opacity-40"
                >
                  コモンのみ
                </button>
                <button
                  type="button"
                  disabled={isRollingUpgrade}
                  onClick={() => onSalvageBulk('rare')}
                  className="whitespace-nowrap rounded border border-red-400/45 bg-red-900/35 px-1.5 py-1 text-[11px] font-semibold text-red-200 transition hover:bg-red-700/50 disabled:opacity-40"
                >
                  レア以下
                </button>
                <button
                  type="button"
                  disabled={isRollingUpgrade}
                  onClick={() => onSalvageBulk('epic')}
                  className="whitespace-nowrap rounded border border-red-400/45 bg-red-900/35 px-1.5 py-1 text-[11px] font-semibold text-red-200 transition hover:bg-red-700/50 disabled:opacity-40"
                >
                  エピック以下
                </button>
                <button
                  type="button"
                  disabled={isRollingUpgrade}
                  onClick={() => onSalvageBulk('weaker')}
                  title="装備中より基礎値が低くレア度も以下の武器・防具を分解（アクセは保護）"
                  className="whitespace-nowrap rounded border border-red-400/45 bg-red-900/35 px-1.5 py-1 text-[11px] font-semibold text-red-200 transition hover:bg-red-700/50 disabled:opacity-40"
                >
                  型落ち武器防具
                </button>
              </div>
            </div>
          ) : (
            <div className="shrink-0 rounded-lg border border-emerald-400/20 bg-emerald-950/25 px-2.5 py-2 text-center text-[11px] text-emerald-200/85">
              🔒 倉庫内の装備は一括分解の対象外（自動保護）です。ドラッグで装備・バッグへ移動できます。
            </div>
          )}
        </div>

        {/* Right / Mobile Detail Pane */}
        <div
          className={`flex min-h-0 flex-1 flex-col gap-2 p-2.5 ${
            !showingMobileDetail ? 'max-md:hidden' : ''
          }`}
        >
          {/* Mobile Back Bar */}
          <div className="flex items-center justify-between border-b border-slate-400/20 pb-2 md:hidden">
            <button
              type="button"
              id={isBag ? 'btn-bag-back' : 'btn-stash-back'}
              disabled={isRollingUpgrade}
              onClick={onBackToList}
              className="rounded-md border border-slate-400/30 bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-40"
            >
              ← 一覧に戻る
            </button>
            <span className="text-[11px] font-bold text-slate-400">詳細・比較・強化</span>
          </div>

          <div className="hidden text-[11px] font-bold text-slate-400 md:block">
            詳細・比較・強化
          </div>

          <ItemDetailPanel
            item={selectedItem}
            location={location}
            equippedInSlot={selectedItem ? equipped[selectedItem.slot] : null}
            stones={stones}
            isRollingUpgrade={isRollingUpgrade}
            rouletteActiveIdx={rouletteActiveIdx}
            lastBoostedSubIdx={lastBoostedSubIdx}
            upgradeFeedback={upgradeFeedback}
            emptyMessage={
              isBag
                ? 'バッグから装備を選択すると、現在の装備との比較・強化・倉庫への移動ができます。'
                : '倉庫から装備を選択すると、現在の装備との比較や強化ができます。'
            }
            onEquipItem={onEquipItem}
            onMoveLocation={onMoveItem}
            moveLocationDisabled={isOtherFull}
            onUpgradeItem={onUpgradeItem}
            onToggleLock={onToggleLock}
            onSalvageSingle={onSalvageSingle}
            salvageBonusPct={salvageBonusPct}
          />
        </div>
      </div>
    </FloatingWindow>
  );
}
