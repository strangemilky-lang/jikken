import { useState } from 'react';
import { UNIQUE_AFFIX_MAP } from '../game/constants';
import { fmt } from '../game/items';
import {
  calcPartyMemberStats,
  canRecruitCharacter,
  expToNextLevel,
  getActiveMembers,
  getMemberEquippedSet,
  getPartyBonuses,
  getSpentSkillPoints,
  JOB_DEFS,
  JOB_ORDER,
} from '../game/party';
import type { EquippedSet, JobId, PartyState, WindowKey } from '../game/types';
import { FloatingWindow, type WindowPos, type WindowSize } from './FloatingWindow';

interface PartyWindowProps {
  open: boolean;
  zIndex: number;
  position: WindowPos;
  windowSize: WindowSize;
  party: PartyState;
  equipped: EquippedSet;
  maxStage: number;
  stones: number;
  cleared100: boolean;
  selectedMemberId: JobId;
  onFocus: () => void;
  onMovePosition: (pos: WindowPos) => void;
  onResizeWindow: (size: WindowSize) => void;
  onSelectMember: (id: JobId) => void;
  onAllocateSkill: (memberId: JobId, skillId: string) => void;
  onResetSkills: (memberId: JobId) => void;
  onRecruitMember: (memberId: JobId) => void;
  onSwapPartySlot: (slotIdx: 0 | 1 | 2, memberId: JobId) => void;
  onInspectEquipment: (memberId: JobId) => void;
  onOpenWindow: (win: WindowKey) => void;
  onClose: () => void;
}

const SLOT_LABELS: [string, string, string] = ['前衛 #1', '中衛 #2', '後衛 #3'];

