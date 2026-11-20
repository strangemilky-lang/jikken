import { useState, type DragEvent } from 'react';
import { MAX_BAG_SIZE, MAX_STASH_SIZE, PERSONAL_SLOTS, RARITIES, SLOT_ORDER, SLOTS } from '../game/constants';
import { fmt, getMainStatVal } from '../game/items';
import {
  calcPartyMemberStats,
  canRecruitCharacter,
  expToNextLevel,
  getActiveMembers,
  getMemberEquippedSet,
  getPartyBonuses,
  JOB_DEFS,
  JOB_ORDER,
} from '../game/party';
import { getNextManualStage, getPrevManualStage, isSanctumFloor } from '../game/sanctum';
import type { DragItemPayload, GameState, JobId, SlotKey, WindowKey } from '../game/types';
import { PixelSpriteIcon } from './PixelSpriteIcon';
import { RarityName } from './RarityName';

interface BottomStripProps {
  state: GameState;
  openWindows: Record<WindowKey, boolean>;
  selectedMemberId: JobId;
  draggedItem: DragItemPayload | null;
  onSelectMember: (id: JobId) => void;
  onToggleParty: () => void;
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
  selectedMemberId,
  draggedItem,
  onSelectMember,
  onToggleParty,
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
  const activeMembers = getActiveMembers(state.party);
  const selectedMember = state.party.roster[selectedMemberId] ?? activeMembers[0];
  const selectedDef = JOB_DEFS[selectedMember.id];
  const displayedEquipped = getMemberEquippedSet(selectedMember, state.equipped);
  const partyBonuses = getPartyBonuses(state.party, state.equipped);
  const hasFreeRecruit = JOB_ORDER.some(
    (id) => canRecruitCharacter(state.party, id, state.maxStage, state.stones).canFree,
  );

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
      {/* Left/Center Pane: Stage, 3-Member Party Strip, Selected Member's 6 Slots */}
      <div className="flex min-w-[465px] flex-[1.28] flex-col justify-between gap-1 border-r border-slate-400/20 bg-slate-900/55 px-3 py-1.5">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="前のステージ"
              disabled={prevManualStage === null}
              onClick={onPrevStage}
              className="rounded-md border border-slate-400/25 bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
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
              className="rounded-md border border-slate-400/25 bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={onToggleAutoProgress}
              title="ボス撃破時に自動で次のステージへ進みます（50層毎の玄室前では関門階で足止め周回）"
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold transition ${
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
              title="強化石（装備の強化・再鍛造・先行加入に使用）"
              className="flex shrink-0 items-center gap-1 rounded-md border border-sky-400/35 bg-sky-400/10 px-2 py-0.5 text-xs font-bold text-sky-200"
            >
              <span>💎</span>
              <span data-testid="stone-count">{fmt(state.stones)}</span>
            </div>
          </div>
        </div>

        {/* 3 Active Party Member Cards */}
        <div className="grid grid-cols-3 gap-1.5" data-testid="strip-party-cards">
          {activeMembers.map((member) => {
            const def = JOB_DEFS[member.id];
            const mStats = calcPartyMemberStats(member, state.equipped, state.cleared100, activeMembers);
            const isSelected = member.id === selectedMember.id;
            const expNeed = expToNextLevel(member.level);
            const expPct = Math.min(100, Math.round((member.exp / Math.max(1, expNeed)) * 100));

            return (
              <button
                key={member.id}
                type="button"
                data-testid={`strip-member-${member.id}`}
                onClick={() => onSelectMember(member.id)}
                className={`flex min-w-0 flex-col gap-0.5 rounded-lg border px-2 py-1 text-left transition ${
                  isSelected
                    ? 'border-sky-400 bg-sky-950/55 ring-1 ring-sky-400/70'
                    : 'border-white/10 bg-black/30 hover:bg-slate-800/70'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[11px] font-extrabold" style={{ color: def.accentColor }}>
                    {def.icon} {def.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {member.unspentSp > 0 && (
                      <span className="rounded bg-amber-500/25 px-1 text-[9px] font-black text-amber-300">
                        SP+{member.unspentSp}
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-slate-200">Lv.{member.level}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-300">
                  <span>攻 {fmt(Math.round(mStats.atk))}</span>
                  <span>HP {fmt(mStats.hp)}</span>
                  <span className="text-amber-300">{Math.round(mStats.critRate)}%</span>
                </div>
                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-cyan-300 transition-[width] duration-200"
                    style={{ width: `${expPct}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Member's 6 Equipment Slots (2 Personal + 4 Shared Artifacts) */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between px-0.5 text-[10px] text-slate-400">
            <span>
              👤 <strong style={{ color: selectedDef.accentColor }}>{selectedDef.name}</strong>
              の武器・防具 ＋ ✨パーティ共有遺物4枠
            </span>
            <span className="text-slate-500">クリックで強化 / D&D装着</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {SLOT_ORDER.map((slotKey) => {
              const it = displayedEquipped[slotKey];
              const sInfo = SLOTS[slotKey];
              const rInfo = RARITIES[it.rarity];
              const lvTxt = it.level > 0 ? ` +${it.level}` : '';
              const isDropCandidate = draggedItem?.slot === slotKey;
              const isHovered = hoverTarget === `slot:${slotKey}` && isDropCandidate;
              const isPersonal = PERSONAL_SLOTS.includes(slotKey);

              return (
                <button
                  key={`${selectedMember.id}-${slotKey}`}
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
                  className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-left transition hover:-translate-y-0.5 hover:brightness-110 ${
                    isHovered
                      ? 'ring-2 ring-emerald-400'
                      : isDropCandidate
                        ? 'ring-1 ring-emerald-400/70'
                        : ''
                  }`}
                  style={{ borderColor: isDropCandidate ? '#34d399' : rInfo.border, background: rInfo.bg }}
                >
                  <span className="shrink-0 text-sm">{it.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-bold">
                      <RarityName item={it} text={it.name + lvTxt} />
                    </div>
                    <div className="flex items-center justify-between gap-1 text-[9px] text-slate-400">
                      <span className="truncate">
                        {sInfo.mainLabel} +{fmt(getMainStatVal(it))}
                        {sInfo.unit}
                      </span>
                      <span className="shrink-0 text-[8px] text-slate-500">
                        {isPersonal ? '個人' : '共有'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right Pane: Party, Equipped, Bag, Stash, Chests, Tools, Logs */}
      <div className="flex min-w-[365px] flex-1 flex-col gap-1.5 bg-[#0b1120]/70 px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            id="btn-open-party"
            data-testid="btn-open-party"
            onClick={onToggleParty}
            className={`relative flex items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-extrabold text-white transition hover:brightness-110 ${
              openWindows.party
                ? 'border-purple-300 bg-purple-600 ring-1 ring-purple-300/70'
                : partyBonuses.totalUnspentSp > 0 || hasFreeRecruit
                  ? 'border-amber-300 bg-gradient-to-br from-purple-700 to-indigo-800 shadow-[0_0_12px_rgba(251,191,36,0.35)]'
                  : 'border-purple-400/60 bg-gradient-to-br from-purple-700 to-indigo-800'
            }`}
          >
            <span>👥 編成・スキル</span>
            {partyBonuses.totalUnspentSp > 0 && (
              <span className="rounded bg-amber-400 px-1 text-[10px] font-black text-slate-950">
                SP+{partyBonuses.totalUnspentSp}
              </span>
            )}
            {hasFreeRecruit && (
              <span className="rounded bg-emerald-400 px-1 text-[10px] font-black text-slate-950">
                新仲間
              </span>
            )}
          </button>

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
            className="rounded-md border border-slate-400/25 bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
          >
            {state.soundOn ? '🔊' : '🔇'}
          </button>

          <button
            type="button"
            aria-label="セーブデータ初期化"
            onClick={onResetSave}
            className="rounded-md border border-red-400/50 bg-red-900/35 px-2 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-700/50"
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
