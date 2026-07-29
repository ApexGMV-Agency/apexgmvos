import { Form, Button } from 'react-bootstrap';
import { CanvasBlock as Block, CanvasSchema, METRIC_CATALOG } from '../../lib/reportingCanvas';

interface Props {
  schema: CanvasSchema;
  selected: Block | null;
  onSchemaChange: (next: CanvasSchema) => void;
  onBlockChange: (b: Block) => void;
  onBlockDelete: (id: string) => void;
}

export default function PropertiesPanel({
  schema, selected, onSchemaChange, onBlockChange, onBlockDelete,
}: Props) {
  return (
    <div className="border-start bg-light" style={{ width: 300, overflowY: 'auto', flexShrink: 0 }}>
      {selected ? (
        <BlockProps block={selected} onChange={onBlockChange} onDelete={() => onBlockDelete(selected.id)} />
      ) : (
        <CanvasProps schema={schema} onChange={onSchemaChange} />
      )}
    </div>
  );
}

function CanvasProps({ schema, onChange }: { schema: CanvasSchema; onChange: (s: CanvasSchema) => void }) {
  const set = (k: keyof CanvasSchema['canvas'], v: any) =>
    onChange({ ...schema, canvas: { ...schema.canvas, [k]: v } });
  return (
    <>
      <SectionHeader icon="bi-sliders" title="Canvas" />
      <div className="p-3">
        <Form.Group className="mb-2">
          <Form.Label className="small fw-bold">Width (px)</Form.Label>
          <Form.Control type="number" min={600} max={2400}
            value={schema.canvas.width}
            onChange={(e) => set('width', Math.max(600, Math.min(2400, Number(e.target.value) || 1200)))} />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label className="small fw-bold">Padding (px)</Form.Label>
          <Form.Control type="number" min={0} max={96}
            value={schema.canvas.padding ?? 32}
            onChange={(e) => set('padding', Math.max(0, Math.min(96, Number(e.target.value) || 0)))} />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label className="small fw-bold">Background</Form.Label>
          <Form.Control type="color"
            value={schema.canvas.background ?? '#ffffff'}
            onChange={(e) => set('background', e.target.value)} />
        </Form.Group>
      </div>

      <SectionHeader icon="bi-info-circle" title="Tips" />
      <div className="p-3 small text-muted">
        <ul className="ps-3 mb-0">
          <li>Drag blocks from the left panel onto the canvas.</li>
          <li>Click a block to edit its properties.</li>
          <li>Drag the grip handle on a block to move it.</li>
          <li>Drag any corner / edge to resize.</li>
          <li>Click empty canvas to deselect and return here.</li>
        </ul>
      </div>
    </>
  );
}

