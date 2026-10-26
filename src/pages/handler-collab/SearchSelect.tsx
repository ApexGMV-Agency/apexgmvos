import React from 'react';
import './searchSelect.css';

/**
 * A <select> you can type into.
 *
 * A native <option> list cannot be filtered, and both places this is used pick
 * from lists long enough that scrolling is the wrong interaction: the note
 * editor's brands and creators, and the content brief's brand picker.
 *
 * `sub` is SEARCHED as well as shown, which is the point of having it — a
 * creator is findable by handle or by brand, where the native control crammed
 * all three into one label that nothing could match against.
 */
export type SearchOption = {
  value: string;
  label: string;
  /** Second line, shown under the label and matched by the search. */
  sub?: string;
  /** Set on the synthetic "none" row; callers never pass it. */
  none?: boolean;
};

export default function SearchSelect({
  value, onChange, options, noneLabel = '— None —', placeholder = 'Type to search…',
  float = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchOption[];
  noneLabel?: string;
  placeholder?: string;
  /**
   * Overlay the panel instead of pushing the content below it down.
   *
   * OPT-IN, and it stays that way: the default is inline because of the note
   * editor (see the panel comment below), and a host that overlays inside a
   * clipping or transformed ancestor gets a panel that is cut off or in the
   * wrong place. Only pass it where neither is true — a control sitting in
   * ordinary page flow, such as a card header.
   */
  float?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const selected = options.find(o => o.value === value) || null;
  const shown = React.useMemo<SearchOption[]>(() => {
    const needle = q.trim().toLowerCase();
    // Every WORD must match somewhere in label + sub, in any order — so
    // "jane wetcat" finds Jane's Wetcat deal. A superset of the old phrase
    // match: anything the whole phrase matched still matches.
    const words = needle.split(/\s+/).filter(Boolean);
    const matches = words.length
      ? options.filter(o => {
          const hay = `${o.label} ${o.sub || ''}`.toLowerCase();
          return words.every(w => hay.includes(w));
        })
      : options;
    // "None" only with an empty query — offering it among search results reads
    // as a match. Clearing is the × on the trigger, or emptying the box.
    return needle ? matches : [{ value: '', label: noneLabel, none: true }, ...matches];
  }, [q, options, noneLabel]);

  React.useEffect(() => { setActive(0); }, [q, open]);
  React.useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  // Keep the arrow-key selection visible — the list scrolls past ~6 options.
  React.useEffect(() => {
    if (open) (listRef.current?.children?.[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  // Close on a click anywhere else. mousedown, not click, so it lands before a
  // re-render can move the option out from under the pointer.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) { setOpen(false); setQ(''); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (o: SearchOption) => { onChange(o.value); setOpen(false); setQ(''); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // The note editor closes on Escape via a window listener; stopping
    // propagation here means Esc dismisses only this dropdown.
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setOpen(false); setQ(''); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); }
  };

  return (
    <div className={`pc-ssel ${open ? 'open' : ''} ${float ? 'float' : ''}`} ref={boxRef}>
      <button type="button" className="pc-ssel-trigger" onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox" aria-expanded={open}>
        <span className={`pc-ssel-val ${selected ? '' : 'none'}`}>{selected ? selected.label : noneLabel}</span>
        {selected && (
          <span className="pc-ssel-clear" role="button" tabIndex={-1} title="Clear"
            onClick={e => { e.stopPropagation(); onChange(''); }}>
            <i className="bi bi-x" />
          </span>
        )}
        <i className="bi bi-chevron-down pc-ssel-caret" />
      </button>
      {/* ‼️ The panel expands INLINE by default rather than floating. The note
          editor's body is a scroll container and .pc-modal animates with a
          transform, so an absolutely-positioned panel is clipped there and a
          fixed one is mispositioned. Pushing the content below it is the price.
          `float` lifts it into an overlay for hosts with neither problem — see
          the prop. */}
      {open && (
        <div className="pc-ssel-panel">
          <input ref={inputRef} className="pc-ssel-search" placeholder={placeholder}
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown} />
          <div className="pc-ssel-list" role="listbox" ref={listRef}>
            {shown.length === 0
              ? <div className="pc-ssel-empty">No matches</div>
              : shown.map((o, i) => (
                <button type="button" key={o.value || '__none'} role="option" aria-selected={o.value === value}
                  className={`pc-ssel-opt ${i === active ? 'active' : ''} ${o.value === value ? 'on' : ''} ${o.none ? 'none' : ''}`}
                  /* onMouseMove, not onMouseEnter: scrolling the list under a
                     stationary pointer fires enter, which would fight the
                     arrow keys for the active row. */
                  onMouseMove={() => setActive(i)} onClick={() => pick(o)}>
                  <span className="pc-ssel-opt-l">{o.label}</span>
                  {o.sub && <span className="pc-ssel-sub">{o.sub}</span>}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
