import { useMemo, useRef, useState } from 'react';
import ReactQuill, { Quill } from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { OverlayTrigger, Popover, Button, Form } from 'react-bootstrap';

// ---------------------------------------------------------------------------
//  Divider blots
//  • 'divider'  — legacy plain <hr> (kept so old reports still parse).
//  • 'adivider' — advanced divider carrying style / thickness / colour / width.
// ---------------------------------------------------------------------------
const BlockEmbed = Quill.import('blots/block/embed') as any;

class DividerBlot extends BlockEmbed {
  static blotName = 'divider';
  static tagName = 'hr';
}

export interface DividerOpts {
  style: 'solid' | 'dashed' | 'dotted' | 'double' | 'wavy' | 'ornament';
  thickness: number;   // px
  color: string;       // hex
  width: number;       // % of container
}
const DEFAULT_DIV: DividerOpts = { style: 'solid', thickness: 2, color: '#e8862e', width: 100 };

/** Apply the chosen divider options as inline style + class onto an <hr> node. */
export function styleDividerNode(node: HTMLElement, o: DividerOpts) {
  const { style, thickness, color, width } = o;
  node.setAttribute('data-style', style);
  node.setAttribute('data-thickness', String(thickness));
  node.setAttribute('data-color', color);
  node.setAttribute('data-width', String(width));
  node.className = `ac-divider ac-divider-${style}`;
  node.style.width = `${width}%`;
  node.style.margin = '1.15rem auto';
  node.style.borderRadius = '2px';
  if (style === 'wavy' || style === 'ornament') {
    // colour driven via currentColor; the geometry lives in styles.css
    node.style.border = '0';
    node.style.color = color;
    node.style.height = `${Math.max(6, thickness * 3)}px`;
    node.style.background = '';
  } else {
    node.style.border = '0';
    node.style.borderTop = `${thickness}px ${style} ${color}`;
    node.style.height = '0';
    node.style.color = '';
  }
}

class AdvancedDividerBlot extends BlockEmbed {
  static blotName = 'adivider';
  static tagName = 'hr';
  static className = 'ac-divider';
  static create(value: DividerOpts) {
    const node = super.create() as HTMLElement;
    styleDividerNode(node, { ...DEFAULT_DIV, ...(value || {}) });
    return node;
  }
  static value(node: HTMLElement): DividerOpts {
    return {
      style: (node.getAttribute('data-style') as DividerOpts['style']) || 'solid',
      thickness: Number(node.getAttribute('data-thickness')) || 2,
      color: node.getAttribute('data-color') || '#e8862e',
      width: Number(node.getAttribute('data-width')) || 100,
    };
  }
  static formats(node: HTMLElement) { return AdvancedDividerBlot.value(node); }
}

if (!(Quill as any).__divider_registered__) {
  Quill.register('formats/divider', DividerBlot, true);
  Quill.register('formats/adivider', AdvancedDividerBlot, true);
  (Quill as any).__divider_registered__ = true;
}

const FORMATS = [
  'header', 'font', 'size',
  'bold', 'italic', 'underline', 'strike',
  'color', 'background',
  'list', 'indent',
  'align',
  'blockquote', 'code-block',
  'link',
  'divider', 'adivider',
];

const STYLE_OPTIONS: { key: DividerOpts['style']; label: string }[] = [
  { key: 'solid', label: 'Straight' },
  { key: 'dashed', label: 'Dashed' },
  { key: 'dotted', label: 'Dotted' },
  { key: 'double', label: 'Double' },
  { key: 'wavy', label: 'Wavy' },
  { key: 'ornament', label: 'Ornamental' },
];
const SWATCHES = ['#e8862e', '#141620', '#0d6efd', '#198754', '#dc3545', '#6f42c1', '#94a3b8'];

