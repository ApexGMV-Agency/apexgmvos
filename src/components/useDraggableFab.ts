import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

/* Drag-to-place for the floating fabs (notes + brand chat). Pointer-based:
   press-and-drag moves the button anywhere in the window (clamped to the
   viewport), the drop position persists per-fab in localStorage as
   right/bottom offsets (so the default corner anchoring survives resizes),
   and a plain click still opens the fab — a real drag suppresses the click. */
type FabPos = { right: number; bottom: number };

export function useDraggableFab(storageKey: string) {
  const [pos, setPos] = useState<FabPos | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as FabPos) : null;
    } catch { return null; }
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startY: number; right: number; bottom: number; moved: boolean; el: HTMLElement } | null>(null);
  const suppressClick = useRef(false);

  const clamp = (right: number, bottom: number, el: HTMLElement): FabPos => ({
    right: Math.min(Math.max(right, 8), Math.max(8, window.innerWidth - el.offsetWidth - 8)),
    bottom: Math.min(Math.max(bottom, 8), Math.max(8, window.innerHeight - el.offsetHeight - 8)),
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    drag.current = {
      startX: e.clientX, startY: e.clientY,
      right: window.innerWidth - rect.right,
      bottom: window.innerHeight - rect.bottom,
      moved: false, el,
    };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 6) return; // dead zone: keep taps as clicks
      d.moved = true;
      setDragging(true);
    }
    setPos(clamp(d.right - dx, d.bottom - dy, d.el));
  };
  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (!d.moved) return;
    suppressClick.current = true;
    const p = clamp(d.right - (e.clientX - d.startX), d.bottom - (e.clientY - d.startY), d.el);
    setPos(p);
    try { localStorage.setItem(storageKey, JSON.stringify(p)); } catch { /* ignore */ }
  };
  const onClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const style: CSSProperties | undefined = pos
    ? { right: pos.right, bottom: pos.bottom, ...(dragging ? { transition: 'none' } : null) }
    : undefined;
  return {
    style,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onClickCapture },
  };
}

