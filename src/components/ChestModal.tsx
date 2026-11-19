import { CHEST_BATCH_MAX, RARITIES, SLOTS, SUB_MAP } from '../game/constants';
import { fmt, getMainStatVal } from '../game/items';
import type { GachaPullResult } from '../game/types';
import { RarityName } from './RarityName';

interface ChestModalProps {
  open: boolean;
  chests: number;
  mythicChests: number;
  maxStage: number;
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
  autoSalvageChecked,
  isOpening,
  results,
  onToggleAutoSalvage,
  onPull,
  onEquipFromResult,
  onClose,
}: ChestModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chest-modal-title"
    >
      <div className="flex max-h-[92vh] w-[min(740px,96vw)] flex-col gap-3 overflow-y-auto rounded-xl border border-amber-400/45 bg-[#162033] p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <h2 id="chest-modal-title" className="flex items-center gap-2 text-base font-extrabold text-amber-400">
            <span>📦 封印の宝箱ガチャ</span>
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

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-400/20 bg-black/30 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              所持: 📦 封印箱 <strong className="text-amber-400">{fmt(chests)}</strong> 個
            </span>
            <span className="text-slate-500">/</span>
            <span>
              🌈 虹の宝箱 <strong className="mythic-text">{fmt(mythicChests)}</strong> 個
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
            className="rounded-md border border-amber-400 bg-gradient-to-br from-amber-700 to-amber-900 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            📦 1個開ける
          </button>
          <button
            type="button"
            onClick={() => onPull(CHEST_BATCH_MAX, false)}
            disabled={isOpening || chests < 1}
            className="rounded-md border border-blue-400 bg-gradient-to-br from-blue-600 to-blue-700 px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✨ まとめて開ける（最大{CHEST_BATCH_MAX}個）
          </button>
          <button
            type="button"
            onClick={() => onPull(1, true)}
            disabled={isOpening || mythicChests < 1}
            className="rounded-md border border-pink-400 bg-gradient-to-r from-pink-600 via-violet-600 to-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            🌈 虹の宝箱を開ける (確定)
          </button>
        </div>

        <div
          data-testid="chest-result-grid"
          className="grid min-h-[220px] max-h-[420px] content-start grid-cols-1 gap-2 overflow-y-auto rounded-lg bg-black/25 p-2 sm:grid-cols-3"
        >
          {results.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-10 text-center text-xs leading-relaxed text-slate-400">
              <p>ボス討伐や100層節目、放置収益で宝箱が貯まります。</p>
              <p>上のボタンから最大{CHEST_BATCH_MAX}個（3×3）まとめて開封できます。</p>
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
                    className="flex min-h-[96px] flex-col items-center justify-center rounded-lg border border-slate-500/30 bg-slate-800/80 p-2"
                  >
                    <div className="text-2xl">📦</div>
                    <div className="mt-1 text-[11px] text-slate-400">開封待機中...</div>
                  </div>
                );
              }

              if (res.phase === 'shaking') {
                const fakeR = RARITIES[res.fakeRarityId ?? 1];
                return (
                  <div
                    key={res.id}
                    className="gacha-card-shake flex min-h-[96px] flex-col items-center justify-center rounded-lg border bg-slate-800/90 p-2"
                    style={{ borderColor: fakeR.color }}
                  >
                    <div className="text-2xl">✨</div>
                    <div className="mt-1 text-xs font-bold" style={{ color: fakeR.color }}>
                      {fakeR.name}…？
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={res.id}
                  className="gacha-card-pop flex min-h-[96px] flex-col justify-between gap-1 rounded-lg border p-2.5"
                  style={{ borderColor: rInfo.border, background: rInfo.bg }}
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold" style={{ color: rInfo.color }}>
                      {rInfo.name}
                    </span>
                    <span className="text-slate-400">
                      {sInfo.isFixedCap ? '固定上限' : `St.${it.stage}`}
                    </span>
                  </div>
                  <div className="truncate text-xs font-extrabold">
                    {it.icon} <RarityName item={it} />
                  </div>
                  <div className="text-[11px] text-slate-200">
                    {sInfo.mainLabel} +{fmt(getMainStatVal(it))}{sInfo.unit}
                  </div>
                  <div className="truncate text-[10px] text-slate-400">
                    {it.subStats.map((s) => SUB_MAP[s.key].label).join(' / ')}
                  </div>
                  {res.salvagedDust > 0 ? (
                    <div className="text-[11px] font-bold text-sky-400">
                      ♻️ {res.bagFull ? '満杯' : '自動'}分解 +{fmt(res.salvagedDust)}💎
                    </div>
                  ) : (
                    <div className="mt-0.5 flex items-center justify-between gap-1">
                      <span className="text-[10px] text-slate-400">
                        {sInfo.label} · {it.subStats.length}オプ
                      </span>
                      <button
                        type="button"
                        disabled={res.equippedFromModal}
                        onClick={() => onEquipFromResult(res.id, it.id)}
                        className="rounded border border-blue-400/70 bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-blue-500 disabled:opacity-45"
                      >
                        {res.equippedFromModal ? '装備済' : '装備'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