// Ready-to-insert defaults so users don't rebuild a divider every time.
type DividerPreset = { name: string; opts: DividerOpts };
const BUILTIN_DIVIDERS: DividerPreset[] = [
  { name: 'Brand rule', opts: { style: 'solid', thickness: 2, color: '#e8862e', width: 100 } },
  { name: 'Subtle dotted', opts: { style: 'dotted', thickness: 2, color: '#94a3b8', width: 60 } },
  { name: 'Ornamental', opts: { style: 'ornament', thickness: 3, color: '#e8862e', width: 40 } },
];
// User-saved presets live per-browser (no DB needed for a personal shortcut list).
const DIVIDER_LS_KEY = 'ac_divider_presets';
function loadSavedDividers(): DividerPreset[] {
  try { const j = localStorage.getItem(DIVIDER_LS_KEY); const a = j ? JSON.parse(j) : []; return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function persistSavedDividers(list: DividerPreset[]) {
  try { localStorage.setItem(DIVIDER_LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
const WAVE_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='12' viewBox='0 0 24 12'%3E%3Cpath d='M0 6 Q 6 0 12 6 T 24 6' fill='none' stroke='black' stroke-width='2.4'/%3E%3C/svg%3E\") repeat-x center / 24px 100%";
// Self-contained inline preview for any divider (the popover portals to <body>,
// outside the scoped .ql-editor / .ac-rte-view selectors, so wavy/ornament
// geometry must be inline or the preview box renders blank).
function previewStyleFor(o: DividerOpts): React.CSSProperties {
  const base: React.CSSProperties = { display: 'block', width: '100%', margin: 0, borderRadius: 2, border: 0 };
  const h = Math.max(6, o.thickness * 3);
  if (o.style === 'wavy') return { ...base, height: h, backgroundColor: o.color, WebkitMask: WAVE_MASK, mask: WAVE_MASK };
  if (o.style === 'ornament') return {
    ...base, height: h,
    backgroundImage: `radial-gradient(${o.color} 38%, transparent 42%)`,
    backgroundSize: '14px 100%', backgroundRepeat: 'repeat-x', backgroundPosition: 'center',
  };
  return { ...base, height: 0, borderTop: `${o.thickness}px ${o.style} ${o.color}` };
}

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 180 }: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const quillRef = useRef<ReactQuill | null>(null);
  const [div, setDiv] = useState<DividerOpts>(DEFAULT_DIV);
  const [open, setOpen] = useState(false);
  const [savedDividers, setSavedDividers] = useState<DividerPreset[]>(loadSavedDividers);

  const saveCurrentDivider = () => {
    const name = window.prompt('Name this divider preset:')?.trim();
    if (!name) return;
    const next = [...savedDividers.filter(s => s.name !== name), { name, opts: div }];
    setSavedDividers(next);
    persistSavedDividers(next);
  };
  const removeSavedDivider = (name: string) => {
    const next = savedDividers.filter(s => s.name !== name);
    setSavedDividers(next);
    persistSavedDividers(next);
  };

  const modules = useMemo(() => ({
    toolbar: {
      container: [
        [{ header: [1, 2, 3, false] }, { font: [] }],
        [{ size: ['small', false, 'large', 'huge'] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ color: [] }, { background: [] }],
        [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
        [{ indent: '-1' }, { indent: '+1' }],
        [{ align: [] }],
        ['blockquote', 'code-block'],
        ['link'],
        ['clean'],
      ],
    },
  }), []);

  const insertDivider = (o: DividerOpts) => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;
    const range = editor.getSelection(true) ?? { index: editor.getLength(), length: 0 };
    editor.insertText(range.index, '\n', 'user');
    editor.insertEmbed(range.index + 1, 'adivider', o, 'user');
    editor.setSelection(range.index + 2, 0, 'silent');
    setOpen(false);
  };

  const allPresets: (DividerPreset & { builtin: boolean })[] = [
    ...BUILTIN_DIVIDERS.map(p => ({ ...p, builtin: true })),
    ...savedDividers.map(p => ({ ...p, builtin: false })),
  ];

  const popover = (
    <Popover style={{ maxWidth: 340 }}>
      <Popover.Header as="div" className="fw-semibold small">Insert divider</Popover.Header>
      <Popover.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        <div className="mb-3">
          <div className="text-muted small mb-1">Presets <span className="text-muted">— click to insert</span></div>
          <div className="d-flex flex-column gap-1">
            {allPresets.map((pr, idx) => (
              <div className="d-flex align-items-center gap-1" key={pr.name + idx}>
                <button type="button" className="ac-div-preset flex-grow-1" title={`Insert "${pr.name}"`}
                  onClick={() => insertDivider(pr.opts)}>
                  <span className="ac-div-preset-name">{pr.name}</span>
                  <hr className={`ac-divider ac-divider-${pr.opts.style}`} style={{ ...previewStyleFor(pr.opts), marginTop: 4 }} />
                </button>
                {!pr.builtin && (
                  <button type="button" className="btn btn-sm btn-link text-muted p-0 px-1" title="Remove preset"
                    onClick={() => removeSavedDivider(pr.name)}><i className="bi bi-x-lg" /></button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="text-muted small mb-2 fw-semibold">Or build your own</div>
        <div className="mb-2">
          <div className="text-muted small mb-1">Style</div>
          <div className="d-flex flex-wrap gap-1">
            {STYLE_OPTIONS.map(s => (
              <Button key={s.key} size="sm" variant={div.style === s.key ? 'primary' : 'outline-secondary'}
                onClick={() => setDiv(p => ({ ...p, style: s.key }))}>{s.label}</Button>
            ))}
          </div>
        </div>
        <div className="mb-2">
          <div className="text-muted small mb-1">Colour</div>
          <div className="d-flex align-items-center gap-1 flex-wrap">
            {SWATCHES.map(c => (
              <button key={c} type="button" title={c}
                onClick={() => setDiv(p => ({ ...p, color: c }))}
                style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                  border: div.color.toLowerCase() === c.toLowerCase() ? '2px solid #111' : '1px solid #ccc' }} />
            ))}
            <Form.Control type="color" value={div.color} onChange={e => setDiv(p => ({ ...p, color: e.target.value }))}
              style={{ width: 34, height: 26, padding: 2 }} title="Custom colour" />
          </div>
        </div>
        <div className="row g-2 mb-2">
          <div className="col-6">
            <div className="text-muted small mb-1">Thickness: {div.thickness}px</div>
            <Form.Range min={1} max={10} value={div.thickness}
              onChange={e => setDiv(p => ({ ...p, thickness: Number(e.target.value) }))} />
          </div>
          <div className="col-6">
            <div className="text-muted small mb-1">Width: {div.width}%</div>
            <Form.Range min={20} max={100} step={5} value={div.width}
              onChange={e => setDiv(p => ({ ...p, width: Number(e.target.value) }))} />
          </div>
        </div>
        <div className="px-2 py-2 mb-2 rounded" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
          <hr className={`ac-divider ac-divider-${div.style}`} style={{ ...previewStyleFor(div), margin: '4px 0' }} />
        </div>
        <div className="d-flex justify-content-between align-items-center">
          <Button size="sm" variant="outline-secondary" onClick={saveCurrentDivider} title="Save this divider as a reusable preset">
            <i className="bi bi-bookmark-plus me-1" />Save preset
          </Button>
          <Button size="sm" onClick={() => insertDivider(div)}>
            <i className="bi bi-plus-lg me-1" />Insert
          </Button>
        </div>
      </Popover.Body>
    </Popover>
  );

  return (
    <div className="ac-rte" style={{ minHeight }}>
      <div className="d-flex justify-content-end mb-1">
        <OverlayTrigger trigger="click" placement="bottom-end" rootClose show={open} onToggle={setOpen} overlay={popover}>
          <Button size="sm" variant="outline-secondary" title="Insert a styled divider">
            <i className="bi bi-dash-lg" /> <span className="ms-1">Divider</span>
          </Button>
        </OverlayTrigger>
      </div>
      <ReactQuill
        ref={quillRef}
        theme="snow"
        modules={modules}
        formats={FORMATS}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}