export function PartyWindow({
  open,
  zIndex,
  position,
  windowSize,
  party,
  equipped,
  maxStage,
  stones,
  cleared100,
  selectedMemberId,
  onFocus,
  onMovePosition,
  onResizeWindow,
  onSelectMember,
  onAllocateSkill,
  onResetSkills,
  onRecruitMember,
  onSwapPartySlot,
  onInspectEquipment,
  onOpenWindow,
  onClose,
}: PartyWindowProps) {
  const [inspectId, setInspectId] = useState<JobId>(selectedMemberId);

  // Sync inspected character when parent changes active member selection
  const currentId: JobId = party.roster[inspectId] ? inspectId : selectedMemberId;
  const member = party.roster[currentId];
  const def = JOB_DEFS[currentId];
  const activeMembers = getActiveMembers(party);
  const stats = calcPartyMemberStats(member, equipped, cleared100, activeMembers);
  const partyBonuses = getPartyBonuses(party, equipped);
  const recruitInfo = canRecruitCharacter(party, currentId, maxStage, stones);
  const spentSp = getSpentSkillPoints(member);
  const expNeed = expToNextLevel(member.level);
  const expPct = Math.min(100, Math.round((member.exp / Math.max(1, expNeed)) * 100));
  const activeSlotIdx = party.activeIds.indexOf(currentId);

  const memberEq = getMemberEquippedSet(member, equipped);
  const activeAffixes = [
    memberEq.weapon.uniqueAffix,
    memberEq.armor.uniqueAffix,
    memberEq.ring.uniqueAffix,
    memberEq.necklace.uniqueAffix,
    memberEq.gauntlets.uniqueAffix,
    memberEq.boots.uniqueAffix,
  ].filter((af): af is NonNullable<typeof af> => Boolean(af));

  const handlePickCharacter = (id: JobId) => {
    setInspectId(id);
    if (party.activeIds.includes(id)) {
      onSelectMember(id);
    }
  };

  return (
    <FloatingWindow
      id="party-window"
      ariaLabel="パーティ編成とスキル"
      open={open}
      zIndex={zIndex}
      position={position}
      size={windowSize}
      minSize={{ width: 580, height: 500 }}
      onFocus={onFocus}
      onMovePosition={onMovePosition}
      onResize={onResizeWindow}
      headerLeft={
        <>
          <span>👥 パーティ編成・スキル</span>
          <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/35 bg-sky-400/10 px-2 py-0.5 text-xs font-bold text-sky-200">
            💎 {fmt(stones)}
          </span>
          {partyBonuses.totalUnspentSp > 0 && (
            <span className="rounded border border-amber-400/60 bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-extrabold text-amber-200">
              未振分 SP {partyBonuses.totalUnspentSp}
            </span>
          )}
        </>
      }
      headerRight={
        <>
          <button
            type="button"
            onClick={() => onOpenWindow('equipped')}
            className="rounded-md border border-sky-400/50 bg-sky-500/20 px-2 py-1 text-[11px] font-bold text-sky-100 transition hover:bg-sky-500/35 md:hidden"
          >
            🛡️ 装備
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-400/25 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
          >
            ✕ 閉じる
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Top Active 3-Slot Formation Strip */}
        <div className="shrink-0 border-b border-slate-400/20 bg-slate-900/75 px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-300">
            <span className="font-bold text-sky-200">出撃パーティ（フルオート3人編成）</span>
            <span className="text-[10px] text-slate-400">
              控えキャラも戦闘EXP 50%獲得・スキルはいつでも無料リセット可
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([0, 1, 2] as const).map((slotIdx) => {
              const id = party.activeIds[slotIdx];
              const m = party.roster[id];
              const d = JOB_DEFS[id];
              const isSelected = currentId === id;
              return (
                <button
                  key={slotIdx}
                  type="button"
                  data-testid={`active-slot-${slotIdx}`}
                  onClick={() => handlePickCharacter(id)}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition ${
                    isSelected
                      ? 'border-sky-400 bg-sky-500/20 ring-1 ring-sky-400'
                      : 'border-slate-400/25 bg-slate-800/80 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-xl">{d.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 text-[10px] text-slate-400">
                      <span>{SLOT_LABELS[slotIdx]}</span>
                      <span className="font-bold text-slate-200">Lv.{m.level}</span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-extrabold" style={{ color: d.accentColor }}>
                        {d.name}（{d.jobName}）
                      </span>
                      {m.unspentSp > 0 && (
                        <span className="shrink-0 rounded bg-amber-500/25 px-1 text-[10px] font-extrabold text-amber-300">
                          SP+{m.unspentSp}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main 2-Column Body: Left Roster (5 chars) / Right Selected Detail & Skill Tree */}
        <div className="grid min-h-0 flex-1 grid-cols-[235px_minmax(0,1fr)] overflow-hidden max-md:flex max-md:flex-col">
          {/* Left: 5-Character Roster */}
          <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto border-r border-slate-400/20 p-2.5 max-md:max-h-[180px] max-md:border-b max-md:border-r-0">
            <div className="text-[11px] font-bold text-slate-400">仲間一覧（全5キャラ）</div>
            {JOB_ORDER.map((id) => {
              const m = party.roster[id];
              const d = JOB_DEFS[id];
              const slotPos = party.activeIds.indexOf(id);
              const rec = canRecruitCharacter(party, id, maxStage, stones);
              const isInspect = currentId === id;

              return (
                <div
                  key={id}
                  data-testid={`roster-card-${id}`}
                  className={`flex flex-col gap-1 rounded-lg border p-2 transition ${
                    isInspect
                      ? 'border-sky-400 bg-sky-950/45 ring-1 ring-sky-400/70'
                      : m.unlocked
                        ? 'border-slate-400/25 bg-slate-800/80 hover:bg-slate-800'
                        : 'border-slate-600/35 bg-slate-900/75 opacity-90'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handlePickCharacter(id)}
                    className="flex items-center gap-2 text-left"
                  >
                    <span className="text-lg">{d.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-extrabold" style={{ color: d.accentColor }}>
                          {d.name}{' '}
                          <span className="font-semibold text-slate-300">{d.jobName}</span>
                        </span>
                        {m.unlocked ? (
                          <span className="shrink-0 text-[10px] font-bold text-slate-200">
                            Lv.{m.level}
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] font-bold text-slate-400">
                            🔒 未加入
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="truncate">{d.roleLabel}</span>
                        {m.unlocked && m.unspentSp > 0 && (
                          <span className="shrink-0 font-bold text-amber-300">SP+{m.unspentSp}</span>
                        )}
                      </div>
                    </div>
                  </button>

                  {m.unlocked ? (
                    <div className="flex items-center justify-between gap-1 pt-0.5">
                      <span
                        className={`text-[10px] font-bold ${
                          slotPos >= 0 ? 'text-emerald-300' : 'text-slate-400'
                        }`}
                      >
                        {slotPos >= 0 ? `出撃中（${SLOT_LABELS[slotPos]}）` : '控え待機中'}
                      </span>
                      <div className="flex items-center gap-1">
                        {([0, 1, 2] as const).map((targetSlot) => (
                          <button
                            key={targetSlot}
                            type="button"
                            disabled={slotPos === targetSlot}
                            onClick={() => {
                              onSwapPartySlot(targetSlot, id);
                              setInspectId(id);
                            }}
                            title={`${SLOT_LABELS[targetSlot]}へ編成`}
                            className={`rounded border px-1.5 py-0.2 text-[10px] font-bold transition ${
                              slotPos === targetSlot
                                ? 'border-emerald-400/50 bg-emerald-600/30 text-emerald-200'
                                : 'border-slate-500/40 bg-slate-700/80 text-slate-200 hover:border-sky-400 hover:bg-sky-700/40'
                            }`}
                          >
                            {targetSlot + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid={`btn-recruit-${id}`}
                      disabled={!rec.canFree && !rec.canPay}
                      onClick={() => {
                        onRecruitMember(id);
                        setInspectId(id);
                      }}
                      className={`mt-0.5 rounded-md border px-2 py-1 text-[11px] font-bold transition ${
                        rec.canFree
                          ? 'border-emerald-300 bg-emerald-600 text-white hover:brightness-110'
                          : rec.canPay
                            ? 'border-amber-400 bg-amber-700/80 text-amber-100 hover:brightness-110'
                            : 'cursor-not-allowed border-slate-600 bg-slate-800 text-slate-400'
                      }`}
                    >
                      {rec.canFree
                        ? '✨ 無料で仲間にする'
                        : `💎${rec.stoneCost}で先行加入（St.${rec.unlockStage}で無料）`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right: Selected Character Stats & Skill Allocation */}
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
            {/* Character Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-400/20 bg-slate-900/70 p-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-black/35 text-2xl">
                  {def.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold" style={{ color: def.accentColor }}>
                      {def.name}
                    </span>
                    <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.2 text-[10px] font-bold text-slate-200">
                      {def.jobName}
                    </span>
                    <span className="text-xs font-extrabold text-white">Lv.{member.level}</span>
                    {activeSlotIdx >= 0 && (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-bold text-emerald-300">
                        {SLOT_LABELS[activeSlotIdx]}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 to-cyan-300 transition-[width] duration-200"
                        style={{ width: `${expPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      EXP {fmt(member.exp)} / {fmt(expNeed)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {member.unlocked && (
                  <button
                    type="button"
                    onClick={() => onInspectEquipment(currentId)}
                    className="rounded-md border border-sky-400/55 bg-sky-700/35 px-2.5 py-1 text-[11px] font-bold text-sky-100 transition hover:bg-sky-600/45"
                  >
                    🛡️ 装備を見る
                  </button>
                )}
              </div>
            </div>

            {!member.unlocked && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-400/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
                <span>
                  {recruitInfo.canFree
                    ? `St.${recruitInfo.unlockStage}到達済み！無料で仲間に加入できます。`
                    : `St.${recruitInfo.unlockStage}到達で無料加入、または強化石 💎${recruitInfo.stoneCost} で今すぐ先行加入できます。`}
                </span>
                <button
                  type="button"
                  disabled={!recruitInfo.canFree && !recruitInfo.canPay}
                  onClick={() => onRecruitMember(currentId)}
                  className="shrink-0 rounded-md border border-amber-300 bg-amber-600 px-3 py-1 text-xs font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
                >
                  {recruitInfo.canFree ? '無料加入' : `💎${recruitInfo.stoneCost} 加入`}
                </button>
              </div>
            )}

            {/* Computed Stats Preview */}
            <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2">
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-6">
                <div>
                  <div className="text-[10px] text-slate-400">攻撃力</div>
                  <div className="font-bold text-slate-100">{fmt(Math.round(stats.atk))}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">最大HP</div>
                  <div className="font-bold text-slate-100">{fmt(stats.hp)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">会心率</div>
                  <div className="font-bold text-amber-300">{stats.critRate.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">会心ダメ</div>
                  <div className="font-bold text-slate-100">{Math.round(stats.critDmg)}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">防御貫通</div>
                  <div className="font-bold text-sky-300">{stats.armorPen.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">ボス特攻</div>
                  <div className="font-bold text-rose-300">+{stats.bossDmg.toFixed(1)}%</div>
                </div>
              </div>
              {activeAffixes.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1 border-t border-white/10 pt-1.5">
                  {activeAffixes.map((af, idx) => {
                    const aDef = UNIQUE_AFFIX_MAP[af.key];
                    return (
                      <span
                        key={`${af.key}-${idx}`}
                        className="rounded border border-fuchsia-400/40 bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-200"
                      >
                        {aDef.icon} {aDef.label} ({af.val}%)
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Skill Allocation Section */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold text-slate-100">スキルツリー（戦闘中は完全オート発動）</span>
                  <span
                    data-testid="member-unspent-sp"
                    className={`rounded border px-2 py-0.5 text-xs font-extrabold ${
                      member.unspentSp > 0
                        ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                        : 'border-slate-600 bg-slate-800 text-slate-400'
                    }`}
                  >
                    残りSP: {member.unspentSp}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="btn-reset-skills"
                  disabled={!member.unlocked || spentSp <= 0}
                  onClick={() => onResetSkills(currentId)}
                  className="rounded-md border border-cyan-400/50 bg-cyan-900/35 px-2.5 py-1 text-[11px] font-bold text-cyan-200 transition hover:bg-cyan-800/50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🔄 スキルリセット（無料・SP全返還）
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {def.skills.map((sk) => {
                  const lv = member.skills[sk.id] ?? 0;
                  const isMax = lv >= sk.maxLevel;
                  const canUpgrade = member.unlocked && member.unspentSp > 0 && !isMax;

                  return (
                    <div
                      key={sk.id}
                      data-testid={`skill-card-${sk.id}`}
                      className="flex flex-col gap-1.5 rounded-lg border border-slate-400/20 bg-slate-800/75 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{sk.icon}</span>
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-extrabold text-white">{sk.name}</span>
                              <span
                                className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                                  sk.kind === 'active'
                                    ? 'border border-amber-400/45 bg-amber-500/15 text-amber-300'
                                    : 'border border-sky-400/40 bg-sky-500/15 text-sky-300'
                                }`}
                              >
                                {sk.kind === 'active' ? `⚡ 自動スキル (CT:${sk.cd}T)` : 'パッシブ'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            data-testid={`skill-lv-${sk.id}`}
                            className="text-xs font-extrabold text-amber-300 tabular-nums"
                          >
                            Lv.{lv} / {sk.maxLevel}
                          </span>
                          <button
                            type="button"
                            data-testid={`btn-skill-up-${sk.id}`}
                            disabled={!canUpgrade}
                            onClick={() => onAllocateSkill(currentId, sk.id)}
                            className="rounded-md border border-amber-400 bg-gradient-to-br from-amber-600 to-amber-800 px-2.5 py-1 text-[11px] font-extrabold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            {isMax ? 'MAX' : '+1 SP'}
                          </button>
                        </div>
                      </div>

                      {/* 5-pip level bar */}
                      <div className="flex gap-1">
                        {Array.from({ length: sk.maxLevel }).map((_, i) => (
                          <div
                            key={i}
                            className={`h-1.5 flex-1 rounded-sm ${
                              i < lv ? 'bg-amber-400' : 'bg-slate-700'
                            }`}
                          />
                        ))}
                      </div>

                      <div className="text-[11px] leading-relaxed text-slate-200">
                        {lv > 0 ? (
                          <span>現在: {sk.summary(lv)}</span>
                        ) : (
                          <span className="text-slate-400">
                            {sk.kind === 'active'
                              ? `基本効果: ${sk.summary(0)}（Lv1で強化）`
                              : `未習得 — Lv1効果: ${sk.summary(1)}`}
                          </span>
                        )}
                      </div>
                      {lv > 0 && !isMax && (
                        <div className="text-[10px] text-emerald-300/90">
                          次Lv({lv + 1}): {sk.summary(lv + 1)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}
