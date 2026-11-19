import { RARITIES } from '../game/constants';
import { fmt } from '../game/items';
import type { OfflineSummary } from '../game/types';

interface OfflineModalProps {
  summary: OfflineSummary | null;
  onClose: () => void;
}

export function OfflineModal({ summary, onClose }: OfflineModalProps) {
  if (!summary) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offline-modal-title"
    >
      <div className="flex w-[min(460px,95vw)] flex-col gap-3 rounded-xl border border-amber-400/50 bg-[#162033] p-5 shadow-2xl">
        <h2 id="offline-modal-title" className="text-base font-extrabold text-amber-400">
          🌙 おかえりなさい！放置収益
        </h2>
        <p className="text-xs text-slate-400">不在中も勇者は迷宮を探索し続けました。</p>

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-black/30 p-3">
          <div>
            <div className="text-[10px] text-slate-400">経過時間</div>
            <div className="text-xs font-bold text-slate-100">{summary.durationStr}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">討伐した敵</div>
            <div className="text-xs font-bold text-slate-100">{fmt(summary.kills)} 体</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">獲得強化石</div>
            <div className="text-xs font-bold text-sky-400">+{fmt(summary.stones)} 💎</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">獲得装備 / 箱</div>
            <div className="text-xs font-bold text-amber-400">
              {summary.keptItems.length}個 / 📦+{summary.chests}
            </div>
          </div>
        </div>

        <div className="flex max-h-[130px] flex-col gap-1 overflow-y-auto rounded-md bg-black/30 p-2 text-[11px]">
          {summary.keptItems.length === 0 ? (
            <div className="py-2 text-center text-slate-400">
              バッグに入った装備はありません（自動分解/満杯分は強化石に変換されました）
            </div>
          ) : (
            <>
              {summary.keptItems.slice(0, 30).map((it) => {
                const r = RARITIES[it.rarity];
                return (
                  <div key={it.id} style={{ color: r.color }}>
                    {it.icon} [{r.name}] {it.name} (St.{it.stage})
                  </div>
                );
              })}
              {summary.keptItems.length > 30 && (
                <div className="text-slate-400">…ほか {summary.keptItems.length - 30} 個</div>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-blue-400 bg-gradient-to-br from-blue-600 to-blue-700 py-2 text-xs font-bold text-white transition hover:brightness-110"
        >
          受け取って冒険を続ける
        </button>
      </div>
    </div>
  );
}
