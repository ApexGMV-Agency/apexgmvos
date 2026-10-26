// Shared canvas signature pad — used by the public signing page (/sign/:token)
// and by the handler's Contract template modal.
//
// WHY THIS IS A HOOK WITH NATIVE LISTENERS INSTEAD OF React onPointer* props:
// the first version wired React's onPointerDown/Move/Up/Leave straight onto the
// canvas and called setPointerCapture() in pointerdown. That works with a mouse
// and is BROKEN ON iOS SAFARI, for two independent reasons:
//
//   1. WebKit already gives a touch pointer an IMPLICIT capture on pointerdown.
//      Calling setPointerCapture() on top of that is a long-standing WebKit
//      defect: the element reports gotpointercapture but the following
//      pointermove/pointerup are no longer delivered to it. The stroke dies
//      after the initial dot.
//   2. Ending the stroke on `pointerleave` — without a capture that actually
//      holds, the first pixel of movement fires pointerleave on WebKit, so
//      drawing.current flips to false before any pointermove can land.
//
// So: NO setPointerCapture, NO pointerleave, and move/up are listened for on
// WINDOW (which is what the capture was trying to emulate anyway). A
// passive:false touchmove listener stops iOS scroll/rubber-band while a stroke
// is in flight — touch-action:none alone is not enough once Safari has already
// begun a gesture. Touch events are also the full drawing path on any browser
// without PointerEvent.
//
// The backing store is sized to the element's CSS box * devicePixelRatio, so a
// signature drawn in a narrow phone-width pad is exported at the aspect ratio it
// was DRAWN at (the old fixed 560x170 store stretched phone signatures ~1.5x
// horizontally in the contract PDF, which embeds by image aspect).

import { useCallback, useEffect, useRef, useState } from 'react';

type Options = {
  /** Fired on the first point of every stroke (used to drop an uploaded SVG). */
  onStrokeStart?: () => void;
  color?: string;
  /** Stroke width in CSS pixels. */
  lineWidth?: number;
};

export type SignaturePad = {
  /** Attach to the <canvas>. A CALLBACK ref, not a RefObject, on purpose: both
   *  pads render a spinner first, so the canvas does not exist on the mount
   *  render and an effect keyed on a RefObject would attach no listeners. */
  ref: (el: HTMLCanvasElement | null) => void;
  /** True once anything has been drawn; cleared by `clear()`. */
  dirty: boolean;
  clear: () => void;
  /** PNG data URL of the drawing, or '' when nothing has been drawn. */
  toDataURL: () => string;
};

const MAX_DPR = 2; // keeps the exported PNG small on 3x phones

