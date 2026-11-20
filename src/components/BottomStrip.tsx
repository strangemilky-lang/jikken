import { useState, type DragEvent } from 'react';
import { MAX_BAG_SIZE, MAX_STASH_SIZE, RARITIES, SLOT_ORDER, SLOTS } from '../game/constants';
import { calcHeroStats, fmt, getMainStatVal } from '../game/items';
import { getNextManualStage, getPrevManualStage, isSanctumFloor } from '../game/sanctum';
import type { DragItemPayload, GameState, SlotKey } from '../game/types';
import { PixelSpriteIcon } from './PixelSpriteIcon';
import { RarityName } from './RarityName';

interface BottomStripProps {
  state: GameState;
  openWindows: { equipped: boolean; bag: boolean; stash: boolean };
  draggedItem: DragItemPayload | null;
  onPrevStage: () => void;
  onNextStage: () => void;
  onToggleAutoProgress: () => void;
  onOpenEquipped: (slot?: SlotKey) => void;
  onToggleBag: () => void;
  onToggleStash: () => void;
  onDropEquip: (payload: DragItemPayload) => void;
  onDropMoveItem: (payload: DragItemPayload, target: 'bag' | 'stash') => void;
  onOpenChests: () => void;
  onToggleSound: () => void;
  onResetSave: () => void;
  onChangeAutoSalvage: (val: number) => void;
}

