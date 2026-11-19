import { useRef, type CSSProperties, type DragEvent, type PointerEvent, type ReactNode } from 'react';

export interface WindowPos {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

interface FloatingWindowProps {
  id: string;
  ariaLabel: string;
  open: boolean;
  zIndex: number;
  position: WindowPos;
  size: WindowSize;
  minSize?: WindowSize;
  isDropOver?: boolean;
  dropHintText?: string;
  onFocus: () => void;
  onMovePosition: (next: WindowPos) => void;
  onResize?: (next: WindowSize) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
  headerLeft: ReactNode;
  headerRight: ReactNode;
  children: ReactNode;
}

export function FloatingWindow({
  id,
  ariaLabel,
  open,
  zIndex,
  position,
  size,
  minSize = { width: 460, height: 400 },
  isDropOver = false,
  dropHintText,
  onFocus,
  onMovePosition,
  onResize,
  onDragOver,
  onDragLeave,
  onDrop,
  headerLeft,
  headerRight,
  children,
}: FloatingWindowProps) {
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
  } | null>(null);

  if (!open) return null;

  const handleHeaderPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    onFocus();
    // Only drag on desktop/tablet (>=768px) and primary mouse/touch button, ignoring interactive controls
    if (window.innerWidth < 768) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, select, input, a, [data-no-window-drag="true"]')) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: position.x,
      origY: position.y,
    };
  };

  const handleHeaderPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragStateRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const maxX = Math.max(8, window.innerWidth - 220);
    const maxY = Math.max(8, window.innerHeight - 64);
    onMovePosition({
      x: Math.max(8, Math.min(maxX, d.origX + dx)),
      y: Math.max(8, Math.min(maxY, d.origY + dy)),
    });
  };

  const handleHeaderPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === e.pointerId) {
      dragStateRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const handleResizePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!onResize || window.innerWidth < 768) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.stopPropagation();
    e.preventDefault();
    onFocus();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origW: size.width,
      origH: size.height,
    };
  };

  const handleResizePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = resizeStateRef.current;
    if (!r || !onResize || r.pointerId !== e.pointerId) return;
    const maxW = Math.max(minSize.width, window.innerWidth - position.x - 8);
    const maxH = Math.max(minSize.height, window.innerHeight - position.y - 8);
    onResize({
      width: Math.round(Math.max(minSize.width, Math.min(maxW, r.origW + (e.clientX - r.startX)))),
      height: Math.round(Math.max(minSize.height, Math.min(maxH, r.origH + (e.clientY - r.startY)))),
    });
  };

  const handleResizePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (resizeStateRef.current?.pointerId === e.pointerId) {
      resizeStateRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const windowStyle = {
    zIndex,
    left: `${position.x}px`,
    top: `${position.y}px`,
    '--win-w': `${size.width}px`,
    '--win-h': `${size.height}px`,
  } as CSSProperties;

  return (
    <div
      id={id}
      role="dialog"
      aria-label={ariaLabel}
      onPointerDown={onFocus}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={windowStyle}
      className={`fixed flex flex-col overflow-hidden rounded-xl border bg-[#0f172a] shadow-[0_18px_50px_rgba(0,0,0,0.72)] transition-shadow md:h-[min(var(--win-h),calc(100dvh-16px))] md:w-[min(var(--win-w),calc(100vw-16px))] max-md:!left-0 max-md:!top-0 max-md:inset-0 max-md:h-[100dvh] max-md:w-screen max-md:rounded-none ${
        isDropOver
          ? 'border-emerald-400 ring-2 ring-emerald-400 shadow-[0_0_28px_rgba(16,185,129,0.4)]'
          : 'border-sky-400/45'
      }`}
    >
      {/* Draggable Title Bar */}
      <div
        data-window-drag-handle={id}
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-400/20 bg-[#162033] px-3 py-2 select-none md:cursor-grab md:active:cursor-grabbing"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-extrabold">
          <span className="hidden text-xs text-slate-500 md:inline" aria-hidden="true">
            ⋮⋮
          </span>
          {headerLeft}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{headerRight}</div>
      </div>

      {/* Drop Overlay Banner when compatible item hovers */}
      {isDropOver && dropHintText && (
        <div className="pointer-events-none shrink-0 border-b border-emerald-400/40 bg-emerald-500/20 px-3 py-1 text-center text-xs font-extrabold text-emerald-200">
          {dropHintText}
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>

      {/* Desktop Bottom-Right Resize Grip */}
      {onResize && (
        <div
          data-window-resize-handle={id}
          title="ドラッグしてウィンドウサイズを変更"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
          className="absolute right-0 bottom-0 z-10 hidden h-4 w-4 cursor-nwse-resize items-end justify-end p-0.5 text-slate-500 transition hover:text-sky-300 md:flex"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
