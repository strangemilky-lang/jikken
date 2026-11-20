import { CHEST_BATCH_MAX, PERSONAL_SLOTS, RARITIES, SLOTS, SUB_MAP, UNIQUE_AFFIX_MAP } from '../game/constants';
import { fmt, getMainStatVal } from '../game/items';
import type { GachaPullResult } from '../game/types';
import { PixelSpriteIcon } from './PixelSpriteIcon';
import { RarityName } from './RarityName';

interface ChestModalProps {
  open: boolean;
  chests: number;
  mythicChests: number;
  maxStage: number;
  targetMemberName?: string;
  autoSalvageChecked: boolean;
  isOpening: boolean;
  results: GachaPullResult[];
  onToggleAutoSalvage: (checked: boolean) => void;
  onPull: (count: number, isMythic: boolean) => void;
  onEquipFromResult: (resultId: string, itemId: string) => void;
  onClose: () => void;
}

export function ChestModal({
  open,
  chests,
  mythicChests,
  maxStage,
  targetMemberName,
  autoSalvageChecked,
  isOpening,
  results,
  onToggleAutoSalvage,
  onPull,
  onEquipFromResult,
  onClose,
}: ChestModalProps) {
  if (!open) return null;

  const allRevealed = results.length > 0 && results.every((r) => r.phase === 'revealed');
  const totalSalvagedDust = results.reduce((sum, r) => sum + (r.phase === 'revealed' ? r.salvagedDust : 0), 0);
  const mythicPullCount = results.filter((r) => r.phase === 'revealed' && r.item.rarity === 4).length;
  const legendPullCount = results.filter((r) => r.phase === 'revealed' && r.item.rarity === 3).length;
  const promotedPullCount = results.filter((r) => r.phase === 'revealed' && r.shouldPromoteAnim).length;
  const keptPullCount = results.filter((r) => r.phase === 'revealed' && r.salvagedDust === 0).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chest-modal-title"
    >
      <div className="flex max-h-[92vh] w-[min(760px,96vw)] flex-col gap-3 overflow-y-auto rounded-xl border border-amber-400/50 bg-[#141e30] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.75)]">
        <div className="flex items-center justify-between gap-2">
          <h2 id="chest-modal-title" className="flex items-center gap-2 text-base font-extrabold text-amber-300">
            <PixelSpriteIcon spriteKey="chest_sealed" size={26} animate />
            <span>封印の宝箱ガチャ</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isOpening}
            className="rounded-md border border-slate-400/25 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 disabled:opacity-40"
          >
            ✕ 閉じる
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-400/20 bg-black/35 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1">
              <PixelSpriteIcon spriteKey="chest_sealed" size={18} />
              <span>
                所持 封印箱 <strong className="text-amber-400 tabular-nums">{fmt(chests)}</strong> 個
              </span>
            </span>
            <span className="text-slate-500">/</span>
            <span className="inline-flex items-center gap-1">
              <PixelSpriteIcon spriteKey="chest_mythic" size={18} animate={mythicChests > 0} />
              <span>
                虹の宝箱 <strong className="mythic-text tabular-nums">{fmt(mythicChests)}</strong> 個
              </span>
            </span>
            <span className="text-slate-400">（排出基準: St.{maxStage}）</span>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={autoSalvageChecked}
              onChange={(e) => onToggleAutoSalvage(e.target.checked)}
              className="accent-sky-400"
            />
            <span>自動分解設定を適用</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onPull(1, false)}
            disabled={isOpening || chests < 1}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-gradient-to-br from-amber-700 to-amber-900 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PixelSpriteIcon spriteKey="chest_sealed" size={16} />
            <span>1個開ける</span>
          </button>
          <button
            type="button"
            onClick={() => onPull(CHEST_BATCH_MAX, false)}
            disabled={isOpening || chests < 1}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-400 bg-gradient-to-br from-blue-600 to-blue-700 px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PixelSpriteIcon spriteKey="chest_gold" size={16} />
            <span>✨ まとめて開ける（最大{CHEST_BATCH_MAX}個）</span>
          </button>
          <button
            type="button"
            onClick={() => onPull(1, true)}
            disabled={isOpening || mythicChests < 1}
            className="inline-flex items-center gap-1.5 rounded-md border border-pink-400 bg-gradient-to-r from-pink-600 via-violet-600 to-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PixelSpriteIcon spriteKey="chest_mythic" size={16} animate={mythicChests > 0} />
            <span>虹の宝箱を開ける (確定)</span>
          </button>
        </div>

        <div
          data-testid="chest-result-grid"
          className="grid min-h-[240px] max-h-[430px] content-start grid-cols-1 gap-2 overflow-y-auto rounded-lg border border-white/5 bg-black/30 p-2.5 sm:grid-cols-3"
        >
          {results.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center gap-2 py-9 text-center text-xs leading-relaxed text-slate-400">
              <PixelSpriteIcon spriteKey="chest_sealed" size={48} animate />
              <div>
                <p>ボス討伐や100層節目、放置収益・妖精のお土産で宝箱が貯まります。</p>
                <p>上のボタンから最大{CHEST_BATCH_MAX}個（3×3）まとめて開封できます。</p>
              </div>
            </div>
          ) : (
            results.map((res) => {
              const it = res.item;
              const rInfo = RARITIES[it.rarity];
              const sInfo = SLOTS[it.slot];

              if (res.phase === 'waiting') {
                return (
                  <div
                    key={res.id}
                    className="flex min-h-[104px] flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-500/30 bg-slate-800/80 p-2"
                  >
                    <PixelSpriteIcon spriteKey="chest_sealed" size={34} />
                    <div className="text-[11px] font-semibold text-slate-400">開封待機中...</div>
                  </div>
                );
              }

              if (res.phase === 'shaking') {
                const fakeR = RARITIES[res.fakeRarityId ?? 1];
                const isHighRoll = (res.fakeRarityId ?? 1) >= 3;
                return (
                  <div
                    key={res.id}
                    className="gacha-card-shake relative flex min-h-[104px] flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border bg-slate-900/95 p-2"
                    style={{
                      borderColor: fakeR.color,
                      boxShadow: `inset 0 0 22px ${fakeR.bg}, 0 0 14px ${fakeR.color}40`,
                    }}
                  >
                    <div className="chest-rattle relative flex items-center justify-center">
                      <PixelSpriteIcon
                        spriteKey={isHighRoll ? 'chest_mythic' : 'chest_sealed'}
                        size={38}
                        animate
                        intervalMs={180}
                      />
                    </div>
                    <div className="text-xs font-extrabold tracking-wide" style={{ color: fakeR.color }}>
                      {fakeR.name}…？
                    </div>
                  </div>
                );
              }

              const isHighRarity = it.rarity >= 3;
              const isMythic = it.rarity === 4;
              const affix = it.uniqueAffix ? UNIQUE_AFFIX_MAP[it.uniqueAffix.key] : null;
              const isPersonal = PERSONAL_SLOTS.includes(it.slot);

              return (
                <div
                  key={res.id}
                  className="gacha-card-pop relative flex min-h-[104px] flex-col justify-between gap-1 overflow-hidden rounded-lg border p-2.5"
                  style={{
                    borderColor: rInfo.border,
                    background: rInfo.bg,
                    boxShadow: isMythic
                      ? '0 0 18px rgba(244, 114, 182, 0.35), inset 0 0 18px rgba(56, 189, 248, 0.18)'
                      : isHighRarity
                        ? '0 0 14px rgba(251, 191, 36, 0.25), inset 0 0 14px rgba(251, 191, 36, 0.12)'
                        : undefined,
                  }}
                >
                  {isHighRarity && (
                    <div
                      aria-hidden="true"
                      className="chest-burst-glow pointer-events-none absolute inset-0 rounded-lg"
                      style={{
                        background: isMythic
                          ? 'radial-gradient(circle, rgba(244,114,182,0.55) 0%, rgba(56,189,248,0.2) 55%, transparent 80%)'
                          : 'radial-gradient(circle, rgba(251,191,36,0.45) 0%, transparent 75%)',
                      }}
                    />
                  )}

                  <div className="relative z-10 flex items-center justify-between gap-1 text-[11px]">
                    <div className="flex items-center gap-1">
                      <PixelSpriteIcon
                        spriteKey={isMythic ? 'chest_mythic' : 'chest_open'}
                        size={16}
                        animate={isMythic}
                      />
                      <span className="font-extrabold" style={{ color: rInfo.color }}>
                        {rInfo.name}
                      </span>
                      {res.shouldPromoteAnim && (
                        <span className="promote-badge-pop rounded border border-amber-300/70 bg-amber-400/20 px-1 py-0 text-[9px] font-black text-amber-200">
                          昇格!
                        </span>
                      )}
                    </div>
                    <span className="text-slate-400">
                      {sInfo.isFixedCap ? '固定上限' : `St.${it.stage}`}
                    </span>
                  </div>

                  <div className="relative z-10 truncate text-xs font-extrabold">
                    {it.icon} <RarityName item={it} />
                  </div>
                  <div className="relative z-10 flex items-center justify-between gap-1 text-[11px] text-slate-200">
                    <span>
                      {sInfo.mainLabel} +{fmt(getMainStatVal(it))}{sInfo.unit}
                    </span>
                    {affix && (
                      <span className="shrink-0 rounded bg-fuchsia-500/25 px-1 text-[9px] font-bold text-fuchsia-200">
                        {affix.icon}{affix.label}
                      </span>
                    )}
                  </div>
                  <div className="relative z-10 truncate text-[10px] text-slate-400">
                    {it.subStats.map((s) => SUB_MAP[s.key].label).join(' / ')}
                  </div>
                  {res.salvagedDust > 0 ? (
                    <div className="relative z-10 text-[11px] font-bold text-sky-400">
                      ♻️ {res.bagFull ? '満杯' : '自動'}分解 +{fmt(res.salvagedDust)}💎
                    </div>
                  ) : (
                    <div className="relative z-10 mt-0.5 flex items-center justify-between gap-1">
                      <span className="text-[10px] text-slate-400">
                        {sInfo.label} · {it.subStats.length}オプ
                      </span>
                      <button
                        type="button"
                        disabled={res.equippedFromModal}
                        onClick={() => onEquipFromResult(res.id, it.id)}
                        className="rounded border border-blue-400/70 bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-blue-500 disabled:opacity-45"
                      >
                        {res.equippedFromModal
                          ? '装備済'
                          : isPersonal && targetMemberName
                            ? `${targetMemberName}へ`
                            : '装備'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {allRevealed && results.length > 0 && (
          <div
            data-testid="chest-batch-summary"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-500/25 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300"
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-bold text-slate-200">開封結果 ({results.length}個)</span>
              {mythicPullCount > 0 && (
                <span className="mythic-text font-extrabold">ミシック ×{mythicPullCount}</span>
              )}
              {legendPullCount > 0 && (
                <span className="font-bold text-amber-300">レジェンド ×{legendPullCount}</span>
              )}
              {promotedPullCount > 0 && (
                <span className="font-bold text-pink-300">昇格演出 ×{promotedPullCount}</span>
              )}
              {keptPullCount > 0 && (
                <span className="text-slate-400">バッグ格納 ×{keptPullCount}</span>
              )}
            </div>
            {totalSalvagedDust > 0 && (
              <span className="font-bold text-sky-300">
                自動分解合計 +{fmt(totalSalvagedDust)}💎
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
