import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Spinner, Alert, Button, Badge, Form } from 'react-bootstrap';
import {
  DndContext, PointerSensor, useSensor, useSensors, DragEndEvent, DragOverlay, DragStartEvent,
} from '@dnd-kit/core';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import {
  ReportTemplate, CanvasSchema, CanvasBlock as Block, BlockType,
  parseTemplateRow, newBlockId, defaultBlock, clampLayout,
  SECTION_PRESETS, MetricBag,
} from '../../lib/reportingCanvas';
import Toolbox from '../../components/canvas/Toolbox';
import CanvasArea from '../../components/canvas/CanvasArea';
import CanvasRenderer from '../../components/canvas/CanvasRenderer';
import PropertiesPanel from '../../components/canvas/PropertiesPanel';

// Sample metric values used in preview mode so blocks display realistic data
// without needing a live brand context.
const SAMPLE_METRIC_BAG: MetricBag = {
  current: {
    gmv: 12450, affiliate_gmv: 8120, paid_gmv: 4330,
    revenue: 4980, commission: 1245,
    orders: 312, units_sold: 528, affiliate_units: 184,
    videos_live: 21, videos_pipeline: 6, creators_active: 5,
    views: 184320, likes: 6420, comments: 412, engagement_rate: 0.054,
  },
  previous: {
    gmv: 10870, affiliate_gmv: 7340, paid_gmv: 3530,
    revenue: 4220, commission: 1080,
    orders: 287, units_sold: 491, affiliate_units: 165,
    videos_live: 18, videos_pipeline: 9, creators_active: 5,
    views: 162110, likes: 5980, comments: 388, engagement_rate: 0.049,
  },
};

