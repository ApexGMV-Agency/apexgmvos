import { useEffect, useMemo, useRef, useState, FormEvent, CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Form, Button, Row, Col, Table, Spinner, Alert, Badge, Modal, Offcanvas, Dropdown } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import {
  MonthlyReportContent, emptyMonthlyContent, normalizeMonthlyContent, applyLastMonthFromPrev,
  emptyMonthlyTopCreator, emptyMonthlyTopVideo, emptyMonthlyProduct,
  ThisLast, RichTextWithImage,
} from '../lib/monthlyReportSchema';
import { CustomSection, CustomField, CustomFieldType, StandardSectionId } from '../lib/reportSchema';

// Standard-section render order — used to place a new custom section
// above / below a clicked section.
const MONTHLY_STD_ORDER: string[] = [
  'start', 'total_sales', 'kpis', 'gmv_breakdown', 'top_creators', 'top_videos',
  'video_performance', 'creators_performance', 'product_analytics', 'customers',
  'strategy_insights', 'discounting', 'gmv_max_ads', 'paid_collabs', 'ai_content',
  'strategy_moving_forward',
];
type ClickedSection =
  | { type: 'standard'; id: string }
  | { type: 'custom'; section: CustomSection };
import SectionComments, { Comment, CommentSection } from '../components/SectionComments';
import { useAuth } from '../auth/AuthContext';
import RichTextEditor from '../components/RichTextEditor';
import { CustomSectionInline, CustomSectionDefModal, customSectionsAt, newSection, AddSectionMenu } from '../components/CustomSectionEditor';
import NumberInput from '../components/NumberInput';
import ImageInput from '../components/ImageInput';
import { parseMonthlyReportPdf } from '../lib/importMonthlyReport';
import { useEditLock } from '../lib/useEditLock';
import { useLiveReportContent } from '../lib/useLiveReportContent';
import EditLockBanner from '../components/EditLockBanner';

const SECTION_LABELS: Record<string, string> = {
  total_sales: 'Total Sales',
  kpis: "KPI's",
  gmv_breakdown: 'GMV Breakdown',
  top_creators: 'Top Creators',
  top_videos: 'Top Videos',
  video_performance: 'Video Performance',
  creators_performance: 'Creators Performance',
  product_analytics: 'Product Analytics',
  customers: 'Customers',
  strategy_insights: 'Strategy & Insights',
  discounting: 'Discounting',
  gmv_max_ads: 'GMV Max Ads',
  paid_collabs: 'Paid Collabs',
  ai_content: 'AI Content',
  strategy_moving_forward: 'Strategy Moving Forward',
  approval: 'Approval Needed / Action Items',
};

interface MonthlyReportRow {
  id: string; brand_id: string; month: string;
  status: string; content: any; is_shared: boolean;
}
interface Brand { id: string; name: string; client: string; client_status: string | null; }

function fmtMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
function shiftMonth(yyyymm: string, delta: number) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Hand-off freeze: long enough for the previous editor's final save to land. */
const HANDOFF_SETTLE_MS = 2000;

