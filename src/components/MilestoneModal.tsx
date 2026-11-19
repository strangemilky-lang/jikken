interface MilestoneModalProps {
  open: boolean;
  onClose: () => void;
}

export function MilestoneModal({ open, onClose }: MilestoneModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="milestone-modal-title"
    >
      <div className="flex w-[min(460px,95vw)] flex-col gap-3 rounded-xl border border-pink-400/50 bg-[#162033] p-5 shadow-2xl">
        <h2 id="milestone-modal-title" className="mythic-text text-lg font-extrabold">
          👑 祝・100階「大魔王」討伐達成！
        </h2>
        <p className="text-xs leading-relaxed text-slate-200">
          表の迷宮を踏破しました！ここから先は終わりなきインフレと探索の裏世界が開かれます。
        </p>
        <div className="flex flex-col gap-1.5 rounded-lg border border-pink-400/35 bg-black/30 p-3 text-xs leading-relaxed text-slate-100">
          <div>🌌 <strong>裏世界（101階〜）開放</strong>：100階ごとに迷宮の色が変化</div>
          <div>🌈 <strong>新レアリティ「ミシック」解禁</strong>：虹色装備＆攻撃時追撃ヒット+1</div>
          <div>🔥 <strong>会心率100%突破解禁</strong>：100%超で超会心(2倍)、200%超で極会心(4倍)</div>
          <div>🎁 <strong>初回踏破記念</strong>：🌈 虹の宝箱 ×1 ＋ 📦 封印の宝箱 ×5 獲得</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-pink-400 bg-gradient-to-r from-pink-600 via-violet-600 to-blue-600 py-2.5 text-xs font-bold text-white transition hover:brightness-110"
        >
          裏世界（101階〜）へ挑む！
        </button>
      </div>
    </div>
  );
}