export function BottomStrip({
  state,
  openWindows,
  draggedItem,
  onPrevStage,
  onNextStage,
  onToggleAutoProgress,
  onOpenEquipped,
  onToggleBag,
  onToggleStash,
  onDropEquip,
  onDropMoveItem,
  onOpenChests,
  onToggleSound,
  onResetSave,
  onChangeAutoSalvage,
}: BottomStripProps) {
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const stats = calcHeroStats(state.equipped, state.cleared100);
  const totalChests = state.chests + state.mythicChests;
  const featuredSlot = SLOTS[SLOT_ORDER[(state.stage - 1) % SLOT_ORDER.length]];
  const prevManualStage = getPrevManualStage(state.stage);
  const nextManualStage = getNextManualStage(state.stage, state.maxStage, state.clearedSanctumMax);
  const inSanctum = isSanctumFloor(state.stage);

  return (
    <footer
      id="strip-shell"
      className="relative z-20 flex h-[var(--strip-h)] shrink-0 items-stretch overflow-x-auto border-t-2 border-sky-400/35 bg-gradient-to-b from-[#131d31] to-[#0b1120] shadow-[0_-8px_30px_rgba(0,0,0,0.65)]"
    >
      {/* Left/Center Pane: Stage, Stats, 6 Equipped Slots */}
      <div className="flex min-w-[430px] flex-[1.2] flex-col justify-between gap-1.5 border-r border-slate-400/20 bg-slate-900/55 px-3 py-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="前のステージ"
              disabled={prevManualStage === null}
              onClick={onPrevStage}
              className="rounded-md border border-slate-400/25 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ◀
            </button>
            <div className="min-w-[92px] rounded border border-slate-400/20 bg-black/30 px-2 py-0.5 text-center text-xs font-bold">
              {inSanctum ? (
                <span className="text-purple-300">St.{state.stage} 🏛️玄室</span>
              ) : (
                <>
                  St.{state.stage} / {state.maxStage} {featuredSlot.icon}
                  {featuredSlot.label}UP
                </>
              )}
            </div>
            <button
              type="button"
              aria-label="次のステージ"
              disabled={nextManualStage === null}
              onClick={onNextStage}
              title={
                nextManualStage === null && isSanctumFloor(state.stage + 1)
                  ? '50層ごとの玄室は「玄室へ挑む」ボタンから鍵を消費して入場します'
                  : undefined
              }
              className="rounded-md border border-slate-400/25 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={onToggleAutoProgress}
              title="ボス撃破時に自動で次のステージへ進みます（50層毎の玄室前では関門階で足止め周回）"
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                state.autoProgress
                  ? 'border-green-400 bg-green-600/25 text-green-400'
                  : 'border-slate-400/25 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {state.autoProgress ? '自動進行 ON' : '自動進行 OFF'}
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <div
              title="玄室の鍵（各階の鍵持ちボス撃破時に一定確率で獲得。50層ごとの玄室入場ごとに1本消費）"
              className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${
                state.sanctumKeys > 0
                  ? 'border-purple-400/50 bg-purple-500/15 text-purple-200'
                  : 'border-slate-400/25 bg-slate-800/70 text-slate-400'
              }`}
            >
              <PixelSpriteIcon spriteKey="sanctum_key" size={16} />
              <span data-testid="sanctum-key-count">{state.sanctumKeys}</span>
            </div>

            <div
              title="強化石（装備の強化に使用）"
              className="flex shrink-0 items-center gap-1 rounded-md border border-sky-400/35 bg-sky-400/10 px-2.5 py-0.5 text-xs font-bold text-sky-200"
            >
              <span>💎</span>
              <span data-testid="stone-count">{fmt(state.stones)}</span>
            </div>
          </div>
        </div>

        {/* 7 Core Combat Stats (Turn-based: no Attack Speed) */}
        <div className="flex flex-col gap-0.5 rounded-lg border border-white/10 bg-black/25 px-2.5 py-1">
          <div className="grid grid-cols-4 gap-x-2">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400">攻撃力</span>
              <span className="text-xs font-bold text-slate-100">{fmt(stats.atk)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400">最大HP</span>
              <span className="text-xs font-bold text-slate-100">{fmt(stats.hp)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400">会心率</span>
              <span className="text-xs font-bold text-slate-100">
                {stats.critRate > 200 ? (
                  <span className="mythic-text">{stats.critRate.toFixed(1)}% (極)</span>
                ) : stats.critRate > 100 ? (
                  <span className="text-red-400">{stats.critRate.toFixed(1)}% (超)</span>
                ) : (
                  `${stats.critRate.toFixed(1)}%`
                )}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400">会心ダメ</span>
              <span className="text-xs font-bold text-slate-100">{Math.round(stats.critDmg)}%</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-x-2 border-t border-white/5 pt-0.5">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400">与ダメ+</span>
              <span className="text-xs font-bold text-amber-300">+{stats.dmgPct.toFixed(1)}%</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400">防御貫通</span>
              <span className="text-xs font-bold text-sky-300">{stats.armorPen.toFixed(1)}%</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400">ボス特攻</span>
              <span className="text-xs font-bold text-rose-300">+{stats.bossDmg.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* 6 Equipment Slots (2 rows x 3 cols) — also drop targets */}
        <div className="grid grid-cols-3 gap-1">
          {SLOT_ORDER.map((slotKey) => {
            const it = state.equipped[slotKey];
            const sInfo = SLOTS[slotKey];
            const rInfo = RARITIES[it.rarity];
            const lvTxt = it.level > 0 ? ` +${it.level}` : '';
            const isDropCandidate = draggedItem?.slot === slotKey;
            const isHovered = hoverTarget === `slot:${slotKey}` && isDropCandidate;

            return (
              <button
                key={slotKey}
                type="button"
                onClick={() => onOpenEquipped(slotKey)}
                onDragOver={(e: DragEvent<HTMLButtonElement>) => {
                  if (!isDropCandidate) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setHoverTarget(`slot:${slotKey}`);
                }}
                onDragLeave={() => {
                  if (hoverTarget === `slot:${slotKey}`) setHoverTarget(null);
                }}
                onDrop={(e: DragEvent<HTMLButtonElement>) => {
                  e.preventDefault();
                  setHoverTarget(null);
                  if (draggedItem && isDropCandidate) onDropEquip(draggedItem);
                }}
                className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-left transition hover:-translate-y-0.5 hover:brightness-110 ${
                  isHovered
                    ? 'ring-2 ring-emerald-400'
                    : isDropCandidate
                      ? 'ring-1 ring-emerald-400/70'
                      : ''
                }`}
                style={{ borderColor: isDropCandidate ? '#34d399' : rInfo.border, background: rInfo.bg }}
              >
                <span className="shrink-0 text-base">{it.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-bold">
                    <RarityName item={it} text={it.name + lvTxt} />
                  </div>
                  <div className="truncate text-[10px] text-slate-400">
                    {sInfo.mainLabel} +{fmt(getMainStatVal(it))}
                    {sInfo.unit}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Pane: Equipped, Bag, Stash, Chests, Tools, Logs */}
      <div className="flex min-w-[335px] flex-1 flex-col gap-1.5 bg-[#0b1120]/70 px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            id="btn-open-equipped"
            onClick={() => onOpenEquipped()}
            className={`flex items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-bold text-white transition hover:brightness-110 ${
              openWindows.equipped
                ? 'border-sky-300 bg-sky-600 ring-1 ring-sky-300/70'
                : 'border-sky-400/60 bg-gradient-to-br from-sky-700 to-sky-800'
            }`}
          >
            <span>🛡️ 装備</span>
          </button>

          <button
            type="button"
            id="btn-open-bag"
            onClick={onToggleBag}
            onDragOver={(e: DragEvent<HTMLButtonElement>) => {
              if (draggedItem?.source !== 'stash' || state.inventory.length >= MAX_BAG_SIZE) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setHoverTarget('btn:bag');
            }}
            onDragLeave={() => {
              if (hoverTarget === 'btn:bag') setHoverTarget(null);
            }}
            onDrop={(e: DragEvent<HTMLButtonElement>) => {
              e.preventDefault();
              setHoverTarget(null);
              if (draggedItem?.source === 'stash' && state.inventory.length < MAX_BAG_SIZE) {
                onDropMoveItem(draggedItem, 'bag');
              }
            }}
            className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-bold text-white transition hover:brightness-110 ${
              hoverTarget === 'btn:bag'
                ? 'border-emerald-300 bg-emerald-600 ring-2 ring-emerald-400'
                : openWindows.bag
                  ? 'border-blue-300 bg-blue-600 ring-1 ring-blue-300/70'
                  : 'border-blue-400/70 bg-gradient-to-br from-blue-600 to-blue-700'
            }`}
          >
            <span>🎒 バッグ</span>
            <span>
              ({state.inventory.length}/{MAX_BAG_SIZE})
            </span>
          </button>

          <button
            type="button"
            id="btn-open-stash"
            onClick={onToggleStash}
            onDragOver={(e: DragEvent<HTMLButtonElement>) => {
              if (draggedItem?.source !== 'bag' || state.stash.length >= MAX_STASH_SIZE) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setHoverTarget('btn:stash');
            }}
            onDragLeave={() => {
              if (hoverTarget === 'btn:stash') setHoverTarget(null);
            }}
            onDrop={(e: DragEvent<HTMLButtonElement>) => {
              e.preventDefault();
              setHoverTarget(null);
              if (draggedItem?.source === 'bag' && state.stash.length < MAX_STASH_SIZE) {
                onDropMoveItem(draggedItem, 'stash');
              }
            }}
            className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-bold text-white transition hover:brightness-110 ${
              hoverTarget === 'btn:stash'
                ? 'border-emerald-300 bg-emerald-600 ring-2 ring-emerald-400'
                : openWindows.stash
                  ? 'border-emerald-300 bg-emerald-700 ring-1 ring-emerald-300/70'
                  : 'border-emerald-400/60 bg-gradient-to-br from-emerald-700 to-emerald-800'
            }`}
          >
            <span>📦 倉庫</span>
            <span>
              ({state.stash.length}/{MAX_STASH_SIZE})
            </span>
          </button>

          <button
            type="button"
            id="btn-open-chest"
            onClick={onOpenChests}
            title="ボス討伐などで貯まった封印の宝箱を開封します"
            className={`flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-bold transition ${
              totalChests > 0
                ? 'border-amber-400 bg-slate-800 text-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.3)]'
                : 'border-slate-400/25 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <PixelSpriteIcon
              spriteKey={state.mythicChests > 0 && state.chests === 0 ? 'chest_mythic' : 'chest_sealed'}
              size={16}
              animate={totalChests > 0}
            />
            <span>宝箱</span>
            <span data-testid="chest-count-badge">
              {state.mythicChests > 0 ? `${state.chests}+🌈${state.mythicChests}` : state.chests}
            </span>
          </button>

          <button
            type="button"
            aria-label={state.soundOn ? '効果音をオフにする' : '効果音をオンにする'}
            onClick={onToggleSound}
            className="rounded-md border border-slate-400/25 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
          >
            {state.soundOn ? '🔊' : '🔇'}
          </button>

          <button
            type="button"
            aria-label="セーブデータ初期化"
            onClick={onResetSave}
            className="rounded-md border border-red-400/50 bg-red-900/35 px-2.5 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-700/50"
          >
            🗑️
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <span className="whitespace-nowrap text-slate-400">自動分解:</span>
          <select
            aria-label="自動分解レアリティ設定"
            value={state.autoSalvageRarity}
            onChange={(e) => onChangeAutoSalvage(parseInt(e.target.value, 10))}
            className="flex-1 rounded border border-slate-400/25 bg-slate-800 px-2 py-1 text-[11px] text-slate-100"
          >
            <option value={-1}>しない（すべて入手）</option>
            <option value={0}>コモン以下を自動分解</option>
            <option value={1}>レア以下を自動分解</option>
            <option value={2}>エピック以下を自動分解</option>
            <option value={3}>レジェンド以下を自動分解</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto rounded-md border border-white/10 bg-black/35 px-2 py-1 text-[11px] leading-relaxed text-slate-400">
          {state.logs.map((l, idx) => {
            if (typeof l === 'string') {
              return (
                <div key={idx} className="truncate">
                  {l}
                </div>
              );
            }
            return (
              <div key={idx} className="truncate" style={l.color ? { color: l.color } : undefined}>
                [{l.ts}] {l.msg}
              </div>
            );
          })}
        </div>
      </div>
    </footer>
  );
}
