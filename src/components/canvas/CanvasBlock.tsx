import { useRef, useState, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  CanvasBlock as Block, METRIC_BY_KEY, MetricBag, formatMetric, metricDelta,
} from '../../lib/reportingCanvas';

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface Props {
  block: Block;
  canvasWidth: number;
  selected: boolean;
  /** Read-only mode (renderer mode) — disables drag, resize, inline edit. */
  readOnly?: boolean;
  /** Optional metric bag — when present, KPI/Metric/Chart blocks resolve real
   *  values + prior-period deltas instead of placeholders. */
  metricBag?: MetricBag;
  /** Currency for currency-formatted metrics (defaults to USD). */
  currency?: string;
  onSelect: () => void;
  onChange: (next: Block) => void;
  onDelete: () => void;
}

export default function CanvasBlockView({
  block, canvasWidth, selected, readOnly, metricBag, currency, onSelect, onChange, onDelete,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `block:${block.id}`,
    data: { kind: 'block', blockId: block.id },
    disabled: readOnly,
  });

  // Live resize uses a separate state so we don't churn the parent during
  // pointer-move; we commit to onChange on pointer-up.
  const [resizing, setResizing] = useState<{ dir: ResizeDir; startX: number; startY: number; orig: Block['layout'] } | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  // Keep a local copy of the layout so we can show smooth resize feedback
  // without writing every pixel to the parent.
  const [liveLayout, setLiveLayout] = useState(block.layout);
  useEffect(() => { setLiveLayout(block.layout); }, [block.layout.x, block.layout.y, block.layout.w, block.layout.h]);

  // Pointer-move during resize
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const dxPx = e.clientX - resizing.startX;
      const dyPx = e.clientY - resizing.startY;
      const dxPct = (dxPx / canvasWidth) * 100;
      let { x, y, w, h } = resizing.orig;
      if (resizing.dir.includes('e')) w = Math.max(5, Math.min(100 - x, w + dxPct));
      if (resizing.dir.includes('w')) {
        const nx = Math.max(0, x + dxPct);
        const dw = nx - x; // negative when growing left
        w = Math.max(5, w - dw);
        x = nx;
      }
      if (resizing.dir.includes('s')) h = Math.max(20, h + dyPx);
      if (resizing.dir.includes('n')) {
        const ny = Math.max(0, y + dyPx);
        const dh = ny - y;
        h = Math.max(20, h - dh);
        y = ny;
      }
      setLiveLayout({ x, y, w, h });
    };
    const onUp = () => {
      onChange({ ...block, layout: liveLayout });
      setResizing(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [resizing, canvasWidth, block, liveLayout, onChange]);

  const startResize = (dir: ResizeDir) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing({ dir, startX: e.clientX, startY: e.clientY, orig: { ...block.layout } });
  };

  const showLayout = resizing ? liveLayout : block.layout;
  const dragStyle = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div
      ref={(n) => { setNodeRef(n); elRef.current = n; }}
      onPointerDown={(e) => {
        // Don't steal selection clicks from inline editors.
        if ((e.target as HTMLElement).isContentEditable) return;
        if (readOnly) return;
        onSelect();
      }}
      className={`ac-canvas-block ${selected ? 'is-selected' : ''}`}
      style={{
        position: 'absolute',
        left: `${showLayout.x}%`,
        top: showLayout.y,
        width: `${showLayout.w}%`,
        height: showLayout.h,
        ...dragStyle,
        cursor: readOnly ? 'default' : (resizing ? 'grabbing' : 'grab'),
      }}
    >
      {/* Drag handle covers the whole block content but the handle area is
          the small bar at the top — the content itself can have its own
          interactive elements (contentEditable, inputs). */}
      {!readOnly && (
        <div
          {...listeners}
          {...attributes}
          className="ac-canvas-block-handle"
          style={{ touchAction: 'none' }}
        >
          <i className="bi bi-arrows-move" />
        </div>
      )}

      <div className="ac-canvas-block-body">
        <BlockRenderer
          block={block} readOnly={readOnly} onChange={onChange}
          metricBag={metricBag} currency={currency ?? 'USD'}
        />
      </div>

      {/* Action bar (selected + edit mode) */}
      {selected && !readOnly && (
        <div className="ac-canvas-block-actions">
          <button type="button" className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">
            <i className="bi bi-trash" />
          </button>
        </div>
      )}

      {/* Resize handles — 8 standard handles */}
      {selected && !readOnly && (
        <>
          {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDir[]).map(dir => (
            <div
              key={dir}
              className={`ac-canvas-resize ac-canvas-resize-${dir}`}
              onPointerDown={startResize(dir)}
            />
          ))}
        </>
      )}
    </div>
  );
}

// =============================================================================
// Per-type block content
// =============================================================================