function BlockProps({ block, onChange, onDelete }: { block: Block; onChange: (b: Block) => void; onDelete: () => void }) {
  const p = block.props as any;
  const setProp = (k: string, v: unknown) => onChange({ ...block, props: { ...block.props, [k]: v } });
  const setLayout = (k: 'x' | 'y' | 'w' | 'h', v: number) =>
    onChange({ ...block, layout: { ...block.layout, [k]: v } });

  return (
    <>
      <SectionHeader icon={iconForType(block.type)} title={titleForType(block.type)} />

      <div className="p-3">
        {/* Per-type props */}
        {block.type === 'heading' && (
          <>
            <Field label="Text">
              <Form.Control value={p.text ?? ''} onChange={(e) => setProp('text', e.target.value)} />
            </Field>
            <Field label="Level">
              <Form.Select value={p.level ?? 2} onChange={(e) => setProp('level', Number(e.target.value))}>
                <option value={1}>H1 — Large</option>
                <option value={2}>H2 — Section</option>
                <option value={3}>H3 — Subsection</option>
              </Form.Select>
            </Field>
            <AlignField value={p.align ?? 'left'} onChange={(v) => setProp('align', v)} />
            <ColorField label="Color" value={p.color ?? '#111827'} onChange={(v) => setProp('color', v)} />
          </>
        )}

        {block.type === 'text' && (
          <>
            <AlignField value={p.align ?? 'left'} onChange={(v) => setProp('align', v)} />
            <ColorField label="Color" value={p.color ?? '#374151'} onChange={(v) => setProp('color', v)} />
            <Field label="Font size (px)">
              <Form.Control type="number" min={10} max={32} value={p.fontSize ?? 14}
                onChange={(e) => setProp('fontSize', Number(e.target.value) || 14)} />
            </Field>
            <div className="small text-muted">Tip: click the text in the canvas to edit it inline.</div>
          </>
        )}

        {block.type === 'divider' && (
          <>
            <ColorField label="Color" value={p.color ?? '#e5e7eb'} onChange={(v) => setProp('color', v)} />
            <Field label="Thickness (px)">
              <Form.Control type="number" min={1} max={8} value={p.thickness ?? 1}
                onChange={(e) => setProp('thickness', Number(e.target.value) || 1)} />
            </Field>
          </>
        )}

        {block.type === 'image' && (
          <>
            <Field label="Image URL">
              <Form.Control value={p.src ?? ''} placeholder="https://…"
                onChange={(e) => setProp('src', e.target.value)} />
            </Field>
            <Field label="Alt text">
              <Form.Control value={p.alt ?? ''} onChange={(e) => setProp('alt', e.target.value)} />
            </Field>
            <Field label="Fit">
              <Form.Select value={p.fit ?? 'cover'} onChange={(e) => setProp('fit', e.target.value)}>
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
                <option value="fill">Fill</option>
              </Form.Select>
            </Field>
          </>
        )}

        {block.type === 'kpi' && (
          <>
            <Field label="Label">
              <Form.Control value={p.label ?? ''} onChange={(e) => setProp('label', e.target.value)} />
            </Field>
            <Field label="Value (static)">
              <Form.Control value={p.value ?? ''} onChange={(e) => setProp('value', e.target.value)}
                placeholder="e.g. $12,345 — or bind a metric below" />
            </Field>
            <Field label="Subtitle">
              <Form.Control value={p.sub ?? ''} onChange={(e) => setProp('sub', e.target.value)} />
            </Field>
            <MetricField value={p.metric_key ?? ''} onChange={(v) => setProp('metric_key', v)} />
            <ColorField label="Accent" value={p.color ?? '#e8862e'} onChange={(v) => setProp('color', v)} />
            <ColorField label="Background" value={(p.bg as string) ?? 'rgba(232,134,46,.08)'} onChange={(v) => setProp('bg', v)} />
          </>
        )}

        {block.type === 'metric' && (
          <>
            <MetricField value={p.metric_key ?? ''} onChange={(v) => setProp('metric_key', v)} />
            <Field label="Show label">
              <Form.Check type="switch" checked={p.showLabel !== false}
                onChange={(e) => setProp('showLabel', e.target.checked)} />
            </Field>
            <AlignField value={p.align ?? 'left'} onChange={(v) => setProp('align', v)} />
          </>
        )}

        {block.type === 'table' && (
          <TableProps p={p} setProp={setProp} />
        )}

        {block.type === 'chart' && (
          <>
            <Field label="Chart kind">
              <Form.Select value={p.kind ?? 'bar'} onChange={(e) => setProp('kind', e.target.value)}>
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
              </Form.Select>
            </Field>
            <MetricField value={p.metric_key ?? 'gmv'} onChange={(v) => setProp('metric_key', v)} />
            <Field label="Title">
              <Form.Control value={p.title ?? ''} onChange={(e) => setProp('title', e.target.value)} />
            </Field>
          </>
        )}

        <hr className="my-3" />
        <SectionHeader icon="bi-grid-3x3-gap" title="Layout" inline />
        <div className="row g-2 mt-1">
          <div className="col-6">
            <Field label="X (%)">
              <Form.Control type="number" min={0} max={100} value={Math.round(block.layout.x)}
                onChange={(e) => setLayout('x', Number(e.target.value))} />
            </Field>
          </div>
          <div className="col-6">
            <Field label="Y (px)">
              <Form.Control type="number" min={0} value={Math.round(block.layout.y)}
                onChange={(e) => setLayout('y', Number(e.target.value))} />
            </Field>
          </div>
          <div className="col-6">
            <Field label="Width (%)">
              <Form.Control type="number" min={5} max={100} value={Math.round(block.layout.w)}
                onChange={(e) => setLayout('w', Number(e.target.value))} />
            </Field>
          </div>
          <div className="col-6">
            <Field label="Height (px)">
              <Form.Control type="number" min={16} value={Math.round(block.layout.h)}
                onChange={(e) => setLayout('h', Number(e.target.value))} />
            </Field>
          </div>
        </div>

        <div className="d-grid mt-3">
          <Button variant="outline-danger" size="sm" onClick={onDelete}>
            <i className="bi bi-trash me-1" />Delete block
          </Button>
        </div>
      </div>
    </>
  );
}