export function useSignaturePad(options: Options = {}): SignaturePad {
  const { color = '#1B2430', lineWidth = 2.6 } = options;

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const drawing = useRef(false);
  const activeId = useRef<number | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  const onStart = useRef(options.onStrokeStart);
  onStart.current = options.onStrokeStart;

  const ref = useCallback((el: HTMLCanvasElement | null) => {
    canvasRef.current = el;
    // A freshly mounted canvas carries no drawing, so nothing is "dirty" on it.
    if (el) { dirtyRef.current = false; setDirty(false); }
    setCanvas(el);
  }, []);

  /** Context with the pen configured. Re-applied every time: resizing a canvas
   *  resets its context state, including the transform we scale by DPR. */
  const pen = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    return ctx;
  }, [color, lineWidth]);

  const clear = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // clear the raw bitmap, not the scaled box
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
    }
    drawing.current = false;
    last.current = null;
    activeId.current = null;
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  const toDataURL = useCallback(
    () => (dirtyRef.current && canvasRef.current ? canvasRef.current.toDataURL('image/png') : ''),
    [],
  );

  useEffect(() => {
    const c = canvas;
    if (!c) return;

    /* ── sizing ─────────────────────────────────────────────────────────── */
    const resize = () => {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (c.width === w && c.height === h) return;

      // Changing width/height wipes the bitmap — carry an in-progress signature
      // across an orientation change instead of losing it.
      let snap: HTMLCanvasElement | null = null;
      if (dirtyRef.current && c.width && c.height) {
        snap = document.createElement('canvas');
        snap.width = c.width;
        snap.height = c.height;
        snap.getContext('2d')?.drawImage(c, 0, 0);
      }
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr); // everything below works in CSS pixels
      if (snap) ctx.drawImage(snap, 0, 0, r.width, r.height);
    };
    resize();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(c);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    /* ── drawing ────────────────────────────────────────────────────────── */
    const at = (clientX: number, clientY: number) => {
      const r = c.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const begin = (x: number, y: number) => {
      const ctx = pen();
      if (!ctx) return;
      drawing.current = true;
      last.current = { x, y };
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 0.01, y); // a tap leaves a dot
      ctx.stroke();
      if (!dirtyRef.current) {
        dirtyRef.current = true;
        setDirty(true);
      }
      onStart.current?.();
    };

    const extend = (x: number, y: number) => {
      if (!drawing.current) return;
      const ctx = pen();
      if (!ctx) return;
      const from = last.current || { x, y };
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      last.current = { x, y };
    };

    const end = () => {
      drawing.current = false;
      last.current = null;
      activeId.current = null;
    };

    const cleanup: Array<() => void> = [
      () => {
        ro?.disconnect();
        window.removeEventListener('resize', resize);
        window.removeEventListener('orientationchange', resize);
      },
    ];

    if (typeof window.PointerEvent !== 'undefined') {
      const down = (e: PointerEvent) => {
        if (e.button > 0) return; // right / middle click
        // A second finger must never hijack a stroke in progress. Anything else
        // starts a fresh one — including a mouse whose pointerup was lost
        // outside the window, which would otherwise wedge the pad shut.
        if (drawing.current && e.pointerType === 'touch') return;
        activeId.current = e.pointerId;
        e.preventDefault();
        const p = at(e.clientX, e.clientY);
        begin(p.x, p.y);
      };
      // move/up live on window: no setPointerCapture (the iOS defect), and a
      // stroke that runs off the pad still finishes cleanly.
      const move = (e: PointerEvent) => {
        if (!drawing.current || e.pointerId !== activeId.current) return;
        e.preventDefault();
        const batch = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const points = batch.length ? batch : [e];
        for (const pe of points) {
          const p = at(pe.clientX, pe.clientY);
          extend(p.x, p.y);
        }
      };
      const up = (e: PointerEvent) => {
        if (activeId.current !== null && e.pointerId !== activeId.current) return;
        end();
      };
      // Belt-and-braces for iOS: touch-action:none is ignored once Safari has
      // decided a gesture is a pan, so kill the default while we own the stroke.
      const swallowTouch = (e: TouchEvent) => {
        if (drawing.current) e.preventDefault();
      };

      c.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      c.addEventListener('touchstart', swallowTouch, { passive: false });
      c.addEventListener('touchmove', swallowTouch, { passive: false });
      cleanup.push(() => {
        c.removeEventListener('pointerdown', down);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        c.removeEventListener('touchstart', swallowTouch);
        c.removeEventListener('touchmove', swallowTouch);
      });
    } else {
      // No PointerEvent (old iOS / Android WebViews): touch + mouse directly.
      const tStart = (e: TouchEvent) => {
        if (drawing.current) return;
        const t = e.changedTouches[0];
        if (!t) return;
        e.preventDefault();
        const p = at(t.clientX, t.clientY);
        begin(p.x, p.y);
      };
      const tMove = (e: TouchEvent) => {
        if (!drawing.current) return;
        const t = e.changedTouches[0];
        if (!t) return;
        e.preventDefault();
        const p = at(t.clientX, t.clientY);
        extend(p.x, p.y);
      };
      const tEnd = () => end();
      const mDown = (e: MouseEvent) => {
        if (e.button > 0) return;
        e.preventDefault();
        const p = at(e.clientX, e.clientY);
        begin(p.x, p.y);
      };
      const mMove = (e: MouseEvent) => {
        if (!drawing.current) return;
        const p = at(e.clientX, e.clientY);
        extend(p.x, p.y);
      };

      c.addEventListener('touchstart', tStart, { passive: false });
      c.addEventListener('touchmove', tMove, { passive: false });
      c.addEventListener('touchend', tEnd);
      c.addEventListener('touchcancel', tEnd);
      c.addEventListener('mousedown', mDown);
      window.addEventListener('mousemove', mMove);
      window.addEventListener('mouseup', tEnd);
      cleanup.push(() => {
        c.removeEventListener('touchstart', tStart);
        c.removeEventListener('touchmove', tMove);
        c.removeEventListener('touchend', tEnd);
        c.removeEventListener('touchcancel', tEnd);
        c.removeEventListener('mousedown', mDown);
        window.removeEventListener('mousemove', mMove);
        window.removeEventListener('mouseup', tEnd);
      });
    }

    return () => cleanup.forEach(fn => fn());
  }, [canvas, pen]);

  return { ref, dirty, clear, toDataURL };
}