function BlockRenderer({ block, readOnly, onChange, metricBag, currency }: {
  block: Block; readOnly?: boolean; onChange: (b: Block) => void;
  metricBag?: MetricBag; currency: string;
}) {
  const updateProp = (k: string, v: unknown) => onChange({ ...block, props: { ...block.props, [k]: v } });
  const p = block.props as any;

  switch (block.type) {
    case 'heading': {
      const level: 1 | 2 | 3 = (p.level as any) ?? 2;
      const sizes = { 1: '1.75rem', 2: '1.35rem', 3: '1.1rem' };
      return (
        <div
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onBlur={(e) => updateProp('text', e.currentTarget.innerText)}
          className="w-100 h-100 d-flex align-items-center"
          style={{
            fontFamily: 'Sora, sans-serif',
            fontWeight: 700,
            fontSize: sizes[level],
            color: p.color ?? '#111827',
            textAlign: p.align ?? 'left',
            justifyContent: p.align === 'center' ? 'center' : p.align === 'right' ? 'flex-end' : 'flex-start',
            outline: 'none',
            padding: '0 4px',
            cursor: readOnly ? 'default' : 'text',
          }}
        >
          {p.text ?? 'New heading'}
        </div>
      );
    }
    case 'text': {
      return (
        <TextBlockEditor
          html={p.html ?? '<p>New text block.</p>'}
          fontSize={p.fontSize ?? 14}
          color={p.color ?? '#374151'}
          align={p.align ?? 'left'}
          readOnly={!!readOnly}
          onChange={(html) => updateProp('html', html)}
        />
      );
    }
    case 'divider': {
      return (
        <div className="w-100 h-100 d-flex align-items-center" style={{ padding: '0 4px' }}>
          <div style={{ height: (p.thickness ?? 1) + 'px', background: p.color ?? '#e5e7eb', width: '100%' }} />
        </div>
      );
    }
    case 'spacer': {
      return (
        <div className="w-100 h-100 d-flex align-items-center justify-content-center text-muted" style={{ fontSize: '.75rem', opacity: readOnly ? 0 : .35 }}>
          {readOnly ? '' : '— spacer —'}
        </div>
      );
    }
    case 'image': {
      const src = p.src as string | undefined;
      if (!src) {
        return (
          <div className="w-100 h-100 d-flex align-items-center justify-content-center text-muted bg-light rounded border border-dashed" style={{ fontSize: '.85rem' }}>
            <div className="text-center">
              <i className="bi bi-image fs-3 d-block mb-1 opacity-50" />
              {readOnly ? 'No image' : 'Add an image URL on the right'}
            </div>
          </div>
        );
      }
      return (
        <img src={src} alt={p.alt ?? ''} className="w-100 h-100 rounded"
          style={{ objectFit: (p.fit ?? 'cover') as any }} />
      );
    }
    case 'kpi': {
      const metric = p.metric_key ? METRIC_BY_KEY.get(p.metric_key) : undefined;
      const bound = metric && metricBag ? metricBag.current[metric.key] : undefined;
      const prev  = metric && metricBag?.previous ? metricBag.previous[metric.key] : undefined;
      const value = bound !== undefined
        ? formatMetric(bound, metric, currency)
        : (p.value ?? (metric ? '—' : '—'));
      const delta = metric?.comparable ? metricDelta(bound ?? null, prev ?? null) : null;
      return (
        <div
          className="w-100 h-100 rounded p-3 d-flex flex-column justify-content-center"
          style={{
            background: p.bg ?? 'rgba(232,134,46,.08)',
            borderLeft: `4px solid ${p.color ?? '#e8862e'}`,
          }}
        >
          <div className="text-muted text-uppercase fw-bold" style={{ fontSize: '.7rem', letterSpacing: '.5px' }}>
            {p.label ?? metric?.label ?? 'KPI'}
          </div>
          <div className="fw-bold mt-1" style={{ fontSize: '1.75rem', color: p.color ?? '#e8862e', fontFamily: 'Sora, sans-serif' }}>
            {value}
          </div>
          {delta ? (
            <div className={`small mt-1 fw-semibold ${delta.isPositive ? 'text-success' : 'text-danger'}`}>
              <i className={`bi ${delta.isPositive ? 'bi-arrow-up-short' : 'bi-arrow-down-short'}`} />
              {formatMetric(Math.abs(delta.diff), metric, currency)}
              {delta.pct !== null && (
                <span className="text-muted ms-1">({delta.pct.toFixed(1)}%)</span>
              )}
              <span className="text-muted ms-1">vs prev</span>
            </div>
          ) : p.sub ? (
            <div className="text-muted small mt-1">{p.sub}</div>
          ) : null}
        </div>
      );
    }
    case 'metric': {
      const metric = METRIC_BY_KEY.get(p.metric_key as string);
      const bound = metric && metricBag ? metricBag.current[metric.key] : undefined;
      const prev  = metric && metricBag?.previous ? metricBag.previous[metric.key] : undefined;
      const delta = metric?.comparable ? metricDelta(bound ?? null, prev ?? null) : null;
      return (
        <div className="w-100 h-100 d-flex flex-column justify-content-center px-2"
          style={{ textAlign: (p.align ?? 'left') as any }}>
          {p.showLabel !== false && (
            <div className="text-muted small" style={{ fontSize: '.75rem' }}>
              {metric?.label ?? p.metric_key ?? 'Metric'}
            </div>
          )}
          <div className="fw-bold" style={{ fontSize: '1.4rem', fontFamily: 'Sora, sans-serif' }}>
            {bound !== undefined ? formatMetric(bound, metric, currency) : <span className="text-muted">—</span>}
            {metric && bound === undefined && (
              <span className="text-muted small ms-2" style={{ fontSize: '.7rem' }}>
                ({metric.format})
              </span>
            )}
          </div>
          {delta && (
            <div className={`small mt-1 fw-semibold ${delta.isPositive ? 'text-success' : 'text-danger'}`}>
              <i className={`bi ${delta.isPositive ? 'bi-arrow-up-short' : 'bi-arrow-down-short'}`} />
              {formatMetric(Math.abs(delta.diff), metric, currency)}
              {delta.pct !== null && <span className="text-muted ms-1">({delta.pct.toFixed(1)}%)</span>}
            </div>
          )}
        </div>
      );
    }
    case 'table': {
      const cols = (p.columns ?? []) as string[];
      const rows = (p.rows ?? []) as string[][];
      return (
        <div className="w-100 h-100 overflow-auto">
          <table className="table table-sm align-middle mb-0">
            <thead>
              <tr>
                {cols.map((c, i) => (
                  <th key={i} style={{ background: p.headerBg ?? '#f3f4f6' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {cols.map((_, ci) => (
                    <td key={ci}>{row[ci] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'chart': {
      return (
        <div className="w-100 h-100 d-flex align-items-center justify-content-center text-muted bg-light rounded border border-dashed">
          <div className="text-center small">
            <i className="bi bi-graph-up-arrow fs-3 d-block mb-1 opacity-50" />
            Chart preview comes online when bound to a metric.
          </div>
        </div>
      );
    }
    default:
      return (
        <div className="w-100 h-100 d-flex align-items-center justify-content-center text-muted">
          {block.type}
        </div>
      );
  }
}

// =============================================================================
// Inline rich-text editor for the Text block.
//
// Uses contentEditable + document.execCommand for a dependency-free editor.
// A floating toolbar appears above the block when the editor has focus so
// users can apply bold / italic / underline / list / link / clear without
// leaving the canvas.
// =============================================================================

function TextBlockEditor({
  html, fontSize, color, align, readOnly, onChange,
}: {
  html: string;
  fontSize: number;
  color: string;
  align: string;
  readOnly: boolean;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const addLink = () => {
    const url = window.prompt('Link URL');
    if (!url) return;
    exec('createLink', url);
  };

  return (
    <div className="w-100 h-100 position-relative">
      {focused && !readOnly && (
        <div className="ac-canvas-rt-toolbar shadow-sm border rounded bg-white d-flex align-items-center gap-1 px-1 py-1"
          // Mousedown shouldn't blur the editor.
          onMouseDown={(e) => e.preventDefault()}
        >
          <ToolbarBtn icon="bi-type-bold"      onClick={() => exec('bold')}      title="Bold (Ctrl+B)" />
          <ToolbarBtn icon="bi-type-italic"    onClick={() => exec('italic')}    title="Italic (Ctrl+I)" />
          <ToolbarBtn icon="bi-type-underline" onClick={() => exec('underline')} title="Underline (Ctrl+U)" />
          <div className="vr mx-1" />
          <ToolbarBtn icon="bi-list-ul"      onClick={() => exec('insertUnorderedList')} title="Bulleted list" />
          <ToolbarBtn icon="bi-list-ol"      onClick={() => exec('insertOrderedList')}   title="Numbered list" />
          <ToolbarBtn icon="bi-link-45deg"   onClick={addLink}                            title="Link" />
          <ToolbarBtn icon="bi-eraser"       onClick={() => exec('removeFormat')}         title="Clear formatting" />
        </div>
      )}
      <div
        ref={ref}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onFocus={() => setFocused(true)}
        onBlur={(e) => { setFocused(false); onChange(e.currentTarget.innerHTML); }}
        className="w-100 h-100"
        style={{
          fontSize: fontSize + 'px',
          color,
          textAlign: align as any,
          outline: 'none',
          padding: '4px 6px',
          overflow: 'auto',
          cursor: readOnly ? 'default' : 'text',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function ToolbarBtn({ icon, onClick, title }: { icon: string; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      className="btn btn-sm btn-light px-2 py-1"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      style={{ lineHeight: 1 }}
    >
      <i className={`bi ${icon}`} style={{ fontSize: '.85rem' }} />
    </button>
  );
}