function TableProps({ p, setProp }: { p: any; setProp: (k: string, v: unknown) => void }) {
  const cols: string[] = p.columns ?? [];
  const rows: string[][] = p.rows ?? [];
  const addColumn = () => {
    const nextCols = [...cols, `Column ${cols.length + 1}`];
    const nextRows = rows.map(r => [...r, '']);
    setProp('columns', nextCols);
    setProp('rows', nextRows);
  };
  const removeColumn = (i: number) => {
    if (cols.length <= 1) return;
    setProp('columns', cols.filter((_, idx) => idx !== i));
    setProp('rows', rows.map(r => r.filter((_, idx) => idx !== i)));
  };
  const renameColumn = (i: number, v: string) => {
    const next = [...cols]; next[i] = v;
    setProp('columns', next);
  };
  const addRow = () => setProp('rows', [...rows, cols.map(() => '')]);
  const removeRow = (i: number) => setProp('rows', rows.filter((_, idx) => idx !== i));
  const setCell = (r: number, c: number, v: string) => {
    const next = rows.map(row => [...row]); next[r][c] = v;
    setProp('rows', next);
  };
  return (
    <>
      <div className="small fw-bold mb-1">Columns</div>
      {cols.map((c, i) => (
        <div className="d-flex gap-1 mb-1" key={i}>
          <Form.Control size="sm" value={c} onChange={(e) => renameColumn(i, e.target.value)} />
          <Button size="sm" variant="outline-danger" onClick={() => removeColumn(i)} disabled={cols.length <= 1}>
            <i className="bi bi-x" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline-secondary" className="mb-2" onClick={addColumn}>
        <i className="bi bi-plus-lg me-1" />Add column
      </Button>

      <div className="small fw-bold mb-1 mt-2">Rows</div>
      {rows.map((row, ri) => (
        <div className="border rounded p-2 mb-1" key={ri}>
          <div className="d-flex justify-content-between align-items-center mb-1">
            <span className="small text-muted">Row {ri + 1}</span>
            <Button size="sm" variant="outline-danger" onClick={() => removeRow(ri)}>
              <i className="bi bi-x" />
            </Button>
          </div>
          {cols.map((_, ci) => (
            <Form.Control size="sm" className="mb-1" key={ci}
              placeholder={cols[ci]} value={row[ci] ?? ''}
              onChange={(e) => setCell(ri, ci, e.target.value)} />
          ))}
        </div>
      ))}
      <Button size="sm" variant="outline-secondary" onClick={addRow}>
        <i className="bi bi-plus-lg me-1" />Add row
      </Button>
    </>
  );
}

// ---- Tiny field helpers -----------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Form.Group className="mb-2">
      <Form.Label className="small fw-bold mb-1">{label}</Form.Label>
      {children}
    </Form.Group>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="d-flex gap-2">
        <Form.Control type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 50 }} />
        <Form.Control value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

function AlignField({ value, onChange }: { value: string; onChange: (v: 'left' | 'center' | 'right') => void }) {
  return (
    <Field label="Align">
      <div className="btn-group w-100" role="group">
        {(['left', 'center', 'right'] as const).map(k => (
          <button
            key={k}
            type="button"
            className={`btn btn-sm ${value === k ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => onChange(k)}
          >
            <i className={`bi bi-text-${k === 'left' ? 'left' : k === 'right' ? 'right' : 'center'}`} />
          </button>
        ))}
      </div>
    </Field>
  );
}

function MetricField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Bind to metric">
      <Form.Select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Static value —</option>
        {METRIC_CATALOG.map(m => (
          <option key={m.key} value={m.key}>{m.label} · {m.format}</option>
        ))}
      </Form.Select>
    </Field>
  );
}

function SectionHeader({ icon, title, inline }: { icon: string; title: string; inline?: boolean }) {
  return (
    <div className={`${inline ? 'mt-1' : ''} px-3 py-2 ${inline ? '' : 'border-bottom'} small fw-bold text-uppercase text-muted`}>
      <i className={`bi ${icon} me-1`} />{title}
    </div>
  );
}

function iconForType(t: Block['type']): string {
  switch (t) {
    case 'heading': return 'bi-type-h1';
    case 'text': return 'bi-text-paragraph';
    case 'divider': return 'bi-hr';
    case 'image': return 'bi-image';
    case 'spacer': return 'bi-arrows-vertical';
    case 'kpi': return 'bi-bar-chart-line';
    case 'metric': return 'bi-calculator';
    case 'table': return 'bi-table';
    case 'chart': return 'bi-graph-up-arrow';
    default: return 'bi-square';
  }
}
function titleForType(t: Block['type']): string {
  return t.charAt(0).toUpperCase() + t.slice(1) + ' block';
}