export default function MonthlyReportEdit() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile } = useAuth();
  // Collaborative edit lock — only one teammate edits a report at a time.
  const lock = useEditLock({
    kind: 'monthly',
    id,
    userId: profile?.id,
    name: profile?.full_name || profile?.email || 'A teammate',
    role: profile?.role,
    isSuperbob: profile?.is_superbob,
  });
  const [report, setReport] = useState<MonthlyReportRow | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [c, setC] = useState<MonthlyReportContent>(emptyMonthlyContent());
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-save state (debounced) — persists the whole report content as it's edited.
  const lastSavedContent = useRef<string | null>(null);
  const [autoSave, setAutoSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // True while we re-pull the latest content right after taking over editing.
  const [reloading, setReloading] = useState(false);

  const [autoFilledMsg, setAutoFilledMsg] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: 'success' | 'warning' | 'danger'; text: string } | null>(null);

  const onImportFile = async (file: File) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const parsed = await parseMonthlyReportPdf(file);
      setC(prev => {
        const next: MonthlyReportContent = { ...prev };
        const a: any = parsed.content;
        if (a.total_sales)            next.total_sales            = { ...prev.total_sales, ...a.total_sales };
        if (a.kpis)                   next.kpis                   = a.kpis;
        if (a.gmv_breakdown)          next.gmv_breakdown          = a.gmv_breakdown;
        if (a.video_performance)      next.video_performance      = a.video_performance;
        if (a.creators_performance)   next.creators_performance   = a.creators_performance;
        if (a.top_creators_this?.length) next.top_creators_this   = a.top_creators_this;
        if (a.top_creators_last?.length) next.top_creators_last   = a.top_creators_last;
        if (a.top_videos_this?.length)   next.top_videos_this     = a.top_videos_this;
        if (a.top_videos_last?.length)   next.top_videos_last     = a.top_videos_last;
        if (a.product_analytics?.length) next.product_analytics   = a.product_analytics;
        if (a.customers)              next.customers              = a.customers;
        for (const k of ['strategy_insights','discounting','gmv_max_ads','paid_collabs','ai_content','strategy_moving_forward'] as const) {
          if (a[k]) (next as any)[k] = { ...(prev as any)[k], body: a[k].body || (prev as any)[k].body };
        }
        return next;
      });
      const pieces: string[] = [];
      const a: any = parsed.content;
      if (a.total_sales) pieces.push('Total Sales');
      if (a.kpis) pieces.push('KPIs');
      if (a.gmv_breakdown) pieces.push('GMV Breakdown');
      if (a.video_performance) pieces.push('Video Performance');
      if (a.creators_performance) pieces.push('Creators Performance');
      if (a.top_creators_this?.length || a.top_creators_last?.length) pieces.push(`${(a.top_creators_this?.length ?? 0) + (a.top_creators_last?.length ?? 0)} creator rows`);
      if (a.top_videos_this?.length || a.top_videos_last?.length)     pieces.push(`${(a.top_videos_this?.length ?? 0) + (a.top_videos_last?.length ?? 0)} video rows`);
      if (a.product_analytics?.length) pieces.push(`${a.product_analytics.length} product${a.product_analytics.length === 1 ? '' : 's'}`);
      if (a.customers) pieces.push('Customers');
      for (const k of ['strategy_insights','discounting','gmv_max_ads','paid_collabs','ai_content','strategy_moving_forward'] as const) {
        if (a[k]?.body) pieces.push(SECTION_LABELS[k]);
      }
      const summary = pieces.length > 0
        ? `Imported: ${pieces.join(', ')}. Review the fields and save when ready.`
        : 'Nothing recognizable was extracted. Make sure the PDF uses the standard monthly report layout.';
      const warnSuffix = parsed.warnings.length > 0 ? ` (warnings: ${parsed.warnings.join('; ')})` : '';
      setImportMsg({ kind: pieces.length > 0 ? 'success' : 'warning', text: summary + warnSuffix });
    } catch (e: any) {
      setImportMsg({ kind: 'danger', text: `Failed to parse PDF: ${e?.message ?? 'unknown error'}` });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const [csModalOpen, setCsModalOpen] = useState(false);
  const [csDraft, setCsDraft] = useState<CustomSection>(newSection());
  const [csIsEdit, setCsIsEdit] = useState(false);
  const [csTargetIndex, setCsTargetIndex] = useState<number | null>(null);

  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);

  interface PresetRow {
    id: string;
    name: string;
    payload: any;
    kind: 'custom' | 'standard';
    section_id: string | null;
    created_by: string | null;
    created_at: string;
  }
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [presetMsg, setPresetMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!presetMsg) return;
    const t = setTimeout(() => setPresetMsg(null), 3500);
    return () => clearTimeout(t);
  }, [presetMsg]);

  // Initial load — fetches report + brand + comments + presets,
  // and auto-pulls "Last Month" data from the previous month's report when
  // the current report is still blank (i.e. first time the APC opens it).
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('monthly_reports').select('*').eq('id', id).single();
      if (error) { setErr(error.message); setLoading(false); return; }
      const r = data as MonthlyReportRow;
      setReport(r);
      const normalised = normalizeMonthlyContent(r.content);
      setC(normalised);
      lastSavedContent.current = JSON.stringify(normalised);
      const { data: bd } = await supabase.from('brands').select('id,name,client,client_status').eq('id', r.brand_id).single();
      setBrand(bd as Brand);

      // Auto-pull "Last Month" — only if the current report is blank, so we
      // never overwrite numbers the APC has already typed.
      const empty = JSON.stringify(r.content ?? {}) === '{}' || Object.keys(r.content ?? {}).length === 0;
      if (empty) {
        const prevMonth = shiftMonth(r.month, -1);
        const { data: prev } = await supabase.from('monthly_reports')
          .select('content').eq('brand_id', r.brand_id).eq('month', prevMonth).maybeSingle();
        if (prev?.content) {
          const prevC = normalizeMonthlyContent(prev.content);
          setC(prevC2 => applyLastMonthFromPrev(prevC2, prevC));
          setAutoFilledMsg(`Auto-filled "Last Month" values from ${fmtMonth(prevMonth)}.`);
        }
      }

      const { data: cm } = await supabase.from('report_comments')
        .select('*').eq('report_id', r.id).eq('report_type', 'monthly').order('created_at', { ascending: true });
      setComments((cm as Comment[]) ?? []);
      const { data: pr } = await supabase.from('monthly_section_presets')
        .select('id,name,payload,kind,section_id,created_by,created_at').order('created_at', { ascending: false });
      setPresets(((pr as any[]) ?? []).map(p => ({
        ...p, kind: p.kind ?? 'custom', section_id: p.section_id ?? null,
      })) as PresetRow[]);
      setLoading(false);
    })();
  }, [id]);

  // Debounced auto-save of the whole report content (status untouched) ~1s
  // after the user stops editing — covers every rich-text (Quill) section and
  // all other fields.
  const contentKey = JSON.stringify(c);
  useEffect(() => {
    if (loading || !report || lastSavedContent.current === null) return;
    if (brand?.client_status === 'closed') return;
    // Another teammate holds the edit lock — never write from a read-only view.
    if (lock.isLockedOut) return;
    // Don't persist the stale snapshot while we're pulling the latest content.
    if (reloading) return;
    if (contentKey === lastSavedContent.current) return;
    setAutoSave('saving');
    const t = setTimeout(async () => {
      const { error } = await supabase.from('monthly_reports')
        .update({ content: c }).eq('id', id);
      if (error) { setAutoSave('error'); return; }
      lastSavedContent.current = contentKey;
      setAutoSave('saved');
    }, 1000);
    return () => clearTimeout(t);
  }, [contentKey, lock.isLockedOut]);

  // Follow the current editor's autosaved changes live while locked out, so a
  // read-only viewer never has to reload to see the latest data. It stays on
  // through the hand-off freeze too, so whoever takes over arrives holding the
  // previous editor's final save instead of a stale snapshot.
  useLiveReportContent({
    table: 'monthly_reports',
    id,
    active: lock.isLockedOut || reloading,
    onContent: raw => {
      const normalized = normalizeMonthlyContent(raw);
      setC(normalized);
      lastSavedContent.current = JSON.stringify(normalized);
    },
  });

  // Edit-lock hand-off (see WeeklyReportEdit): flush our newest edits when we
  // LOSE control, and re-pull the latest content when we GAIN it, freezing the
  // form briefly during the swap so we don't clobber the incoming changes.
  const wasLockedOut = useRef(false);
  useEffect(() => {
    if (loading || !report) return;
    const nowLocked = lock.isLockedOut;
    if (nowLocked === wasLockedOut.current) return;
    const lostControl = nowLocked && !wasLockedOut.current;
    const gainedControl = !nowLocked && wasLockedOut.current;
    wasLockedOut.current = nowLocked;

    if (lostControl) {
      if (brand?.client_status === 'closed') return;
      const snapshot = c;
      void supabase.from('monthly_reports').update({ content: snapshot }).eq('id', id)
        .then(({ error }) => { if (!error) lastSavedContent.current = JSON.stringify(snapshot); });
    } else if (gainedControl) {
      setReloading(true);
      const t = setTimeout(async () => {
        const { data, error } = await supabase.from('monthly_reports').select('content').eq('id', id).single();
        if (!error && data) {
          const normalised = normalizeMonthlyContent(data.content);
          setC(normalised);
          lastSavedContent.current = JSON.stringify(normalised);
          setAutoSave('idle');
        }
        setReloading(false);
      }, HANDOFF_SETTLE_MS);
      return () => clearTimeout(t);
    }
  }, [lock.isLockedOut]);

  const customPresets = useMemo(() => presets.filter(p => p.kind === 'custom'), [presets]);
  const standardPresetsFor = (sectionId: string) =>
    presets.filter(p => p.kind === 'standard' && p.section_id === sectionId);

  // ---------- helpers for nested updates ----------
  const setTL = (group: keyof MonthlyReportContent, field: string, side: 'this' | 'last', n: number) =>
    setC(prev => {
      const g: any = { ...(prev as any)[group] };
      g[field] = { ...(g[field] as ThisLast), [side]: n };
      return { ...prev, [group]: g } as MonthlyReportContent;
    });
  const setTotalSales = (k: keyof MonthlyReportContent['total_sales'], v: any) =>
    setC(prev => ({ ...prev, total_sales: { ...prev.total_sales, [k]: v } }));
  const setRich = (sec: 'strategy_insights'|'discounting'|'gmv_max_ads'|'paid_collabs'|'ai_content'|'strategy_moving_forward', patch: Partial<RichTextWithImage>) =>
    setC(prev => ({ ...prev, [sec]: { ...(prev as any)[sec], ...patch } }));
  const setCustomers = (k: keyof MonthlyReportContent['customers'], v: any) =>
    setC(prev => ({ ...prev, customers: { ...prev.customers, [k]: v } as MonthlyReportContent['customers'] }));

  const updRow = <T,>(key: 'top_creators_this'|'top_creators_last'|'top_videos_this'|'top_videos_last'|'product_analytics', i: number, patch: Partial<T>) =>
    setC(prev => {
      const arr = [...((prev as any)[key] as any[])];
      arr[i] = { ...arr[i], ...patch };
      return { ...prev, [key]: arr } as MonthlyReportContent;
    });
  const addRow = (key: 'top_creators_this'|'top_creators_last'|'top_videos_this'|'top_videos_last'|'product_analytics', factory: () => any) =>
    setC(prev => ({ ...prev, [key]: [...((prev as any)[key] as any[]), factory()] } as MonthlyReportContent));
  const delRow = (key: 'top_creators_this'|'top_creators_last'|'top_videos_this'|'top_videos_last'|'product_analytics', i: number) =>
    setC(prev => {
      const arr = [...((prev as any)[key] as any[])];
      arr.splice(i, 1);
      return { ...prev, [key]: arr } as MonthlyReportContent;
    });

  // ---------- comments ----------
  const addComment = async (section: CommentSection, body: string, _authorName: string, parentId?: string) => {
    if (!report) return;
    const { data, error } = await supabase.functions.invoke('post-staff-comment', {
      body: { report_id: report.id, report_type: 'monthly', section, body, parent_id: parentId ?? null },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
  };

  // ---------- custom sections ----------
  const openAddCustom = () => {
    setCsDraft(newSection());
    setCsIsEdit(false);
    setCsTargetIndex(null);
    setCsModalOpen(true);
  };

  // Open the add-section modal positioned above/below a clicked section.
  const openAddSectionRelative = (clicked: ClickedSection, placement: 'above' | 'below') => {
    const cs = c.custom_sections;
    let anchor: string;
    let index: number;
    if (clicked.type === 'custom') {
      anchor = clicked.section.insert_after as unknown as string;
      const idx = cs.findIndex(s => s.id === clicked.section.id);
      index = placement === 'below' ? idx + 1 : Math.max(0, idx);
    } else if (placement === 'below') {
      anchor = clicked.id;
      const firstIdx = cs.findIndex(s => (s.insert_after as unknown as string) === anchor);
      index = firstIdx === -1 ? cs.length : firstIdx;
    } else {
      const stdIdx = MONTHLY_STD_ORDER.indexOf(clicked.id);
      anchor = stdIdx > 0 ? MONTHLY_STD_ORDER[stdIdx - 1] : 'start';
      let lastIdx = -1;
      cs.forEach((s, i) => { if ((s.insert_after as unknown as string) === anchor) lastIdx = i; });
      index = lastIdx === -1 ? cs.length : lastIdx + 1;
    }
    setCsDraft(newSection(anchor as unknown as StandardSectionId));
    setCsIsEdit(false);
    setCsTargetIndex(index);
    setCsModalOpen(true);
  };

  const saveCustomDef = (s: CustomSection) => {
    if (csIsEdit) {
      setC(prev => ({ ...prev, custom_sections: prev.custom_sections.map(x => x.id === s.id ? s : x) }));
    } else {
      setC(prev => {
        const arr = [...prev.custom_sections];
        if (csTargetIndex != null) arr.splice(Math.min(csTargetIndex, arr.length), 0, s);
        else arr.push(s);
        return { ...prev, custom_sections: arr };
      });
    }
    setCsModalOpen(false);
    setCsTargetIndex(null);
  };
  const deleteCustom = (id: string) =>
    setC(prev => ({ ...prev, custom_sections: prev.custom_sections.filter(s => s.id !== id) }));
  const updateCustom = (id: string, patch: Partial<CustomSection>) =>
    setC(prev => ({ ...prev, custom_sections: prev.custom_sections.map(s => s.id === id ? { ...s, ...patch } : s) }));

  const renderCustomAt = (anchor: string) => {
    const here = c.custom_sections.filter(s => (s.insert_after as unknown as string) === anchor);
    if (here.length === 0) return null;
    return here.map(s => (
      <CustomSectionInline
        key={s.id}
        section={s}
        onChange={patch => updateCustom(s.id, patch)}
        onEditDef={() => { setCsDraft(s); setCsIsEdit(true); setCsModalOpen(true); }}
        onRemove={() => deleteCustom(s.id)}
        onAddSection={(placement) => openAddSectionRelative({ type: 'custom', section: s }, placement)}
        headerExtra={
          <>
            <Dropdown>
              <Dropdown.Toggle size="sm" variant="outline-info" title="Add a saved preset as a new section">
                <i className="bi bi-bookmark" />
              </Dropdown.Toggle>
              <Dropdown.Menu align="end" style={{ minWidth: 240 }}>
                <Dropdown.Header>Add preset as a new section below</Dropdown.Header>
                {customPresets.length === 0 ? (
                  <Dropdown.ItemText className="text-muted small">No saved presets yet.</Dropdown.ItemText>
                ) : customPresets.map(p => (
                  <Dropdown.Item key={p.id} as="button" onClick={() => addPresetSectionBelow(s, p)}>
                    <i className="bi bi-box-arrow-in-down me-2" />{p.name}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
            <Button size="sm" variant="outline-info"
              onClick={() => saveCustomSectionAsPreset(s)} title="Save this section as a reusable preset">
              <i className="bi bi-bookmark-plus" />
            </Button>
            <FeedbackButton section={`cs:${s.id}`} />
          </>
        }
      />
    ));
  };

  // ---------- preset save / apply for standard sections ----------
  const saveStandardPreset = async (sectionId: keyof MonthlyReportContent) => {
    const name = window.prompt(`Save the current ${SECTION_LABELS[sectionId as string] ?? sectionId} as a preset. Name:`);
    if (!name) return;
    const payload = (c as any)[sectionId];
    const { data, error } = await supabase.from('monthly_section_presets')
      .insert({ name: name.trim(), payload, kind: 'standard', section_id: sectionId, created_by: profile?.id ?? null })
      .select().single();
    if (error) { alert(error.message); return; }
    setPresets(prev => [data as PresetRow, ...prev]);
    setPresetMsg(`Saved preset "${(data as PresetRow).name}".`);
  };
  const applyStandardPreset = (sectionId: keyof MonthlyReportContent, p: PresetRow) => {
    setC(prev => ({ ...prev, [sectionId]: p.payload } as MonthlyReportContent));
    setPresetMsg(`Applied "${p.name}".`);
  };
  const removePreset = async (p: PresetRow) => {
    if (!confirm(`Delete preset "${p.name}" from the monthly library?`)) return;
    const { error } = await supabase.from('monthly_section_presets').delete().eq('id', p.id);
    if (error) { alert(error.message); return; }
    setPresets(prev => prev.filter(x => x.id !== p.id));
  };
  const addCustomFromPreset = (preset: PresetRow) => {
    const p = preset.payload ?? {};
    const cs: CustomSection = {
      id: crypto.randomUUID(),
      name: String(p.name ?? preset.name ?? ''),
      description: String(p.description ?? ''),
      is_repeater: !!p.is_repeater,
      body: '',
      fields: Array.isArray(p.fields) ? p.fields.map((f: any) => ({
        id: crypto.randomUUID(),
        label: String(f.label ?? ''),
        type: f.type ?? 'text',
        options: Array.isArray(f.options) ? f.options : undefined,
      })) : [],
      rows: [],
      insert_after: (p.insert_after ?? 'strategy_moving_forward') as unknown as StandardSectionId,
    };
    setC(prev => ({ ...prev, custom_sections: [...prev.custom_sections, cs] }));
    setPresetMsg(`Added "${cs.name}" from preset.`);
  };

  // Save one custom section as a reusable preset.
  const saveCustomSectionAsPreset = async (s: CustomSection) => {
    const name = window.prompt('Save this section as a preset. Name:', s.name || 'Untitled section');
    if (!name) return;
    const payload = {
      name: s.name,
      description: s.description,
      is_repeater: s.is_repeater,
      insert_after: s.insert_after,
      fields: s.fields.map(f => ({ label: f.label, type: f.type, options: f.options })),
    };
    const { data, error } = await supabase.from('monthly_section_presets')
      .insert({ name: name.trim(), payload, created_by: profile?.id ?? null })
      .select().single();
    if (error) { alert(error.message); return; }
    setPresets(prev => [data as PresetRow, ...prev]);
    setPresetMsg(`Saved preset "${(data as PresetRow).name}".`);
  };

  // Add a saved preset as a NEW section, placed right below the clicked one.
  const addPresetSectionBelow = (clicked: CustomSection, preset: PresetRow) => {
    const p = preset.payload ?? {};
    const cs: CustomSection = {
      ...newSection(clicked.insert_after),
      name: String(p.name ?? preset.name ?? ''),
      description: String(p.description ?? ''),
      is_repeater: !!p.is_repeater,
      fields: Array.isArray(p.fields) ? p.fields.map((f: any): CustomField => ({
        id: crypto.randomUUID(),
        label: String(f.label ?? ''),
        type: (['text', 'number', 'textarea', 'richtext', 'date', 'url', 'select'].includes(f.type) ? f.type : 'text') as CustomFieldType,
        options: Array.isArray(f.options) ? f.options : undefined,
      })) : [],
      rows: [],
    };
    setC(prev => {
      const arr = [...prev.custom_sections];
      const idx = arr.findIndex(x => x.id === clicked.id);
      arr.splice(idx === -1 ? arr.length : idx + 1, 0, cs);
      return { ...prev, custom_sections: arr };
    });
    setPresetMsg(`Added "${cs.name || preset.name}" from preset below the section.`);
  };

  // ---------- save ----------
  const submit = async (e: FormEvent, status: 'draft' | 'submitted') => {
    e.preventDefault();
    if (brand?.client_status === 'closed') {
      setErr(`${brand.name} is inactive — reactivate the brand before saving changes.`);
      return;
    }
    if (lock.isLockedOut) {
      setErr(`${lock.editorName ?? 'Another teammate'} is currently editing this report. Use "Take over editing" to make changes.`);
      return;
    }
    if (reloading) return; // mid hand-off — wait for the latest content to load
    setSaving(true); setErr(null);
    const update: Record<string, any> = { content: c, status };
    if (c.approval?.enabled) update.is_shared = true;
    const { error } = await supabase.from('monthly_reports').update(update).eq('id', id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    nav(`/reporting/monthly/${id}`);
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err && !report) return <Alert variant="danger">{err}</Alert>;
  if (!report || !brand) return null;

  const brandInactive = brand.client_status === 'closed';
  // Freeze the form body when another teammate holds the lock OR while we're
  // pulling the latest content right after taking over.
  const formFrozen = lock.isLockedOut || reloading;
  const lockStyle: CSSProperties | undefined = formFrozen
    ? { pointerEvents: 'none', opacity: 0.55, userSelect: 'none' }
    : undefined;

  // ---------- small inline UI helpers ----------
  const FeedbackButton = ({ section }: { section: CommentSection }) => {
    const n = comments.filter(c => c.section === section).length;
    if (n === 0 && section !== 'approval') return null;  // approval is bidirectional, always show
    return (
      <Button size="sm" variant="outline-info" className="ms-2" onClick={() => setFeedbackSection(section)}>
        <i className="bi bi-chat-left-text me-1" /> {n > 0 ? `Feedback (${n})` : 'Notes'}
      </Button>
    );
  };
  // Small "Saving… / Saved" badge shown on auto-saved (rich-text) sections.
  const AutoSaveBadge = () => {
    if (autoSave === 'idle') return null;
    return (
      <span className={`small ${autoSave === 'error' ? 'text-danger' : 'text-muted'}`}>
        {autoSave === 'saving' && (<><Spinner animation="border" size="sm" className="me-1" />Saving…</>)}
        {autoSave === 'saved' && (<><i className="bi bi-check2 me-1" />Saved</>)}
        {autoSave === 'error' && (<><i className="bi bi-exclamation-triangle me-1" />Save failed</>)}
      </span>
    );
  };
  const StdPresetMenu = ({ sectionId }: { sectionId: keyof MonthlyReportContent }) => {
    const list = standardPresetsFor(sectionId as string);
    return (
      <Dropdown className="ms-2 d-inline-block">
        <Dropdown.Toggle size="sm" variant="outline-info" title={`Presets for ${SECTION_LABELS[sectionId as string] ?? sectionId}`}>
          <i className="bi bi-bookmark" />
        </Dropdown.Toggle>
        <Dropdown.Menu align="end" style={{ minWidth: 240 }}>
          <Dropdown.Header className="small">Presets — {SECTION_LABELS[sectionId as string] ?? sectionId}</Dropdown.Header>
          {list.length === 0
            ? <Dropdown.ItemText className="text-muted small">No presets saved yet</Dropdown.ItemText>
            : list.map(p => (
                <div key={p.id} className="d-flex align-items-center px-2 py-1" style={{ gap: 4 }}>
                  <Dropdown.Item as="button" className="flex-grow-1 px-2 py-1" onClick={() => applyStandardPreset(sectionId, p)}>
                    {p.name}
                  </Dropdown.Item>
                  {(p.created_by === profile?.id || profile?.role === 'bob') && (
                    <Button size="sm" variant="link" className="text-danger p-0 px-2"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); removePreset(p); }}>
                      <i className="bi bi-trash" />
                    </Button>
                  )}
                </div>
              ))}
          <Dropdown.Divider />
          <Dropdown.Item onClick={() => saveStandardPreset(sectionId)}>
            <i className="bi bi-plus-lg me-1" /> Save current as preset
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
    );
  };
  const HeaderWithFeedback = ({ title, sectionId }: { title: string; sectionId: keyof MonthlyReportContent }) => (
    <div className="d-flex justify-content-between align-items-center w-100">
      <span className="fw-semibold">{title}</span>
      <span className="d-inline-flex align-items-center gap-2">
        <StdPresetMenu sectionId={sectionId} />
        <AddSectionMenu onPick={(pl) => openAddSectionRelative({ type: 'standard', id: sectionId as string }, pl)} />
        <FeedbackButton section={sectionId as string} />
      </span>
    </div>
  );
  // Render a "Metric / This Month / Last Month" row as a JSX expression — NOT
  // a component. If we made this a component declared inside MonthlyReportEdit,
  // every render would give it a new identity and React would unmount + remount
  // the inputs underneath it on every keystroke, killing focus.
  const tlRow = (label: string, group: keyof MonthlyReportContent, field: string, opts?: {
    dec?: boolean; suffix?: string; integer?: boolean;
  }) => {
    const { dec, suffix, integer } = opts ?? {};
    const tl = ((c as any)[group] as any)[field] as ThisLast;
    return (
      <Row key={`${String(group)}-${field}`} className="g-2 align-items-center mb-2">
        <Col md={4}><Form.Label className="small mb-0">{label}{suffix ? ` (${suffix})` : ''}</Form.Label></Col>
        <Col md={4}><NumberInput value={tl.this} step={dec ? '0.01' : (integer ? '1' : '0.01')} onChange={n => setTL(group, field, 'this', n)} /></Col>
        <Col md={4}><NumberInput value={tl.last} step={dec ? '0.01' : (integer ? '1' : '0.01')} onChange={n => setTL(group, field, 'last', n)} /></Col>
      </Row>
    );
  };

  return (
    <div className="ac-themed">
      {brandInactive && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill" />
          <div>
            <strong>{brand.name} is inactive.</strong>{' '}
            You can review the data but Save is disabled until the brand is reactivated.
          </div>
        </Alert>
      )}
      <EditLockBanner lock={lock} />
      {reloading && (
        <Alert variant="info" className="d-flex align-items-center gap-2">
          <Spinner animation="border" size="sm" />
          <span>You took over — loading the latest changes…</span>
        </Alert>
      )}
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-2">
        <div>
          <h2 className="mb-1">{brand.name} <small className="text-muted fs-6">— {brand.client}</small></h2>
          <div className="text-muted">
            Monthly · {fmtMonth(report.month)}
            <Badge bg={report.status === 'draft' ? 'secondary' : 'success'} className="ms-2">{report.status}</Badge>
            {lock.ready && lock.othersCount > 0 && lock.isOwner && (
              <Badge bg="success" className="ms-2">
                <i className="bi bi-pencil-fill me-1" />You have control · {lock.othersCount} watching
              </Badge>
            )}
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <input
            ref={importInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
            }}
          />
          <Button variant="outline-warning" disabled={importing || formFrozen} onClick={() => importInputRef.current?.click()}
            title="Upload a monthly-report PDF and auto-fill the form fields">
            <i className="bi bi-file-earmark-arrow-up me-1" />
            {importing ? 'Reading PDF…' : 'Import from PDF'}
          </Button>
          <Dropdown>
            <Dropdown.Toggle variant="outline-info" disabled={formFrozen} title="Insert a saved custom-section preset (monthly library)">
              <i className="bi bi-bookmark me-1" /> Add from preset
              {customPresets.length > 0 && <Badge bg="info" pill className="ms-1">{customPresets.length}</Badge>}
            </Dropdown.Toggle>
            <Dropdown.Menu align="end" style={{ minWidth: 280, maxHeight: 320, overflowY: 'auto' }}>
              {customPresets.length === 0 ? (
                <Dropdown.ItemText className="text-muted small">No saved monthly custom-section presets yet.</Dropdown.ItemText>
              ) : customPresets.map(p => (
                <div key={p.id} className="d-flex align-items-center px-2 py-1" style={{ gap: 4 }}>
                  <Dropdown.Item as="button" className="flex-grow-1 px-2 py-1" onClick={() => addCustomFromPreset(p)}>
                    <div className="fw-semibold">{p.name}</div>
                    <small className="text-muted">
                      {p.payload?.is_repeater ? 'Table' : 'Long text'} · {p.payload?.fields?.length ?? 0} field{(p.payload?.fields?.length ?? 0) === 1 ? '' : 's'}
                    </small>
                  </Dropdown.Item>
                  {(p.created_by === profile?.id || profile?.role === 'bob') && (
                    <Button size="sm" variant="link" className="text-danger p-0 px-2"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); removePreset(p); }}>
                      <i className="bi bi-trash" />
                    </Button>
                  )}
                </div>
              ))}
            </Dropdown.Menu>
          </Dropdown>
          <Button variant="outline-success" disabled={formFrozen} onClick={openAddCustom}>
            <i className="bi bi-plus-square me-1" /> Add custom section
          </Button>
          <Button variant="outline-secondary" onClick={() => nav('/reporting/monthly')}>Cancel</Button>
          <Button variant="outline-primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
          <Button variant="primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}
      {presetMsg && <Alert variant="info" className="py-2 small" dismissible onClose={() => setPresetMsg(null)}>{presetMsg}</Alert>}
      {autoFilledMsg && <Alert variant="success" className="py-2 small" dismissible onClose={() => setAutoFilledMsg(null)}>{autoFilledMsg}</Alert>}
      {importMsg && (
        <Alert variant={importMsg.kind} className="py-2 small" dismissible onClose={() => setImportMsg(null)}>
          {importMsg.text}
        </Alert>
      )}

      <div style={lockStyle} aria-disabled={formFrozen}>
      {renderCustomAt('start')}

      {/* Total Sales */}
      <Card className="mb-4" data-section="total_sales">
        <Card.Header><HeaderWithFeedback title="Total Sales" sectionId="total_sales" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={3}>
              <Form.Label className="small">Month total ($)</Form.Label>
              <NumberInput step="0.01" value={c.total_sales.month} onChange={n => setTotalSales('month', n)} />
            </Col>
            <Col md={3}>
              <Form.Label className="small">All-time total ($)</Form.Label>
              <NumberInput step="0.01" value={c.total_sales.all_time} onChange={n => setTotalSales('all_time', n)} />
            </Col>
            <Col md={6}>
              <Form.Label className="small">All-time period label</Form.Label>
              <Form.Control value={c.total_sales.all_time_period_label}
                onChange={e => setTotalSales('all_time_period_label', e.target.value)}
                placeholder='e.g. "April 1, 2025 – March 31, 2026"' />
            </Col>
            <Col md={12}>
              <Form.Label className="small">Image (e.g. TikTok Key Metrics screenshot)</Form.Label>
              <ImageInput value={c.total_sales.image_url}
                onChange={url => setTotalSales('image_url', url)}
                brandId={brand.id} reportType="monthly"
                placeholder="Upload a screenshot" />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('total_sales')}

      {/* KPIs */}
      <Card className="mb-4" data-section="kpis">
        <Card.Header><HeaderWithFeedback title="KPIs" sectionId="kpis" /></Card.Header>
        <Card.Body>
          <Row className="g-2 mb-1"><Col md={4}><strong className="small">Metric</strong></Col><Col md={4}><strong className="small">This Month</strong></Col><Col md={4}><strong className="small">Last Month</strong></Col></Row>
          {tlRow('Samples Approved',    'kpis', 'samples_approved',    { integer: true })}
          {tlRow('New Affiliate Posts', 'kpis', 'new_affiliate_posts', { integer: true })}
          {tlRow('Completed Collabs',   'kpis', 'completed_collabs',   { integer: true })}
          {tlRow('Content Pending',     'kpis', 'content_pending',     { integer: true })}
          {tlRow('Total Orders',        'kpis', 'total_orders',        { integer: true })}
        </Card.Body>
      </Card>
      {renderCustomAt('kpis')}

      {/* GMV Breakdown */}
      <Card className="mb-4" data-section="gmv_breakdown">
        <Card.Header><HeaderWithFeedback title="GMV Breakdown" sectionId="gmv_breakdown" /></Card.Header>
        <Card.Body>
          <Row className="g-2 mb-1"><Col md={4}><strong className="small">GMV</strong></Col><Col md={4}><strong className="small">This Month ($)</strong></Col><Col md={4}><strong className="small">Last Month ($)</strong></Col></Row>
          {tlRow('Affiliate GMV',    'gmv_breakdown', 'affiliate_gmv')}
          {tlRow('Organic GMV',      'gmv_breakdown', 'organic_gmv')}
          {tlRow('LIVE GMV',         'gmv_breakdown', 'live_gmv')}
          {tlRow('Video GMV',        'gmv_breakdown', 'video_gmv')}
          {tlRow('Product Card GMV', 'gmv_breakdown', 'product_card_gmv')}
        </Card.Body>
      </Card>
      {renderCustomAt('gmv_breakdown')}

      {/* Top Creators (this & last) */}
      <Card className="mb-4" data-section="top_creators">
        <Card.Header><HeaderWithFeedback title="Top Creators" sectionId="top_creators_this" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col lg={6}>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <strong>This Month</strong>
                <Button size="sm" onClick={() => addRow('top_creators_this', emptyMonthlyTopCreator)}>
                  <i className="bi bi-plus-lg me-1" />Add
                </Button>
              </div>
              <CreatorRows rows={c.top_creators_this} upd={(i, p) => updRow('top_creators_this', i, p)} del={i => delRow('top_creators_this', i)} />
            </Col>
            <Col lg={6}>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <strong>Last Month <small className="text-muted">(auto-pulled from previous report — editable)</small></strong>
                <Button size="sm" variant="outline-secondary" onClick={() => addRow('top_creators_last', emptyMonthlyTopCreator)}>
                  <i className="bi bi-plus-lg me-1" />Add
                </Button>
              </div>
              <CreatorRows rows={c.top_creators_last} upd={(i, p) => updRow('top_creators_last', i, p)} del={i => delRow('top_creators_last', i)} />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('top_creators')}

      {/* Top Videos (this & last) */}
      <Card className="mb-4" data-section="top_videos">
        <Card.Header><HeaderWithFeedback title="Top Videos" sectionId="top_videos_this" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col lg={6}>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <strong>This Month</strong>
                <Button size="sm" onClick={() => addRow('top_videos_this', emptyMonthlyTopVideo)}>
                  <i className="bi bi-plus-lg me-1" />Add
                </Button>
              </div>
              <VideoRows rows={c.top_videos_this} upd={(i, p) => updRow('top_videos_this', i, p)} del={i => delRow('top_videos_this', i)} />
            </Col>
            <Col lg={6}>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <strong>Last Month</strong>
                <Button size="sm" variant="outline-secondary" onClick={() => addRow('top_videos_last', emptyMonthlyTopVideo)}>
                  <i className="bi bi-plus-lg me-1" />Add
                </Button>
              </div>
              <VideoRows rows={c.top_videos_last} upd={(i, p) => updRow('top_videos_last', i, p)} del={i => delRow('top_videos_last', i)} />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('top_videos')}

      {/* Video Performance */}
      <Card className="mb-4" data-section="video_performance">
        <Card.Header><HeaderWithFeedback title="Video Performance" sectionId="video_performance" /></Card.Header>
        <Card.Body>
          <Row className="g-2 mb-1"><Col md={4}><strong className="small">Metric</strong></Col><Col md={4}><strong className="small">This Month</strong></Col><Col md={4}><strong className="small">Last Month</strong></Col></Row>
          {tlRow('Product Impressions',     'video_performance', 'product_impressions', { integer: true })}
          {tlRow('Product Clicks',          'video_performance', 'product_clicks',      { integer: true })}
          {tlRow('Video Views',             'video_performance', 'video_views',         { integer: true })}
          {tlRow('CTR (%)',                 'video_performance', 'ctr',                 { dec: true })}
          {tlRow('CTOR (%)',                'video_performance', 'ctor',                { dec: true })}
          {tlRow('SKU Orders',              'video_performance', 'sku_orders',          { integer: true })}
          {tlRow('GMV ($)',                 'video_performance', 'gmv')}
          {tlRow('Videos with 1M+ Views',   'video_performance', 'videos_1m_views',     { integer: true })}
          {tlRow('Videos with 100k+ Views', 'video_performance', 'videos_100k_views',   { integer: true })}
          {tlRow('Videos with 10k+ Views',  'video_performance', 'videos_10k_views',    { integer: true })}
          {tlRow('Videos with $1000+ GMV',  'video_performance', 'videos_1k_gmv',       { integer: true })}
          {tlRow('Videos with $100+ GMV',   'video_performance', 'videos_100_gmv',      { integer: true })}
          {tlRow('No. of New Videos Posted','video_performance', 'new_videos_posted',   { integer: true })}
        </Card.Body>
      </Card>
      {renderCustomAt('video_performance')}

      {/* Creators Performance */}
      <Card className="mb-4" data-section="creators_performance">
        <Card.Header><HeaderWithFeedback title="Creators Performance" sectionId="creators_performance" /></Card.Header>
        <Card.Body>
          <Row className="g-2 mb-1"><Col md={4}><strong className="small">Metric</strong></Col><Col md={4}><strong className="small">This Month</strong></Col><Col md={4}><strong className="small">Last Month</strong></Col></Row>
          {tlRow('Creators who posted 1+ videos',    'creators_performance', 'posted_1plus',        { integer: true })}
          {tlRow('Creators who posted 3+ videos',    'creators_performance', 'posted_3plus',        { integer: true })}
          {tlRow('Creators who posted 10+ videos',   'creators_performance', 'posted_10plus',       { integer: true })}
          {tlRow('Creators who generated $1k+ GMV',  'creators_performance', 'generated_1k_plus',   { integer: true })}
          {tlRow('Creators who generated $100+ GMV', 'creators_performance', 'generated_100_plus',  { integer: true })}
        </Card.Body>
      </Card>
      {renderCustomAt('creators_performance')}

      {/* Product Analytics */}
      <Card className="mb-4" data-section="product_analytics">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <HeaderWithFeedback title="Product Analytics" sectionId="product_analytics" />
          <Button size="sm" onClick={() => addRow('product_analytics', emptyMonthlyProduct)}>
            <i className="bi bi-plus-lg me-1" />Add product
          </Button>
        </Card.Header>
        <Card.Body className="p-0">
          {c.product_analytics.length === 0 ? (
            <p className="text-muted text-center py-3 mb-0 small">No products tracked yet.</p>
          ) : (
            <Table size="sm" responsive className="mb-0 align-middle">
              <thead><tr>
                <th>Product ID</th><th>Name</th>
                <th className="text-end">Units Sold</th>
                <th className="text-end">GMV ($)</th>
                <th className="text-end">Samples Approved</th>
                <th>Notes</th>
                <th style={{ width: 50 }}></th>
              </tr></thead>
              <tbody>
                {c.product_analytics.map((r, i) => (
                  <tr key={i}>
                    <td><Form.Control size="sm" value={r.product_id} onChange={e => updRow('product_analytics', i, { product_id: e.target.value })} placeholder="e.g. 1732…" /></td>
                    <td><Form.Control size="sm" value={r.product_name} onChange={e => updRow('product_analytics', i, { product_name: e.target.value })} /></td>
                    <td><NumberInput size="sm" value={r.units_sold} onChange={n => updRow('product_analytics', i, { units_sold: n })} /></td>
                    <td><NumberInput size="sm" step="0.01" value={r.gmv} onChange={n => updRow('product_analytics', i, { gmv: n })} /></td>
                    <td><NumberInput size="sm" value={r.samples_approved} onChange={n => updRow('product_analytics', i, { samples_approved: n })} /></td>
                    <td><Form.Control size="sm" value={r.notes} onChange={e => updRow('product_analytics', i, { notes: e.target.value })} /></td>
                    <td><Button size="sm" variant="outline-danger" onClick={() => delRow('product_analytics', i)}><i className="bi bi-trash" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
      {renderCustomAt('product_analytics')}

      {/* Customers */}
      <Card className="mb-4" data-section="customers">
        <Card.Header><HeaderWithFeedback title="Customers" sectionId="customers" /></Card.Header>
        <Card.Body>
          <Row className="g-2 mb-1"><Col md={4}><strong className="small">Metric</strong></Col><Col md={4}><strong className="small">This Month</strong></Col><Col md={4}><strong className="small">Last Month</strong></Col></Row>
          {tlRow('Aware Customers',         'customers', 'aware_customers',         { integer: true })}
          {tlRow('New Customers',           'customers', 'new_customers',           { integer: true })}
          {tlRow('Potential New Customers', 'customers', 'potential_new_customers', { integer: true })}
          <Row className="g-2 align-items-center mb-2">
            <Col md={4}><Form.Label className="small mb-0">CRM Messages Sent</Form.Label></Col>
            <Col md={4}><Form.Control value={c.customers.crm_messages_sent_this} onChange={e => setCustomers('crm_messages_sent_this', e.target.value)} placeholder="e.g. Not Yet Eligible or 1234" /></Col>
            <Col md={4}><Form.Control value={c.customers.crm_messages_sent_last} onChange={e => setCustomers('crm_messages_sent_last', e.target.value)} /></Col>
          </Row>
          {tlRow('Converted Customers', 'customers', 'converted_customers', { integer: true })}
        </Card.Body>
      </Card>
      {renderCustomAt('customers')}

      {/* Six rich-text + image sections */}
      {(['strategy_insights','discounting','gmv_max_ads','paid_collabs','ai_content','strategy_moving_forward'] as const).map(sec => (
        <div key={sec}>
          <Card className="mb-4" data-section={sec}>
            <Card.Header className="d-flex justify-content-between align-items-center">
              <HeaderWithFeedback title={SECTION_LABELS[sec]} sectionId={sec} />
              <AutoSaveBadge />
            </Card.Header>
            <Card.Body>
              <RichTextEditor
                value={(c as any)[sec].body}
                onChange={html => setRich(sec, { body: html })}
                placeholder={`Write the ${SECTION_LABELS[sec]} narrative…`}
                minHeight={200}
              />
              <div className="mt-3">
                <Form.Label className="small">Image (optional)</Form.Label>
                <ImageInput value={(c as any)[sec].image_url}
                  onChange={url => setRich(sec, { image_url: url })}
                  brandId={brand.id} reportType="monthly"
                  placeholder="Upload an image for this section" />
              </div>
            </Card.Body>
          </Card>
          {renderCustomAt(sec)}
        </div>
      ))}

      {/* Approval Needed */}
      <Card className="mb-4" data-section="approval">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold">
            <i className="bi bi-shield-check me-2 text-warning" />
            Approval Needed / Action Items
          </span>
          <div className="d-flex align-items-center gap-2">
            <AutoSaveBadge />
            <FeedbackButton section="approval" />
            <Form.Check
              type="switch"
              id="approval-needed-toggle-monthly"
              checked={!!c.approval?.enabled}
              onChange={e => setC(prev => ({ ...prev, approval: { ...prev.approval, enabled: e.target.checked } }))}
              label={c.approval?.enabled ? 'On — client will see approval prompt' : 'Off'}
            />
          </div>
        </Card.Header>
        {c.approval?.enabled && (
          <Card.Body>
            <Form.Text className="text-muted d-block mb-2">
              The client will see this content in a popup before viewing the report. They can approve, request changes, and add comments.
            </Form.Text>
            <RichTextEditor
              value={c.approval?.content ?? ''}
              onChange={html => setC(prev => ({ ...prev, approval: { ...prev.approval, content: html } }))}
              placeholder="Describe what needs the client's approval this month…"
              minHeight={180}
            />
            <div className="mt-3 row g-2 align-items-end">
              <Form.Group className="col-md-5">
                <Form.Label className="small fw-semibold">Auto-popup expires at <span className="text-muted">(optional)</span></Form.Label>
                <Form.Control
                  type="datetime-local"
                  value={c.approval?.expires_at ? c.approval.expires_at.slice(0, 16) : ''}
                  onChange={e => setC(prev => ({
                    ...prev,
                    approval: {
                      ...prev.approval,
                      expires_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                    },
                  }))}
                />
              </Form.Group>
              <div className="col-md-7">
                <Form.Text className="text-muted">
                  After this date the popup stops auto-opening — but the client can still view the Approval Needed / Action Items card, submit a decision, and reply in the thread. Leave empty for no expiry.
                </Form.Text>
              </div>
            </div>
          </Card.Body>
        )}
      </Card>
      </div>

      <CustomSectionDefModal
        show={csModalOpen}
        onHide={() => setCsModalOpen(false)}
        initial={csDraft}
        onSave={saveCustomDef}
        isEdit={csIsEdit}
        hidePosition={!csIsEdit && csTargetIndex != null}
        key={csDraft.id}
      />

      <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            Notes / feedback
            {feedbackSection && <small className="text-muted ms-2 fw-normal">— {SECTION_LABELS[feedbackSection as string] ?? feedbackSection}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackSection && (
            <SectionComments
              section={feedbackSection}
              sectionLabel={SECTION_LABELS[feedbackSection as string]}
              comments={comments}
              mode="authed"
              currentAuthorName={profile?.full_name || profile?.email || 'User'}
              onAdd={(b, n, parentId) => addComment(feedbackSection, b, n, parentId)}
              canReply={profile?.role === 'bob'}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>

      <div className="d-flex justify-content-end gap-2 mb-4">
        <Button variant="outline-secondary" onClick={() => nav('/reporting/monthly')}>Cancel</Button>
        <Button variant="outline-primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
        <Button variant="primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
      </div>
    </div>
  );
}

// ---------- small row editors ----------
function CreatorRows({ rows, upd, del }: {
  rows: { username: string; gmv: number }[];
  upd: (i: number, patch: Partial<{ username: string; gmv: number }>) => void;
  del: (i: number) => void;
}) {
  if (rows.length === 0) return <p className="text-muted small mb-0">No rows yet.</p>;
  return (
    <Table size="sm" className="mb-0 align-middle">
      <thead><tr><th>Username</th><th className="text-end" style={{ width: 130 }}>GMV ($)</th><th style={{ width: 50 }}></th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td><Form.Control size="sm" value={r.username} onChange={e => upd(i, { username: e.target.value })} placeholder="creator handle" /></td>
            <td><NumberInput size="sm" step="0.01" value={r.gmv} onChange={n => upd(i, { gmv: n })} /></td>
            <td><Button size="sm" variant="outline-danger" onClick={() => del(i)}><i className="bi bi-trash" /></Button></td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function VideoRows({ rows, upd, del }: {
  rows: { username: string; video_url: string; gmv: number }[];
  upd: (i: number, patch: Partial<{ username: string; video_url: string; gmv: number }>) => void;
  del: (i: number) => void;
}) {
  if (rows.length === 0) return <p className="text-muted small mb-0">No rows yet.</p>;
  return (
    <Table size="sm" className="mb-0 align-middle">
      <thead><tr>
        <th>Creator / link text</th>
        <th>Video URL</th>
        <th className="text-end" style={{ width: 110 }}>GMV ($)</th>
        <th style={{ width: 50 }}></th>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td><Form.Control size="sm" value={r.username} onChange={e => upd(i, { username: e.target.value })} placeholder="creator handle" /></td>
            <td><Form.Control size="sm" value={r.video_url} onChange={e => upd(i, { video_url: e.target.value })} placeholder="https://www.tiktok.com/…" /></td>
            <td><NumberInput size="sm" step="0.01" value={r.gmv} onChange={n => upd(i, { gmv: n })} /></td>
            <td><Button size="sm" variant="outline-danger" onClick={() => del(i)}><i className="bi bi-trash" /></Button></td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
