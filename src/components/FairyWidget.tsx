import { FAIRY_BASE_COOLDOWN_SEC, getActiveFairyBuff, getFairySpeech, type FairyProfile } from '../game/fairy';
import type { FairyState } from '../game/types';

interface FairyWidgetProps {
  fairy: FairyState;
  profile: FairyProfile;
  bossActive: boolean;
  collapsed: boolean;
  claimFeedback: string;
  onClaimGift: () => void;
  onToggleCollapse: () => void;
}

function FairySprite({
  profile,
  hasGift,
  compact = false,
}: {
  profile: FairyProfile;
  hasGift: boolean;
  compact?: boolean;
}) {
  const size = compact ? 22 : 34;
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center rounded-lg ${
        compact ? 'h-6 w-6' : 'h-9 w-9'
      }`}
      style={{
        background: `radial-gradient(circle, ${profile.auraColor} 0%, rgba(15,23,42,0.5) 75%)`,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        className={hasGift ? 'animate-bounce' : ''}
      >
        {/* Outer subtle aura ring for evolved ranks (100F+) */}
        {profile.rank >= 1 && (
          <circle
            cx="20"
            cy="21"
            r="16"
            stroke={profile.accentColor}
            strokeOpacity="0.45"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
        )}
        {/* Left & Right Wings */}
        <path
          d="M19 18C13 11 5 11 6 18C7 23 14 23 19 21Z"
          fill={profile.wingColor}
          fillOpacity="0.82"
        />
        <path
          d="M21 18C27 11 35 11 34 18C33 23 26 23 21 21Z"
          fill={profile.wingColor}
          fillOpacity="0.82"
        />
        <path
          d="M19 22C14 23 10 28 13 31C16 33 19 28 19 23Z"
          fill={profile.wingColor}
          fillOpacity="0.65"
        />
        <path
          d="M21 22C26 23 30 28 27 31C24 33 21 28 21 23Z"
          fill={profile.wingColor}
          fillOpacity="0.65"
        />
        {/* Dress / Body */}
        <path
          d="M20 18L15 30H25L20 18Z"
          fill={profile.dressColor}
          stroke="#f8fafc"
          strokeOpacity="0.45"
          strokeWidth="0.9"
        />
        {/* Head */}
        <circle cx="20" cy="14" r="4.3" fill="#fde68a" />
        {/* Hair / Crown sparkle on Rank 2+ */}
        <path
          d="M15.6 13.5C16.2 9.5 23.8 9.5 24.4 13.5C22.6 11.4 17.4 11.4 15.6 13.5Z"
          fill={profile.accentColor}
        />
        {profile.rank >= 2 && (
          <polygon points="20,6 21.4,9.2 18.6,9.2" fill="#fde047" />
        )}
        {/* Eyes */}
        <circle cx="18.6" cy="14.3" r="0.65" fill="#1e293b" />
        <circle cx="21.4" cy="14.3" r="0.65" fill="#1e293b" />
        {/* Wand sparkle */}
        <circle cx="30" cy="12" r="1.4" fill={hasGift ? '#fde047' : profile.accentColor} />
      </svg>
      {hasGift && (
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black text-slate-950 shadow">
          !
        </span>
      )}
    </div>
  );
}

export function FairyWidget({
  fairy,
  profile,
  bossActive,
  collapsed,
  claimFeedback,
  onClaimGift,
  onToggleCollapse,
}: FairyWidgetProps) {
  const activeBuff = getActiveFairyBuff(fairy);
  const hasGift = fairy.giftsReady > 0;
  const remainingSec = Math.max(0, Math.ceil(fairy.cooldownSec));
  const progressPct = hasGift
    ? 100
    : Math.max(0, Math.min(100, ((FAIRY_BASE_COOLDOWN_SEC - fairy.cooldownSec) / FAIRY_BASE_COOLDOWN_SEC) * 100));

  if (collapsed) {
    return (
      <div data-testid="fairy-widget" data-fairy-collapsed="true">
        <button
          type="button"
          data-testid="fairy-toggle-btn"
          onClick={onToggleCollapse}
          title={`${profile.title}を開く`}
          className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-bold text-slate-100 shadow-lg backdrop-blur-sm transition hover:brightness-110"
          style={{
            borderColor: hasGift ? profile.accentColor : 'rgba(148,163,184,0.35)',
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
          }}
        >
          <FairySprite profile={profile} hasGift={hasGift} compact />
          <span className="text-[11px]">{profile.title}</span>
          {hasGift ? (
            <span className="rounded bg-amber-400 px-1 text-[10px] font-extrabold text-slate-950 tabular-nums">
              🎁{fairy.giftsReady}
            </span>
          ) : (
            <span className="text-[10px] text-slate-400 tabular-nums">{remainingSec}s</span>
          )}
        </button>
      </div>
    );
  }

  const speech = getFairySpeech({
    giftsReady: fairy.giftsReady,
    bossActive,
    buffKind: activeBuff?.kind ?? null,
    rank: profile.rank,
  });

  return (
    <div
      data-testid="fairy-widget"
      data-fairy-collapsed="false"
      data-fairy-rank={profile.rank}
      className="flex w-[224px] flex-col gap-1.5 rounded-xl border bg-[#0f172a]/90 p-2 shadow-2xl backdrop-blur-sm max-sm:w-[178px] max-sm:gap-1 max-sm:p-1.5"
      style={{
        borderColor: hasGift ? profile.accentColor : 'rgba(148, 163, 184, 0.28)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <FairySprite profile={profile} hasGift={hasGift} />
          <div className="min-w-0">
            <div
              className="truncate text-[11px] font-extrabold leading-tight"
              style={{ color: profile.accentColor }}
            >
              {profile.title}
            </div>
            <div className="text-[10px] text-slate-400 tabular-nums">
              {profile.rank === 0 ? 'Rank 0 (100Fで進化)' : `Rank ${profile.rank} · 枠${profile.maxGifts}`}
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid="fairy-toggle-btn"
          aria-label="妖精ウィンドウを折りたたむ"
          onClick={onToggleCollapse}
          className="shrink-0 rounded border border-slate-500/30 bg-slate-800/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-300 hover:bg-slate-700"
        >
          －
        </button>
      </div>

      {/* Speech or Fresh Claim Toast */}
      {claimFeedback ? (
        <div
          data-testid="fairy-claim-feedback"
          className="rounded border border-amber-400/45 bg-amber-500/15 px-1.5 py-1 text-[10px] font-bold text-amber-200"
        >
          {claimFeedback}
        </div>
      ) : (
        <div className="truncate rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-slate-300 max-sm:hidden">
          「{speech}」
        </div>
      )}

      {/* Active Temporary Cheer Buff */}
      {activeBuff && (
        <div
          data-testid="fairy-active-buff"
          className="flex items-center justify-between rounded border border-sky-400/35 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-200 tabular-nums"
        >
          <span>
            {activeBuff.kind === 'stones'
              ? `💎 石ドロップ +${profile.buffStonePct}%`
              : `✨ 探索速度 +${profile.buffExplorePct}%`}
          </span>
          <span>{activeBuff.remainingSec}s</span>
        </div>
      )}

      {/* 100F+ Non-Combat Passive Summary */}
      {profile.rank >= 1 && (
        <div
          data-testid="fairy-passives"
          className="flex items-center justify-between gap-1 text-[9px] text-slate-400 tabular-nums max-sm:hidden"
        >
          <span>分解+{profile.salvageBonusPct}%</span>
          <span>·</span>
          <span>はぐれ+{profile.rareSlimeBonusPct}%</span>
          <span>·</span>
          <span>放置+{profile.offlineBonusPct}%</span>
        </div>
      )}

      {/* Claim Gift CTA or Cooldown Progress */}
      {hasGift ? (
        <button
          type="button"
          data-testid="fairy-claim-btn"
          onClick={onClaimGift}
          className="flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-extrabold text-slate-950 shadow transition hover:brightness-110 active:scale-[0.98]"
          style={{
            borderColor: '#fef08a',
            background: `linear-gradient(135deg, ${profile.accentColor}, #fde047)`,
          }}
        >
          <span>🎁 お土産受取</span>
          <span className="tabular-nums">
            ({fairy.giftsReady}/{profile.maxGifts})
          </span>
        </button>
      ) : (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400 tabular-nums">
            <span>次のお土産まで</span>
            <span>あと {remainingSec}秒</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full transition-[width] duration-300"
              style={{
                width: `${progressPct}%`,
                backgroundColor: profile.accentColor,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
