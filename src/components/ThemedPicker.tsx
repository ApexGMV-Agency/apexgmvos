import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './themedPicker.css';

/**
 * THE PAYROLL DATE + MONTH PICKERS — the Salary Dashboard, Incentives & KPIs and
 * the Profile page's own salary/overtime cards, in place of the browser's
 * native `<input type="date|month">`, whose calendar is drawn by the OS and
 * cannot be themed at all.
 *
 * ‼️ THE VALUE IS THE SAME STRING THE NATIVE INPUT CARRIED — `YYYY-MM-DD` /
 * `YYYY-MM`, '' for blank — so every call site keeps its state, its
 * validation and its write exactly as they were. It is never parsed through
 * `new Date('YYYY-MM-DD')` (that is UTC — the day-before trap); dates are
 * built and compared from their parts.
 *
 * ‼️ THE POPOVER IS PORTALLED INTO THE ENCLOSING `.modal`, NOT `document.body`.
 * Half of these fields live inside react-bootstrap modals: the KPI form is
 * `scrollable`, so an inline popover is clipped by the modal body, and a
 * popover in `body` sits outside the modal's focus trap, which pulls focus
 * back the moment a day is clicked or arrowed to. `.modal` itself carries no
 * transform, so `position: fixed` inside it still means the viewport.
 *
 * ‼️ ESCAPE IS STOPPED AT THE POPOVER (a native listener), so closing the
 * calendar does not also close the dialog it is in.
 *
 * The palette is the payroll one (fill #c2570c, ink #a4530c) — the app's own
 * #e8862e fails AA under white text — and the font is read off the trigger at
 * open, because a portal does not inherit the page's scoped font.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const monthOf = (y: number, m: number) => `${y}-${pad(m + 1)}`;
function partsOf(iso: string): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso || '');
  if (!r) return null;
  return { y: +r[1], m: +r[2] - 1, d: r[3] ? +r[3] : 1 };
}
function todayParts() {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS_LONG.map(m => m.slice(0, 3));
/** Monday first — the payroll week is Mon–Fri, so weekends sit together at the end. */
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** "Sep 15, 2026" — a date that decides somebody's pay carries its year. */
export function pickerDateLabel(iso: string): string {
  const p = partsOf(iso);
  return p && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${MONTHS_SHORT[p.m]} ${p.d}, ${p.y}` : '';
}
export function pickerMonthLabel(ym: string): string {
  const p = partsOf(ym);
  return p ? `${MONTHS_LONG[p.m]} ${p.y}` : '';
}

/* ───────────────────────── the floating panel ───────────────────────── */

function usePopover(open: boolean, setOpen: (v: boolean) => void) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; font: string } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const pop = popRef.current;
    const w = pop?.offsetWidth ?? 300;
    const h = pop?.offsetHeight ?? 340;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8 && r.top - h - 6 >= 8) top = r.top - h - 6;
    setPos({ top, left, font: getComputedStyle(t).fontFamily });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    setHost((triggerRef.current?.closest('.modal') as HTMLElement | null) ?? document.body);
    place();
  }, [open, place]);
  // A second pass once the panel has a real size, so flipping above is exact.
  useLayoutEffect(() => { if (open && host) place(); }, [open, host, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (popRef.current?.contains(n) || triggerRef.current?.contains(n)) return;
      setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place, setOpen]);

  // Native, so it runs before react-bootstrap's document listener.
  useEffect(() => {
    const el = popRef.current;
    if (!open || !el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.querySelector('button')?.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [open, host, setOpen]);

  const render = (children: ReactNode, label: string) => (open && host ? createPortal(
    <div ref={popRef} className="ac-dp-pop" role="dialog" aria-label={label}
      style={{
        top: pos?.top ?? -9999, left: pos?.left ?? -9999,
        fontFamily: pos?.font, visibility: pos ? 'visible' : 'hidden',
      }}>
      {children}
    </div>, host) : null);

  /** The panel is in the DOM and placed — focus may be moved into it. */
  const ready = open && !!host && !!pos;
  return { triggerRef, popRef, render, ready };
}

/* ───────────────────────── the trigger ───────────────────────── */

function Trigger({
  variant, icon, text, placeholder, disabled, open, onToggle, onClear, ariaLabel, id, invalid, current,
}: {
  variant: 'field' | 'chip'; icon: string; text: string; placeholder: string;
  disabled?: boolean; open: boolean; onToggle: () => void; onClear?: () => void;
  ariaLabel?: string; id?: string; invalid?: boolean;
  /** The picked value is this control's (not one of the tabs beside it). */
  current?: boolean;
}) {
  return (
    <>
      <button type="button" id={id} disabled={disabled}
        className={`ac-dp-trigger ac-dp-${variant}${open ? ' is-open' : ''}${text ? '' : ' is-empty'}${onClear && text ? ' has-clear' : ''}${invalid ? ' is-invalid' : ''}${current ? ' is-current' : ''}`}
        aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel ? `${ariaLabel}${text ? `: ${text}` : ''}` : undefined}
        onClick={onToggle}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); onToggle(); } }}>
        <i className={`bi ${icon} ac-dp-icon`} aria-hidden />
        <span className="ac-dp-text">{text || placeholder}</span>
        {!(onClear && text) && <i className="bi bi-chevron-down ac-dp-caret" aria-hidden />}
      </button>
      {onClear && text && !disabled && (
        <button type="button" className="ac-dp-clear" aria-label="Clear" title="Clear"
          onClick={onClear}><i className="bi bi-x-lg" /></button>
      )}
    </>
  );
}

/* ───────────────────────── DateField ───────────────────────── */

export function DateField({
  value, onChange, min, max, disabled, placeholder = 'Pick a date', clearable,
  ariaLabel, id, className, variant = 'field', invalid,
}: {
  /** `YYYY-MM-DD`, or '' for no date. */
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Offer a way back to blank — only where blank means something. */
  clearable?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  variant?: 'field' | 'chip';
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, popRef, render, ready } = usePopover(open, setOpen);
  const today = todayParts();
  const todayIso = isoOf(today.y, today.m, today.d);
  const sel = /^\d{4}-\d{2}-\d{2}$/.test(value) ? partsOf(value) : null;

  const [view, setView] = useState({ y: today.y, m: today.m });
  const [mode, setMode] = useState<'days' | 'months'>('days');
  const [focus, setFocus] = useState(todayIso);

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  // Opening shows the selected day's month (else today's, clamped into range).
  useEffect(() => {
    if (!open) return;
    let start = sel ? value : todayIso;
    if (!sel) { if (min && start < min) start = min; if (max && start > max) start = max; }
    const p = partsOf(start)!;
    setView({ y: p.y, m: p.m });
    setMode('days');
    setFocus(start);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep keyboard focus on the focused day.
  useEffect(() => {
    if (!ready || mode !== 'days') return;
    const el = popRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`);
    el?.focus({ preventScroll: true });
  }, [ready, mode, focus, view, popRef]);

  const pick = (iso: string) => {
    if (!inRange(iso)) return;
    onChange(iso);
    setOpen(false);
    triggerRef.current?.querySelector('button')?.focus();
  };

  const shiftMonth = (delta: number) => setView(v => {
    const d = new Date(v.y, v.m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday = 0
    const out: { iso: string; d: number; inMonth: boolean; weekend: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const dt = new Date(view.y, view.m, 1 - lead + i);
      out.push({
        iso: isoOf(dt.getFullYear(), dt.getMonth(), dt.getDate()),
        d: dt.getDate(),
        inMonth: dt.getMonth() === view.m,
        weekend: i % 7 >= 5,
      });
    }
    // Drop a trailing week that belongs entirely to the next month.
    return out.slice(35).every(c => !c.inMonth) ? out.slice(0, 35) : out;
  }, [view]);

  const moveFocus = (days: number) => {
    const p = partsOf(focus)!;
    const dt = new Date(p.y, p.m, p.d + days);
    const iso = isoOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
    setFocus(iso);
    if (dt.getMonth() !== view.m || dt.getFullYear() !== view.y) setView({ y: dt.getFullYear(), m: dt.getMonth() });
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (step[e.key] != null) { e.preventDefault(); moveFocus(step[e.key]); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const p = partsOf(focus)!;
      const dt = new Date(p.y, p.m + (e.key === 'PageUp' ? -1 : 1), 1);
      const d = Math.min(p.d, daysIn(dt.getFullYear(), dt.getMonth()));
      const iso = isoOf(dt.getFullYear(), dt.getMonth(), d);
      setFocus(iso);
      setView({ y: dt.getFullYear(), m: dt.getMonth() });
    }
  };

  const minMonth = min ? min.slice(0, 7) : null;
  const maxMonth = max ? max.slice(0, 7) : null;
  const canPrev = !minMonth || monthOf(view.y, view.m) > minMonth;
  const canNext = !maxMonth || monthOf(view.y, view.m) < maxMonth;

  return (
    <div ref={triggerRef} className={`ac-dp${className ? ` ${className}` : ''}`}>
      <Trigger variant={variant} icon="bi-calendar3" text={pickerDateLabel(value)} placeholder={placeholder}
        disabled={disabled} open={open} onToggle={() => setOpen(o => !o)} ariaLabel={ariaLabel} id={id}
        invalid={invalid} onClear={clearable ? () => onChange('') : undefined} />
      {render(
        <>
          <div className="ac-dp-head">
            <button type="button" className="ac-dp-nav" aria-label={mode === 'days' ? 'Previous month' : 'Previous year'}
              disabled={mode === 'days' && !canPrev}
              onClick={() => (mode === 'days' ? shiftMonth(-1) : setView(v => ({ ...v, y: v.y - 1 })))}>
              <i className="bi bi-chevron-left" />
            </button>
            <button type="button" className="ac-dp-title" aria-label="Choose month and year"
              onClick={() => setMode(m => (m === 'days' ? 'months' : 'days'))}>
              {mode === 'days' ? `${MONTHS_LONG[view.m]} ${view.y}` : view.y}
              <i className={`bi bi-chevron-${mode === 'days' ? 'down' : 'up'}`} />
            </button>
            <button type="button" className="ac-dp-nav" aria-label={mode === 'days' ? 'Next month' : 'Next year'}
              disabled={mode === 'days' && !canNext}
              onClick={() => (mode === 'days' ? shiftMonth(1) : setView(v => ({ ...v, y: v.y + 1 })))}>
              <i className="bi bi-chevron-right" />
            </button>
          </div>

          {mode === 'days' ? (
            <div className="ac-dp-grid" role="grid" onKeyDown={onGridKey}>
              {WEEKDAYS.map((w, i) => (
                <span key={w} className={`ac-dp-wd${i >= 5 ? ' is-weekend' : ''}`} role="columnheader">{w}</span>
              ))}
              {cells.map(c => {
                const ok = inRange(c.iso);
                const isSel = c.iso === value;
                return (
                  <button type="button" key={c.iso} data-iso={c.iso} role="gridcell"
                    tabIndex={c.iso === focus ? 0 : -1} disabled={!ok}
                    aria-selected={isSel} aria-label={pickerDateLabel(c.iso)}
                    className={`ac-dp-day${c.inMonth ? '' : ' is-out'}${c.weekend ? ' is-weekend' : ''}${isSel ? ' is-sel' : ''}${c.iso === todayIso ? ' is-today' : ''}`}
                    onClick={() => pick(c.iso)}>
                    {c.d}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="ac-dp-months">
              {MONTHS_SHORT.map((name, i) => {
                const ym = monthOf(view.y, i);
                const ok = (!minMonth || ym >= minMonth) && (!maxMonth || ym <= maxMonth);
                return (
                  <button type="button" key={name} disabled={!ok}
                    className={`ac-dp-mon${view.m === i ? ' is-sel' : ''}${today.y === view.y && today.m === i ? ' is-today' : ''}`}
                    onClick={() => { setView({ y: view.y, m: i }); setMode('days'); setFocus(isoOf(view.y, i, 1)); }}>
                    {name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="ac-dp-foot">
            <button type="button" className="ac-dp-link" disabled={!inRange(todayIso)}
              onClick={() => pick(todayIso)}>Today</button>
            {clearable && value && (
              <button type="button" className="ac-dp-link is-muted"
                onClick={() => { onChange(''); setOpen(false); }}>Clear</button>
            )}
          </div>
        </>,
        'Choose a date',
      )}
    </div>
  );
}

/* ───────────────────────── TimeField ───────────────────────── */

/** "HH:MM" (24h) → "9:30 AM". */
export function pickerTimeLabel(hhmm: string): string {
  const r = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!r) return '';
  const h = +r[1], m = r[2];
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The time half of the pair, in place of `<input type="time">`, whose spinner
 * and dropdown are drawn by the browser and cannot be themed.
 *
 * ‼️ THE VALUE IS THE NATIVE INPUT'S STRING — `HH:MM`, 24-hour, '' for blank —
 * so every call site keeps its state and its write untouched. Three columns
 * (hour / minute / AM-PM); minutes step by `step` (5 by default), and a stored
 * minute off that step is still listed so opening never silently changes it.
 */
export function TimeField({
  value, onChange, disabled, placeholder = 'Pick a time', clearable, ariaLabel, id, className,
  variant = 'field', invalid, step = 5,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  variant?: 'field' | 'chip';
  invalid?: boolean;
  step?: number;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, popRef, render, ready } = usePopover(open, setOpen);
  const r = /^(\d{1,2}):(\d{2})/.exec(value || '');
  const cur = r ? { h: +r[1], m: +r[2] } : null;
  // While the panel is open the three columns are edited as a draft; a pick in
  // any column writes straight away, so there is no OK button to forget.
  const base = cur ?? (() => { const n = new Date(); return { h: n.getHours(), m: Math.ceil(n.getMinutes() / step) * step % 60 }; })();
  const h12 = base.h % 12 === 0 ? 12 : base.h % 12;
  const pm = base.h >= 12;

  const minutes = useMemo(() => {
    const out: number[] = [];
    for (let m = 0; m < 60; m += step) out.push(m);
    if (cur && !out.includes(cur.m)) { out.push(cur.m); out.sort((a, b) => a - b); }
    return out;
  }, [step, cur?.m]); // eslint-disable-line react-hooks/exhaustive-deps

  const write = (hh: number, mm: number) => onChange(`${pad(hh)}:${pad(mm)}`);
  const setHour = (v12: number) => write((v12 % 12) + (pm ? 12 : 0), base.m);
  const setMin = (mm: number) => write(base.h, mm);
  const setPm = (p: boolean) => write((base.h % 12) + (p ? 12 : 0), base.m);

  // Scroll the selected hour/minute into view and focus the hour.
  useEffect(() => {
    if (!ready) return;
    popRef.current?.querySelectorAll<HTMLElement>('.ac-dp-tcol .is-sel').forEach(el =>
      el.scrollIntoView({ block: 'center' }));
    popRef.current?.querySelector<HTMLButtonElement>('.ac-dp-tcol .is-sel')?.focus({ preventScroll: true });
  }, [ready, popRef]);

  const close = () => { setOpen(false); triggerRef.current?.querySelector('button')?.focus(); };

  const colKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = [...(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  return (
    <div ref={triggerRef} className={`ac-dp${className ? ` ${className}` : ''}`}>
      <Trigger variant={variant} icon="bi-clock" text={pickerTimeLabel(value)} placeholder={placeholder}
        disabled={disabled} open={open} onToggle={() => setOpen(o => !o)} ariaLabel={ariaLabel} id={id}
        invalid={invalid} onClear={clearable ? () => onChange('') : undefined} />
      {render(
        <>
          <div className="ac-dp-head">
            <span className="ac-dp-title is-static">{cur ? pickerTimeLabel(value) : 'Pick a time'}</span>
          </div>
          <div className="ac-dp-time">
            <div className="ac-dp-tcol" role="listbox" aria-label="Hour" onKeyDown={colKey}>
              {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => (
                <button type="button" key={h} role="option" aria-selected={!!cur && h === h12}
                  className={`ac-dp-topt${cur && h === h12 ? ' is-sel' : ''}`} onClick={() => setHour(h)}>{h}</button>
              ))}
            </div>
            <div className="ac-dp-tcol" role="listbox" aria-label="Minute" onKeyDown={colKey}>
              {minutes.map(m => (
                <button type="button" key={m} role="option" aria-selected={!!cur && m === cur.m}
                  className={`ac-dp-topt${cur && m === cur.m ? ' is-sel' : ''}`} onClick={() => setMin(m)}>{pad(m)}</button>
              ))}
            </div>
            <div className="ac-dp-tcol is-ampm" role="listbox" aria-label="AM or PM" onKeyDown={colKey}>
              {[false, true].map(p => (
                <button type="button" key={String(p)} role="option" aria-selected={!!cur && p === pm}
                  className={`ac-dp-topt${cur && p === pm ? ' is-sel' : ''}`} onClick={() => setPm(p)}>{p ? 'PM' : 'AM'}</button>
              ))}
            </div>
          </div>
          <div className="ac-dp-foot">
            <button type="button" className="ac-dp-link" onClick={() => {
              const n = new Date(); write(n.getHours(), n.getMinutes());
            }}>Now</button>
            <span className="d-flex gap-1">
              {clearable && value && (
                <button type="button" className="ac-dp-link is-muted"
                  onClick={() => { onChange(''); setOpen(false); }}>Clear</button>
              )}
              <button type="button" className="ac-dp-link" onClick={close}>Done</button>
            </span>
          </div>
        </>,
        'Choose a time',
      )}
    </div>
  );
}

/* ───────────────────────── MonthField ───────────────────────── */

export function MonthField({
  value, onChange, min, max, disabled, ariaLabel = 'Pick a month', className, variant = 'chip', current,
}: {
  /** `YYYY-MM`. */
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  variant?: 'field' | 'chip';
  /** Mark the trigger as holding the active month (see MonthTabs). */
  current?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, popRef, render, ready } = usePopover(open, setOpen);
  const today = todayParts();
  const thisMonth = monthOf(today.y, today.m);
  const sel = partsOf(value);
  const [year, setYear] = useState(sel?.y ?? today.y);

  useEffect(() => { if (open) setYear(sel?.y ?? today.y); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return;
    const pop = popRef.current;
    (pop?.querySelector<HTMLButtonElement>('.ac-dp-mon.is-sel')
      ?? pop?.querySelector<HTMLButtonElement>('.ac-dp-mon:not(:disabled)'))?.focus({ preventScroll: true });
  }, [ready, popRef]);

  const ok = (ym: string) => (!min || ym >= min) && (!max || ym <= max);
  const pick = (ym: string) => {
    if (!ok(ym)) return;
    onChange(ym);
    setOpen(false);
    triggerRef.current?.querySelector('button')?.focus();
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    if (step[e.key] == null) return;
    e.preventDefault();
    const btns = [...(popRef.current?.querySelectorAll<HTMLButtonElement>('.ac-dp-mon') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = btns[Math.max(0, Math.min(11, (i < 0 ? 0 : i) + step[e.key]))];
    next?.focus();
  };

  return (
    <div ref={triggerRef} className={`ac-dp${className ? ` ${className}` : ''}`}>
      <Trigger variant={variant} icon="bi-calendar-month" text={pickerMonthLabel(value)} placeholder="Pick a month"
        disabled={disabled} open={open} onToggle={() => setOpen(o => !o)} ariaLabel={ariaLabel}
        current={current} />
      {render(
        <>
          <div className="ac-dp-head">
            <button type="button" className="ac-dp-nav" aria-label="Previous year"
              disabled={!!min && `${year - 1}-12` < min} onClick={() => setYear(y => y - 1)}>
              <i className="bi bi-chevron-left" />
            </button>
            <span className="ac-dp-title is-static">{year}</span>
            <button type="button" className="ac-dp-nav" aria-label="Next year"
              disabled={!!max && `${year + 1}-01` > max} onClick={() => setYear(y => y + 1)}>
              <i className="bi bi-chevron-right" />
            </button>
          </div>
          <div className="ac-dp-months" onKeyDown={onGridKey}>
            {MONTHS_SHORT.map((name, i) => {
              const ym = monthOf(year, i);
              return (
                <button type="button" key={name} disabled={!ok(ym)} aria-pressed={ym === value}
                  aria-label={pickerMonthLabel(ym)}
                  className={`ac-dp-mon${ym === value ? ' is-sel' : ''}${ym === thisMonth ? ' is-today' : ''}`}
                  onClick={() => pick(ym)}>
                  {name}
                </button>
              );
            })}
          </div>
          <div className="ac-dp-foot">
            <button type="button" className="ac-dp-link" disabled={!ok(thisMonth)}
              onClick={() => pick(thisMonth)}>This month</button>
          </div>
        </>,
        'Choose a month',
      )}
    </div>
  );
}

/* ───────────────────────── MonthTabs ───────────────────────── */

/** The last `count` months, newest first, from the reader's own calendar. */
function recentMonths(count: number): string[] {
  const t = todayParts();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(t.y, t.m - i, 1);
    return monthOf(d.getFullYear(), d.getMonth());
  });
}

/**
 * THE MONTH SWITCHER the three payroll surfaces head with — the recent months
 * as tabs and the picker beside them, as ONE control, so the Salary Dashboard,
 * Incentives & KPIs and the Profile card cannot drift apart again (they had
 * three different looks until 2026-10-01).
 *
 * ‼️ EXACTLY ONE THING READS AS SELECTED. A recent month lights its tab; any
 * other month lights the picker instead (`is-current`), so a reader who jumped
 * to March is never left looking at three unlit tabs wondering what is on
 * screen.
 */
export function MonthTabs({
  value, onChange, count = 3, ariaLabel = 'Month', className, max,
}: {
  value: string;
  onChange: (v: string) => void;
  /** How many recent months get a tab of their own. */
  count?: number;
  ariaLabel?: string;
  className?: string;
  max?: string;
}) {
  const quick = useMemo(() => recentMonths(count), [count]);
  const onTab = quick.includes(value);
  return (
    <div className={`ac-dp-monthbar${className ? ` ${className}` : ''}`}>
      <div className="ac-dp-monthseg" role="group" aria-label={ariaLabel}>
        {quick.map(m => {
          const p = partsOf(m)!;
          return (
            <button key={m} type="button" aria-pressed={m === value}
              className={`ac-dp-monthtab${m === value ? ' is-active' : ''}`}
              title={pickerMonthLabel(m)}
              onClick={() => onChange(m)}>
              <span className="ac-dp-long">{MONTHS_LONG[p.m]} {p.y}</span>
              <span className="ac-dp-short">{MONTHS_SHORT[p.m]} ’{String(p.y).slice(2)}</span>
            </button>
          );
        })}
      </div>
      <MonthField value={value} onChange={onChange} max={max}
        ariaLabel="Pick another month" current={!onTab} />
    </div>
  );
}

/* ───────────────────────── DateTimeField ───────────────────────── */

/**
 * The themed stand-in for `<input type="datetime-local">`. The value is the
 * native string — `YYYY-MM-DDTHH:MM`, '' for blank — so callers keep their
 * conversion code untouched. A date with no time picked yet reads as 09:00;
 * clearing the date clears the whole value.
 */
export function DateTimeField({
  value, onChange, min, max, disabled, clearable, className, invalid, defaultTime = '09:00',
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  invalid?: boolean;
  defaultTime?: string;
}) {
  const r = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value || '');
  const d = r?.[1] ?? '';
  const t = r?.[2] ?? '';
  return (
    <div className={`ac-dp-dt${className ? ' ' + className : ''}`}>
      <DateField value={d} min={min?.slice(0, 10)} max={max?.slice(0, 10)} disabled={disabled}
        invalid={invalid} clearable={clearable}
        onChange={v => onChange(v ? `${v}T${t || defaultTime}` : '')} />
      <TimeField value={t} disabled={disabled || !d} invalid={invalid}
        onChange={v => d && onChange(`${d}T${v || defaultTime}`)} />
    </div>
  );
}

/** An ISO instant as the LOCAL `YYYY-MM-DDTHH:MM` a DateTimeField carries. */
export function toLocalDT(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