export default function ReportingCanvasEditor() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile } = useAuth();
  const isBob = profile?.role === 'bob';
  const canEdit = isBob;

  const [tpl, setTpl] = useState<ReportTemplate | null>(null);
  const [schema, setSchema] = useState<CanvasSchema | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  // Autosave toggle (Phase 5) — debounced by ~1.2s after the last change.
  const [autosave, setAutosave] = useState(true);

  const [activeDrag, setActiveDrag] = useState<{ kind: 'toolbox' | 'block'; type?: BlockType; blockId?: string } | null>(null);

  const canvasElRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      const { data, error } = await supabase
        .from('report_templates').select('*').eq('id', id).maybeSingle();
      if (error) { setErr(error.message); setLoading(false); return; }
      if (!data)  { setErr('Template not found.'); setLoading(false); return; }
      const parsed = parseTemplateRow(data);
      setTpl(parsed);
      setSchema(parsed.schema_json);
      setLoading(false);
    })();
  }, [id]);

  const selected = useMemo(
    () => schema?.blocks.find(b => b.id === selectedId) ?? null,
    [schema, selectedId],
  );

  // ---- Mutations -----------------------------------------------------------

  const updateSchema = (next: CanvasSchema) => {
    setSchema(next);
    setDirty(true);
  };

  const updateBlock = (b: Block) => {
    if (!schema) return;
    updateSchema({
      ...schema,
      blocks: schema.blocks.map(x => x.id === b.id ? { ...b, layout: clampLayout(b.layout) } : x),
    });
  };

  const deleteBlock = (blockId: string) => {
    if (!schema) return;
    updateSchema({ ...schema, blocks: schema.blocks.filter(b => b.id !== blockId) });
    if (selectedId === blockId) setSelectedId(null);
  };

  const addBlockAt = (type: BlockType, xPx: number, yPx: number) => {
    if (!schema) return;
    const tplBlock = defaultBlock(type);
    const xPct = Math.max(0, Math.min(100 - tplBlock.defaultSize.w, (xPx / schema.canvas.width) * 100));
    const y = Math.max(0, yPx);
    const newBlock: Block = {
      id: newBlockId(),
      type: tplBlock.type,
      props: tplBlock.props,
      children: (tplBlock as any).children,
      layout: { x: xPct, y, w: tplBlock.defaultSize.w, h: tplBlock.defaultSize.h },
    };
    updateSchema({ ...schema, blocks: [...schema.blocks, newBlock] });
    setSelectedId(newBlock.id);
  };

  // Drop in a section preset stack right after the existing content.
  const insertSection = (presetKey: string) => {
    if (!schema) return;
    const preset = SECTION_PRESETS.find(p => p.key === presetKey);
    if (!preset) return;
    const maxY = schema.blocks.reduce((m, b) => Math.max(m, b.layout.y + b.layout.h), 0);
    const padding = schema.canvas.padding ?? 32;
    const anchorY = schema.blocks.length === 0 ? 0 : maxY + 24;
    const built = preset.build(0, anchorY).map(b => ({
      ...b,
      id: newBlockId(),
      layout: clampLayout(b.layout),
    }));
    updateSchema({ ...schema, blocks: [...schema.blocks, ...built] });
    setSelectedId(built[0]?.id ?? null);
    // Scroll to the new content
    setTimeout(() => {
      const surface = canvasElRef.current;
      surface?.scrollTo?.({ top: anchorY + padding, behavior: 'smooth' });
    }, 50);
  };

  // ---- DnD handlers --------------------------------------------------------

  const onDragStart = (event: DragStartEvent) => {
    const idStr = String(event.active.id);
    if (idStr.startsWith('toolbox:')) {
      setActiveDrag({ kind: 'toolbox', type: idStr.split(':')[1] as BlockType });
    } else if (idStr.startsWith('block:')) {
      setActiveDrag({ kind: 'block', blockId: idStr.split(':')[1] });
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    if (!schema) return;
    const { active, delta, over } = event;
    const activeId = String(active.id);

    if (activeId.startsWith('toolbox:')) {
      if (!over || over.id !== 'canvas-surface') return;
      const type = activeId.split(':')[1] as BlockType;
      const start = event.activatorEvent as PointerEvent;
      const canvasEl = canvasElRef.current;
      if (!canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();
      const xPx = (start.clientX + delta.x) - rect.left;
      const yPx = (start.clientY + delta.y) - rect.top;
      addBlockAt(type, xPx, yPx);
      return;
    }

    if (activeId.startsWith('block:')) {
      const blockId = activeId.split(':')[1];
      const block = schema.blocks.find(b => b.id === blockId);
      if (!block) return;
      const dxPct = (delta.x / schema.canvas.width) * 100;
      const dy = delta.y;
      const next: Block = {
        ...block,
        layout: clampLayout({
          x: block.layout.x + dxPct,
          y: block.layout.y + dy,
          w: block.layout.w,
          h: block.layout.h,
        }),
      };
      updateBlock(next);
    }
  };

  // ---- Persistence ---------------------------------------------------------

  const save = async () => {
    if (!tpl || !schema) return;
    setSaving(true); setErr(null);
    const { data, error } = await supabase.from('report_templates')
      .update({ schema_json: schema })
      .eq('id', tpl.id)
      .select('*').single();
    setSaving(false);
    if (error) { setErr(error.message); return; }
    const updated = parseTemplateRow(data);
    setTpl(updated);
    setDirty(false);
    setSavedAt(updated.updated_at);
  };

  // Debounced autosave — schedules a save 1.2s after the last change.
  useEffect(() => {
    if (!autosave || !dirty || !canEdit) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { save(); }, 1200);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, autosave, dirty]);

  const renameTemplate = async (next: string) => {
    if (!tpl || !next.trim() || next === tpl.name) return;
    const prev = tpl;
    setTpl({ ...tpl, name: next });
    const { error } = await supabase.from('report_templates')
      .update({ name: next }).eq('id', tpl.id);
    if (error) { alert(error.message); setTpl(prev); }
  };

  const printPreview = () => {
    setPreview(true);
    setTimeout(() => window.print(), 200);
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err)     return <Alert variant="danger">{err}</Alert>;
  if (!tpl || !schema) return null;

  return (
    <div className="ac-themed d-flex flex-column" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Top bar */}
      <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-white" style={{ flexShrink: 0 }}>
        <Button size="sm" variant="outline-secondary" onClick={() => nav('/templates')} title="Back">
          <i className="bi bi-arrow-left" />
        </Button>
        <i className="bi bi-easel2 text-warning" />
        <Form.Control
          plaintext={!canEdit}
          readOnly={!canEdit}
          defaultValue={tpl.name}
          onBlur={(e) => renameTemplate(e.target.value)}
          className="fw-bold border-0 shadow-none"
          style={{ maxWidth: 320, fontSize: '1.05rem' }}
        />
        <Badge bg="light" text="dark" className="border">
          <i className="bi bi-calendar me-1" />
          {tpl.report_kind.charAt(0).toUpperCase() + tpl.report_kind.slice(1)}
        </Badge>
        {tpl.is_global && (
          <Badge bg="warning" text="dark">
            <i className="bi bi-globe me-1" />Global
          </Badge>
        )}
        <Badge bg="secondary">
          <i className="bi bi-stack me-1" />{schema.blocks.length} blocks
        </Badge>

        <div className="ms-auto d-flex align-items-center gap-2">
          {savedAt && !dirty && !saving && (
            <small className="text-muted">Saved {new Date(savedAt).toLocaleTimeString()}</small>
          )}
          {saving && (
            <small className="text-muted"><Spinner size="sm" animation="border" className="me-1" />Saving…</small>
          )}
          {dirty && !saving && (
            <small className="text-warning fw-semibold"><i className="bi bi-dot" />Unsaved</small>
          )}
          {canEdit && (
            <Form.Check
              type="switch"
              id="autosave-toggle"
              checked={autosave}
              onChange={(e) => setAutosave(e.target.checked)}
              label={<small className="text-muted">Autosave</small>}
            />
          )}
          <Button size="sm" variant={preview ? 'primary' : 'outline-primary'} onClick={() => setPreview(p => !p)}>
            <i className={`bi ${preview ? 'bi-pencil-square' : 'bi-eye-fill'} me-1`} />
            {preview ? 'Edit' : 'Preview'}
          </Button>
          {preview && (
            <Button size="sm" variant="outline-secondary" onClick={printPreview} title="Print / Save as PDF">
              <i className="bi bi-printer" />
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      {preview ? (
        <div className="flex-grow-1 overflow-auto py-4 px-3" style={{ background: '#f3f4f6' }}>
          <div className="text-center mb-3">
            <Badge bg="info">
              <i className="bi bi-eye-fill me-1" />Preview — sample data
            </Badge>
          </div>
          <CanvasRenderer schema={schema} metricBag={SAMPLE_METRIC_BAG} />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="d-flex flex-grow-1 overflow-hidden">
            {canEdit ? <Toolbox onInsertSection={insertSection} /> : null}

            <CanvasArea
              schema={schema}
              selectedId={selectedId}
              readOnly={!canEdit}
              onSelect={setSelectedId}
              onBlockChange={updateBlock}
              onBlockDelete={deleteBlock}
              canvasRef={(el) => { canvasElRef.current = el; }}
            />

            {canEdit ? (
              <PropertiesPanel
                schema={schema}
                selected={selected}
                onSchemaChange={updateSchema}
                onBlockChange={updateBlock}
                onBlockDelete={deleteBlock}
              />
            ) : null}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDrag?.kind === 'toolbox' && activeDrag.type && (
              <div className="px-3 py-2 rounded bg-white border shadow d-flex align-items-center gap-2"
                style={{ minWidth: 160 }}>
                <i className="bi bi-plus-lg text-primary" />
                <span className="small fw-semibold">{activeDrag.type}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
