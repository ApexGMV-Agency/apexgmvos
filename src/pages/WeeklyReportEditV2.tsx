import { useEffect, useMemo, useRef, useState, CSSProperties, FormEvent, Fragment } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Form, Button, Spinner, Alert, Badge, Modal, Offcanvas, Dropdown } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { formatRange } from '../lib/dates';
import { setReportCurrency } from '../lib/currency';
import {
  WeeklyReportContentV2, emptyContentV2, normalizeContentV2, numOrNull,
  WEEKLY_SECTIONS, SECTION_LABELS, SectionDef, emptyRow, emptyTarget,
  CustomSection, CustomField, CustomFieldType, StandardSectionIdV2,
} from '../lib/reportSchemaV2';
import { ScalarSectionBody, TableSectionBody } from '../components/report/SectionBody';
import NumField from '../components/NumField';
import SectionComments, { Comment, CommentSection } from '../components/SectionComments';
import { useAuth } from '../auth/AuthContext';
import { useEditLock } from '../lib/useEditLock';
import { useLiveReportContent } from '../lib/useLiveReportContent';
import EditLockBanner from '../components/EditLockBanner';
import RichTextEditor from '../components/RichTextEditor';
import { CustomSectionInline, CustomSectionDefModal, customSectionsAt, newSection, AddSectionMenu } from '../components/CustomSectionEditor';

// Standard-section render order (for placing a custom section above/below one).
const WEEKLY_STD_ORDER: StandardSectionIdV2[] = ['start', ...WEEKLY_SECTIONS.map(s => s.id), 'insights'];

// Anchor id -> label map for the custom-section Position picker (v2 sections).
const V2_POSITIONS: Record<string, string> = {
  start: 'At the very top',
  ...Object.fromEntries(WEEKLY_SECTIONS.map(s => [s.id, `After ${s.num}. ${s.title}`])),
  insights: 'After Insights (end)',
};
type ClickedSection =
  | { type: 'standard'; id: StandardSectionIdV2 }
  | { type: 'custom'; section: CustomSection };

interface ReportRow {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: any;
}
interface Brand { id: string; name: string; client: string; client_status: string | null; currency?: string | null; }

/** Hand-off freeze: long enough for the previous editor's final save to land. */
const HANDOFF_SETTLE_MS = 2000;

export default function WeeklyReportEdit() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile } = useAuth();
  // Collaborative edit lock — only one teammate edits a report at a time.
  const lock = useEditLock({
    kind: 'weekly',
    id,
    userId: profile?.id,
    name: profile?.full_name || profile?.email || 'A teammate',
    role: profile?.role,
    isSuperbob: profile?.is_superbob,
  });
  // True while we re-pull the latest content right after taking over editing.
  const [reloading, setReloading] = useState(false);
  const [report, setReport] = useState<ReportRow | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [c, setC] = useState<WeeklyReportContentV2>(emptyContentV2());
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showComments, setShowComments] = useState(false);
  const [priorReports, setPriorReports] = useState<ReportRow[]>([]);
  const [selectedPriorId, setSelectedPriorId] = useState<string>('');
  const [priorComments, setPriorComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  const [csModalOpen, setCsModalOpen] = useState(false);
  const [csDraft, setCsDraft] = useState<CustomSection>(newSection());
  const [csIsEdit, setCsIsEdit] = useState(false);
  const [csTargetIndex, setCsTargetIndex] = useState<number | null>(null);

  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);

  const [fetchingGmv, setFetchingGmv] = useState(false);
  const [gmvFetchMsg, setGmvFetchMsg] = useState<{ kind: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [fetchingProductGmv, setFetchingProductGmv] = useState(false);
  const [productGmvMsg, setProductGmvMsg] = useState<{ kind: 'success' | 'warning' | 'danger'; text: string } | null>(null);

  interface PresetRow {
    id: string; name: string; payload: any;
    kind: 'custom' | 'standard'; section_id: string | null;
    created_by: string | null; created_at: string;
  }
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [presetSavingId, setPresetSavingId] = useState<string | null>(null);
  const [presetMsg, setPresetMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!presetMsg) return;
    const t = setTimeout(() => setPresetMsg(null), 3500);
    return () => clearTimeout(t);
  }, [presetMsg]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('weekly_reports').select('*').eq('id', id).single();
      if (error) { setErr(error.message); setLoading(false); return; }
      const r = data as ReportRow;
      setReport(r);
      setC(normalizeContentV2(r.content));
      const { data: bd } = await supabase.from('brands').select('id,name,client,client_status,currency').eq('id', r.brand_id).single();
      setBrand(bd as Brand);
      const { data: priors } = await supabase.from('weekly_reports')
        .select('*').eq('brand_id', r.brand_id).lt('week_start', r.week_start)
        .order('week_start', { ascending: false }).limit(12);
      setPriorReports((priors as ReportRow[]) ?? []);
      if (priors && priors.length > 0) setSelectedPriorId((priors[0] as any).id);
      const { data: cm } = await supabase.from('report_comments')
        .select('*').eq('report_id', r.id).order('created_at', { ascending: true });
      setComments((cm as Comment[]) ?? []);
      const { data: pr } = await supabase.from('section_presets')
        .select('id,name,payload,kind,section_id,created_by,created_at').order('created_at', { ascending: false });
      setPresets(((pr as any[]) ?? []).map(p => ({
        ...p, kind: p.kind ?? 'custom', section_id: p.section_id ?? null,
      })) as PresetRow[]);
      setLoading(false);
    })();
  }, [id]);

  // ----- preset helpers (custom + standard) ---------------------------------
  const addCustomFromPreset = (preset: PresetRow) => {
    const p = preset.payload ?? {};
    const cs: CustomSection = {
      id: crypto.randomUUID(),
      name: String(p.name ?? preset.name ?? ''),
      description: String(p.description ?? ''),
      is_repeater: !!p.is_repeater,
      body: '',
      fields: Array.isArray(p.fields) ? p.fields.map((f: any) => ({
        id: crypto.randomUUID(), label: String(f.label ?? ''),
        type: f.type ?? 'text', options: Array.isArray(f.options) ? f.options : undefined,
      })) : [],
      rows: [],
      insert_after: p.insert_after ?? 'insights',
    };
    setC(prev => ({ ...prev, custom_sections: [...prev.custom_sections, cs] }));
    setPresetMsg(`Added "${cs.name}" from preset.`);
  };

  const addPresetSectionBelow = (clicked: CustomSection, preset: PresetRow) => {
    const p = preset.payload ?? {};
    const cs: CustomSection = {
      ...newSection(clicked.insert_after),
      name: String(p.name ?? preset.name ?? ''),
      description: String(p.description ?? ''),
      is_repeater: !!p.is_repeater,
      fields: Array.isArray(p.fields) ? p.fields.map((f: any): CustomField => ({
        id: crypto.randomUUID(), label: String(f.label ?? ''),
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

  const saveSectionAsPreset = async (s: CustomSection) => {
    const name = window.prompt('Save this section as a preset. Name:', s.name || 'Untitled section');
    if (!name) return;
    setPresetSavingId(s.id);
    const payload = {
      name: s.name, description: s.description, is_repeater: s.is_repeater,
      insert_after: s.insert_after, fields: s.fields.map(f => ({ label: f.label, type: f.type, options: f.options })),
    };
    const { data, error } = await supabase.from('section_presets')
      .insert({ name: name.trim(), payload, created_by: profile?.id ?? null }).select().single();
    setPresetSavingId(null);
    if (error) { alert(error.message); return; }
    setPresets(prev => [data as PresetRow, ...prev]);
    setPresetMsg(`Saved preset "${(data as PresetRow).name}".`);
  };

  const removePreset = async (p: PresetRow) => {
    if (!confirm(`Delete preset "${p.name}" from the shared library?`)) return;
    const prev = presets;
    setPresets(presets.filter(x => x.id !== p.id));
    const { error } = await supabase.from('section_presets').delete().eq('id', p.id);
    if (error) { alert(error.message); setPresets(prev); }
  };

  const customPresets: PresetRow[] = useMemo(() => presets.filter(p => p.kind === 'custom'), [presets]);
  const standardPresetsFor = (sectionId: string): PresetRow[] =>
    presets.filter(p => p.kind === 'standard' && p.section_id === sectionId);

  const applyStandardPreset = (sectionId: string, data: any) => {
    setC(prev => ({ ...prev, [sectionId]: data }));
    setPresetMsg(`Loaded preset into ${SECTION_LABELS[sectionId] ?? sectionId}.`);
  };

  const saveStandardPreset = async (sectionId: string) => {
    const sectionLabel = SECTION_LABELS[sectionId] ?? sectionId;
    const name = window.prompt(`Save "${sectionLabel}" as a preset. Name:`, `${brand?.name ?? ''} — ${sectionLabel}`.trim());
    if (!name) return;
    const data = (c as any)[sectionId];
    if (data == null) return;
    const { data: row, error } = await supabase.from('section_presets')
      .insert({ name: name.trim(), kind: 'standard', section_id: sectionId, payload: { data }, created_by: profile?.id ?? null })
      .select().single();
    if (error) { alert(error.message); return; }
    setPresets(prev => [row as PresetRow, ...prev]);
    setPresetMsg(`Saved preset "${(row as PresetRow).name}".`);
  };

  const addComment = async (section: CommentSection, body: string, _authorName: string, parentId?: string) => {
    if (!report) return;
    const { data, error } = await supabase.functions.invoke('post-staff-comment', {
      body: { report_id: report.id, section, body, parent_id: parentId ?? null },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
  };

  // ----- generic section setters --------------------------------------------
  const setSec = (sectionId: string, key: string, v: any) =>
    setC(prev => ({ ...prev, [sectionId]: { ...(prev as any)[sectionId], [key]: v } }));
  const addRow = (def: SectionDef) =>
    setC(prev => ({ ...prev, [def.id]: [...((prev as any)[def.id] as any[]), emptyRow(def)] }));
  const setCell = (sectionId: string, i: number, key: string, v: any) =>
    setC(prev => {
      const arr = [...((prev as any)[sectionId] as any[])];
      arr[i] = { ...arr[i], [key]: v };
      return { ...prev, [sectionId]: arr };
    });
  const delRow = (sectionId: string, i: number) =>
    setC(prev => {
      const arr = [...((prev as any)[sectionId] as any[])];
      arr.splice(i, 1);
      return { ...prev, [sectionId]: arr };
    });

  // ----- §14.7 targets setters ----------------------------------------------
  const addTarget = () => setC(prev => ({ ...prev, targets: [...prev.targets, emptyTarget()] }));
  const setTarget = (i: number, key: string, v: any) =>
    setC(prev => { const arr = [...prev.targets]; arr[i] = { ...arr[i], [key]: v }; return { ...prev, targets: arr }; });
  const delTarget = (i: number) =>
    setC(prev => { const arr = [...prev.targets]; arr.splice(i, 1); return { ...prev, targets: arr }; });

  // ----- GMV Max auto-fill for section 11.1 ---------------------------------
  const fetchGmvMaxFromBrand = async () => {
    if (!report) return;
    setFetchingGmv(true); setGmvFetchMsg(null);
    // Exact week match first (weekly reports line up 1:1 with GMV Max weeks).
    const { data: exact, error } = await supabase
      .from('brand_gmv_max_weekly').select('*')
      .eq('brand_id', report.brand_id).eq('week_start', report.week_start).maybeSingle();
    if (error) { setFetchingGmv(false); setGmvFetchMsg({ kind: 'danger', text: error.message }); return; }

    let adSpend: number | null = null, orders: number | null = null, gmv: number | null = null;
    let label = formatRange(report.week_start, report.week_end);
    if (exact) {
      adSpend = numOrNull((exact as any).ad_spend);
      orders = numOrNull((exact as any).orders);
      gmv = numOrNull((exact as any).gmv);
    } else {
      // Fall back to summing any GMV Max weeks overlapping this report's window
      // (covers bi-weekly windows that span two GMV Max weeks).
      const { data: overlap } = await supabase
        .from('brand_gmv_max_weekly').select('ad_spend,orders,gmv')
        .eq('brand_id', report.brand_id)
        .lte('week_start', report.week_end).gte('week_end', report.week_start);
      const rows = (overlap as any[]) ?? [];
      if (rows.length === 0) {
        setFetchingGmv(false);
        setGmvFetchMsg({ kind: 'warning', text: `No GMV Max entry exists for ${label} on this brand. Add it on the brand's GMV Max tab, or enter the numbers manually.` });
        return;
      }
      adSpend = rows.reduce((s, r) => s + (Number(r.ad_spend) || 0), 0);
      orders = rows.reduce((s, r) => s + (Number(r.orders) || 0), 0);
      gmv = rows.reduce((s, r) => s + (Number(r.gmv) || 0), 0);
      label += ` (${rows.length} GMV Max week${rows.length === 1 ? '' : 's'})`;
    }
    setFetchingGmv(false);
    setC(prev => ({
      ...prev,
      ad_overall: { ...prev.ad_overall, not_started: false, ad_spend: adSpend, total_orders_paid: orders, gmv_generated: gmv },
    }));
    setGmvFetchMsg({ kind: 'success', text: `Pulled GMV Max for ${label}. Don't forget to save.` });
  };

  // §11.2 — pull the per-product GMV Max breakdown for this report's week and
  // replace the Ad-Spend-by-Product table. Products live as child rows of the
  // brand's weekly GMV Max entry (brand_gmv_max_weekly_products): each brand
  // "focus product" plus a single "Other Products" catch-all. We match the week
  // exactly, else aggregate any GMV Max weeks overlapping the report window.
  const fetchProductGmvMaxFromBrand = async () => {
    if (!report) return;
    setFetchingProductGmv(true); setProductGmvMsg(null);
    let label = formatRange(report.week_start, report.week_end);

    // 1. Find the weekly GMV Max entr(ies) this report maps to.
    const { data: exact, error } = await supabase
      .from('brand_gmv_max_weekly').select('id')
      .eq('brand_id', report.brand_id).eq('week_start', report.week_start);
    if (error) { setFetchingProductGmv(false); setProductGmvMsg({ kind: 'danger', text: error.message }); return; }
    let weeklyIds = ((exact as any[]) ?? []).map(r => r.id);
    if (weeklyIds.length === 0) {
      const { data: overlap } = await supabase
        .from('brand_gmv_max_weekly').select('id')
        .eq('brand_id', report.brand_id)
        .lte('week_start', report.week_end).gte('week_end', report.week_start);
      weeklyIds = ((overlap as any[]) ?? []).map(r => r.id);
      if (weeklyIds.length > 0) label += ` (${weeklyIds.length} GMV Max week${weeklyIds.length === 1 ? '' : 's'})`;
    }
    if (weeklyIds.length === 0) {
      setFetchingProductGmv(false);
      setProductGmvMsg({ kind: 'warning', text: `No GMV Max entry exists for ${label} on this brand. Add it on the brand's GMV Max tab, or enter rows manually.` });
      return;
    }

    // 2. Product breakdown rows for those weeks + the brand's product catalogue.
    const [{ data: kids }, { data: prods }] = await Promise.all([
      supabase.from('brand_gmv_max_weekly_products').select('*').in('weekly_id', weeklyIds),
      supabase.from('brand_products').select('id,name,external_product_id').eq('brand_id', report.brand_id),
    ]);
    setFetchingProductGmv(false);
    const childRows = (kids as any[]) ?? [];
    if (childRows.length === 0) {
      setProductGmvMsg({ kind: 'warning', text: `No product-level GMV Max data for ${label} on this brand. Open the brand's GMV Max tab and fill the product breakdown, or enter rows manually.` });
      return;
    }
    const prodById = new Map(((prods as any[]) ?? []).map(p => [p.id, p]));

    // 3. Aggregate by product across the matched weeks (one report row per product).
    const agg = new Map<string, { product: string; product_id: string; spend: number; orders: number; gmv: number }>();
    for (const r of childRows) {
      const key = r.is_other ? '__other__' : String(r.product_id ?? '__unknown__');
      const prod = r.is_other ? null : prodById.get(r.product_id);
      const name = r.is_other ? 'Other Products' : (prod?.name ?? 'Unknown product');
      const extId = r.is_other ? '' : String(prod?.external_product_id ?? '');
      const cur = agg.get(key) ?? { product: name, product_id: extId, spend: 0, orders: 0, gmv: 0 };
      cur.spend  += Number(r.ad_spend) || 0;
      cur.orders += Number(r.orders) || 0;
      cur.gmv    += Number(r.gmv) || 0;
      agg.set(key, cur);
    }
    // Real products alphabetically; the "Other Products" catch-all always last.
    const adRows = Array.from(agg.values())
      .sort((a, b) =>
        a.product === 'Other Products' ? 1 : b.product === 'Other Products' ? -1 : a.product.localeCompare(b.product))
      .map(a => ({
        product: a.product,
        product_id: a.product_id,
        spend: numOrNull(a.spend),
        total_orders: numOrNull(a.orders),
        gmv_generated: numOrNull(a.gmv),
      }));
    setC(prev => ({ ...prev, ad_by_product: adRows }));
    setProductGmvMsg({ kind: 'success', text: `Pulled ${adRows.length} product row${adRows.length === 1 ? '' : 's'} from GMV Max for ${label}. Don't forget to save.` });
  };

  // Follow the current editor's autosaved changes live while locked out, so a
  // read-only viewer never has to reload to see the latest data. It stays on
  // through the hand-off freeze too, so whoever takes over arrives holding the
  // previous editor's final save instead of a stale snapshot.
  useLiveReportContent({
    table: 'weekly_reports',
    id,
    active: lock.isLockedOut || reloading,
    onContent: raw => {
      const normalized = normalizeContentV2(raw);
      setC(normalized);
    },
  });

  // Edit-lock hand-off. This editor has no autosave, so on LOSING control we
  // flush the current content once — otherwise the work done since the last
  // explicit Save would vanish when the next editor pulls the row. On GAINING
  // control we re-pull, so a Save here can't overwrite the previous editor.
  const latestContentRef = useRef(c);
  latestContentRef.current = c;
  const wasLockedOut = useRef(false);
  useEffect(() => {
    if (loading || !report) return;
    const nowLocked = lock.isLockedOut;
    if (nowLocked === wasLockedOut.current) return;   // no transition
    const gainedControl = !nowLocked && wasLockedOut.current;
    wasLockedOut.current = nowLocked;
    if (!gainedControl) {
      if (brand?.client_status !== 'closed') {
        void supabase.from('weekly_reports')
          .update({ content: latestContentRef.current }).eq('id', id);
      }
      return;
    }
    setReloading(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.from('weekly_reports').select('content').eq('id', id).single();
      if (!error && data) setC(normalizeContentV2(data.content));
      setReloading(false);
    }, HANDOFF_SETTLE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lock.isLockedOut]);

  const submit = async (e: FormEvent, status: 'draft' | 'submitted') => {
    e.preventDefault();
    if (brand?.client_status === 'closed') {
      setErr(`${brand.name} is inactive — reactivate the brand before saving changes.`);
      return;
    }
    if (lock.isLockedOut) {
      setErr(`${lock.editorName ?? 'Another teammate'} is currently editing this report. Request edit access to make changes.`);
      return;
    }
    if (reloading) return;   // mid hand-off — wait for the latest content to load
    setSaving(true); setErr(null);
    const update: Record<string, any> = { content: c, status };
    if (c.approval?.enabled) update.is_shared = true;
    const { error } = await supabase.from('weekly_reports').update(update).eq('id', id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    nav(`/reporting/weekly/${id}`);
  };

  const openCommentsModal = async () => {
    setShowComments(true);
    if (!selectedPriorId) return;
    await loadPriorComments(selectedPriorId);
  };
  const loadPriorComments = async (priorId: string) => {
    setLoadingComments(true);
    const { data } = await supabase.from('report_comments')
      .select('*').eq('report_id', priorId).order('created_at', { ascending: true });
    setPriorComments((data as Comment[]) ?? []);
    setLoadingComments(false);
  };
  const pullInComment = async (cm: Comment) => {
    if (!report || !profile) return;
    const priorLabel = priorReports.find(p => p.id === cm.report_id);
    const origDate = new Date(cm.created_at).toLocaleDateString();
    const quoted = cm.body.split('\n').map(l => `> ${l}`).join('\n');
    const body = `📌 Referenced from ${priorLabel ? `Week #${priorLabel.week_number}` : 'prior report'} — ${cm.author_name} (${origDate}):\n${quoted}`;
    try {
      await addComment(cm.section as CommentSection, body, profile.full_name || profile.email || 'User');
      setShowComments(false);
    } catch (e: any) { alert(e?.message ?? 'Failed to pull comment'); }
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err && !report) return <Alert variant="danger">{err}</Alert>;
  if (!report || !brand) return null;

  // Editor previews format money (e.g. §11 CPO auto cells) — set the brand
  // currency so a stale value from a previously-viewed dashboard doesn't leak in.
  setReportCurrency(brand.currency);
  const brandInactive = brand.client_status === 'closed';
  // Freeze the form body when another teammate holds the lock OR while we're
  // pulling the latest content right after taking over.
  const formFrozen = lock.isLockedOut || reloading;
  const lockStyle: CSSProperties | undefined = formFrozen
    ? { pointerEvents: 'none', opacity: 0.55, userSelect: 'none' }
    : undefined;
  const sectionFeedbackCount = (section: CommentSection) => comments.filter(c => c.section === section).length;

  const FeedbackButton = ({ section }: { section: CommentSection }) => {
    const n = sectionFeedbackCount(section);
    if (n === 0) return null;
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFeedbackSection(section); }}
        title="View client feedback">
        <i className="bi bi-chat-left-text" /><Badge bg="primary" pill>{n}</Badge>
      </Button>
    );
  };

  const StdPresetMenu = ({ sectionId }: { sectionId: string }) => {
    const list = standardPresetsFor(sectionId);
    return (
      <Dropdown align="end" onClick={(e) => e.stopPropagation()}>
        <Dropdown.Toggle size="sm" variant="outline-info" title="Save / load section preset">
          <i className="bi bi-bookmark" />
          {list.length > 0 && <Badge bg="info" pill className="ms-1">{list.length}</Badge>}
        </Dropdown.Toggle>
        <Dropdown.Menu style={{ minWidth: 260, maxHeight: 320, overflowY: 'auto' }}>
          <Dropdown.Item as="button" onClick={() => saveStandardPreset(sectionId)}>
            <i className="bi bi-bookmark-plus me-2" /> Save current as preset
          </Dropdown.Item>
          {list.length > 0 && <Dropdown.Divider />}
          {list.map(p => (
            <div key={p.id} className="d-flex align-items-center px-2 py-1" style={{ gap: 4 }}>
              <Dropdown.Item as="button" className="flex-grow-1 px-2 py-1"
                onClick={() => applyStandardPreset(sectionId, p.payload?.data)}>
                <div className="fw-semibold small">{p.name}</div>
                <small className="text-muted">{new Date(p.created_at).toLocaleDateString()}</small>
              </Dropdown.Item>
              {(p.created_by === profile?.id || profile?.role === 'bob') && (
                <Button size="sm" variant="link" className="text-danger p-0 px-2"
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); removePreset(p); }} title="Delete preset">
                  <i className="bi bi-trash" />
                </Button>
              )}
            </div>
          ))}
        </Dropdown.Menu>
      </Dropdown>
    );
  };

  const HeaderWithFeedback = ({ title, section, extra, sectionId }: {
    title: string; section: CommentSection; extra?: React.ReactNode; sectionId?: string;
  }) => (
    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
      <span className="fw-semibold">{title}</span>
      <div className="d-flex align-items-center gap-2">
        {extra}
        {sectionId && <StdPresetMenu sectionId={sectionId} />}
        <AddSectionMenu onPick={(pl) => openAddSectionRelative({ type: 'standard', id: section as StandardSectionIdV2 }, pl)} />
        <FeedbackButton section={section} />
      </div>
    </div>
  );

  // ----- custom section management ------------------------------------------
  const openAddCustom = () => { setCsDraft(newSection('insights')); setCsIsEdit(false); setCsTargetIndex(null); setCsModalOpen(true); };
  const openEditCustom = (s: CustomSection) => { setCsDraft({ ...s, fields: s.fields.map(f => ({ ...f })) }); setCsIsEdit(true); setCsModalOpen(true); };

  const openAddSectionRelative = (clicked: ClickedSection, placement: 'above' | 'below') => {
    const cs = c.custom_sections;
    let anchor: string;
    let index: number;
    if (clicked.type === 'custom') {
      anchor = clicked.section.insert_after;
      const idx = cs.findIndex(s => s.id === clicked.section.id);
      index = placement === 'below' ? idx + 1 : Math.max(0, idx);
    } else if (placement === 'below') {
      anchor = clicked.id;
      const firstIdx = cs.findIndex(s => s.insert_after === anchor);
      index = firstIdx === -1 ? cs.length : firstIdx;
    } else {
      const stdIdx = WEEKLY_STD_ORDER.indexOf(clicked.id);
      anchor = stdIdx > 0 ? WEEKLY_STD_ORDER[stdIdx - 1] : 'start';
      let lastIdx = -1;
      cs.forEach((s, i) => { if (s.insert_after === anchor) lastIdx = i; });
      index = lastIdx === -1 ? cs.length : lastIdx + 1;
    }
    setCsDraft(newSection(anchor));
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
  const removeCustom = (id: string) => {
    if (!confirm('Delete this custom section and all its data?')) return;
    setC(prev => ({ ...prev, custom_sections: prev.custom_sections.filter(s => s.id !== id) }));
  };
  const updateCustomData = (id: string, patch: Partial<CustomSection>) => {
    setC(prev => ({ ...prev, custom_sections: prev.custom_sections.map(s => s.id === id ? { ...s, ...patch } : s) }));
  };

  const renderCustomAt = (anchor: StandardSectionIdV2) =>
    customSectionsAt(c.custom_sections, anchor).map(s => (
      <CustomSectionInline
        key={s.id}
        section={s}
        onChange={(patch) => updateCustomData(s.id, patch)}
        onEditDef={() => openEditCustom(s)}
        onRemove={() => removeCustom(s.id)}
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
            <Button size="sm" variant="outline-info" disabled={presetSavingId === s.id}
              onClick={() => saveSectionAsPreset(s)} title="Save this section as a reusable preset">
              <i className="bi bi-bookmark-plus" />
            </Button>
            <FeedbackButton section={`cs:${s.id}` as CommentSection} />
          </>
        }
      />
    ));

  const customSectionLabel = (section: CommentSection): string | undefined => {
    if (!section.startsWith('cs:')) return undefined;
    const id = section.slice(3);
    return c.custom_sections.find(s => s.id === id)?.name;
  };
  const labelForFeedback = (section: CommentSection): string =>
    customSectionLabel(section) ?? SECTION_LABELS[section] ?? section;

  // ----- per-section body ----------------------------------------------------
  const renderSectionBody = (def: SectionDef) => {
    if (def.special === 'gmv_max') {
      const ao = c.ad_overall;
      const notStarted = !!ao.not_started;
      return (
        <>
          {gmvFetchMsg && (
            <Alert variant={gmvFetchMsg.kind} className="py-2 small mb-3" onClose={() => setGmvFetchMsg(null)} dismissible>
              {gmvFetchMsg.text}
            </Alert>
          )}
          <div className="d-flex flex-wrap gap-4 mb-3">
            <Form.Check type="switch" id="ao-not-started" label="No paid ads this period"
              checked={notStarted} onChange={e => setSec('ad_overall', 'not_started', e.target.checked)} />
            <Form.Check type="switch" id="ao-auto-fill" label="Auto-fill from GMV Max on this brand"
              checked={!!ao.auto_fill} disabled={notStarted}
              onChange={e => { setSec('ad_overall', 'auto_fill', e.target.checked); if (e.target.checked) fetchGmvMaxFromBrand(); }} />
          </div>
          {!notStarted && (
            <ScalarSectionBody def={def} data={ao} onField={(k, v) => setSec('ad_overall', k, v)} />
          )}
        </>
      );
    }
    if (def.kind === 'scalar') {
      return <ScalarSectionBody def={def} data={(c as any)[def.id]} onField={(k, v) => setSec(def.id, k, v)} />;
    }
    // §11.2 — Ad Spend by Product, with a "Pull from GMV Max" auto-fill.
    if (def.special === 'product_gmv_max') {
      return (
        <>
          <div className="d-flex justify-content-end mb-2">
            <Button size="sm" variant="outline-info" disabled={fetchingProductGmv} onClick={fetchProductGmvMaxFromBrand}
              title={`Pull per-product spend from the brand's GMV Max page for ${formatRange(report.week_start, report.week_end)}`}>
              <i className="bi bi-cloud-download me-1" />{fetchingProductGmv ? 'Fetching…' : 'Pull from GMV Max'}
            </Button>
          </div>
          {productGmvMsg && (
            <Alert variant={productGmvMsg.kind} className="py-2 small mb-3" onClose={() => setProductGmvMsg(null)} dismissible>
              {productGmvMsg.text}
            </Alert>
          )}
          <TableSectionBody
            def={def}
            rows={(c as any)[def.id]}
            onCell={(i, k, v) => setCell(def.id, i, k, v)}
            onAddRow={() => addRow(def)}
            onDelRow={(i) => delRow(def.id, i)}
          />
        </>
      );
    }
    // table / fixed
    return (
      <TableSectionBody
        def={def}
        rows={(c as any)[def.id]}
        fixed={def.kind === 'fixed'}
        onCell={(i, k, v) => setCell(def.id, i, k, v)}
        onAddRow={() => addRow(def)}
        onDelRow={(i) => delRow(def.id, i)}
      />
    );
  };

  return (
    <div className="ac-themed">
      {brandInactive && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill" />
          <div><strong>{brand.name} is inactive.</strong>{' '}You can review the data but Save is disabled until the brand is reactivated.</div>
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
            Week #{report.week_number} · {formatRange(report.week_start, report.week_end)}
            <Badge bg={report.status === 'draft' ? 'secondary' : 'success'} className="ms-2">{report.status}</Badge>
            {lock.ready && lock.othersCount > 0 && lock.isOwner && (
              <Badge bg="success" className="ms-2">
                <i className="bi bi-pencil-fill me-1" />You have control · {lock.othersCount} watching
              </Badge>
            )}
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          {priorReports.length > 0 && (
            <Button variant="outline-info" onClick={openCommentsModal}>
              <i className="bi bi-chat-left-text me-1" /> Load previous comments
            </Button>
          )}
          <Dropdown>
            <Dropdown.Toggle variant="outline-info" title="Insert a saved custom-section preset">
              <i className="bi bi-bookmark me-1" /> Add from preset
              {customPresets.length > 0 && <Badge bg="info" pill className="ms-1">{customPresets.length}</Badge>}
            </Dropdown.Toggle>
            <Dropdown.Menu align="end" style={{ minWidth: 280, maxHeight: 320, overflowY: 'auto' }}>
              {customPresets.length === 0 ? (
                <Dropdown.ItemText className="text-muted small">No saved custom-section presets yet.</Dropdown.ItemText>
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
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); removePreset(p); }} title="Delete preset">
                      <i className="bi bi-trash" />
                    </Button>
                  )}
                </div>
              ))}
            </Dropdown.Menu>
          </Dropdown>
          <Button variant="outline-success" onClick={openAddCustom}>
            <i className="bi bi-plus-square me-1" /> Add custom section
          </Button>
          <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
          <Button variant="outline-primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
          <Button variant="primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}
      {presetMsg && <Alert variant="info" className="py-2 small" dismissible onClose={() => setPresetMsg(null)}>{presetMsg}</Alert>}

      <div style={lockStyle} aria-disabled={formFrozen}>
      {renderCustomAt('start')}

      {/* All 14 standard sections, registry-driven */}
      {WEEKLY_SECTIONS.map(def => (
        <Fragment key={def.id}>
          {def.derived ? (
            <Card className="mb-4 border-0" data-section={def.id} style={{ background: '#f8fafc' }}>
              <Card.Body className="py-3 d-flex align-items-center gap-2">
                <i className="bi bi-magic text-primary" />
                <div className="small">
                  <span className="fw-semibold">{def.num}. {def.title}</span>
                  <span className="text-muted ms-2">{def.derivedNote ?? 'Auto-generated — no input needed.'}</span>
                </div>
              </Card.Body>
            </Card>
          ) : (
            <Card className="mb-4" data-section={def.id}>
              <Card.Header>
                <HeaderWithFeedback title={`${def.num}. ${def.title}`} section={def.id} sectionId={def.id} />
              </Card.Header>
              <Card.Body>
                {def.blurb && <p className="text-muted small mb-3">{def.blurb}</p>}
                {renderSectionBody(def)}
              </Card.Body>
            </Card>
          )}
          {renderCustomAt(def.id)}
        </Fragment>
      ))}

      {/* §14.7 Weekly Targets & Action Items — the only manual part of Section 14.
          Section 14.1–14.6 are auto-generated for the client from the data above. */}
      <Card className="mb-4" data-section="targets">
        <Card.Header>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="fw-semibold">14.7 Weekly Targets &amp; Action Items <span className="badge bg-light text-secondary border ms-1">optional</span></span>
            <Button size="sm" variant="outline-primary" onClick={addTarget}><i className="bi bi-plus-lg me-1" />Add target</Button>
          </div>
        </Card.Header>
        <Card.Body>
          <p className="text-muted small mb-3">
            <i className="bi bi-info-circle me-1" />
            Sections 14.1–14.6 of the client dashboard are calculated automatically from the data above. Add targets here only if you want a client-facing progress tracker — leave it empty to skip it.
          </p>
          {c.targets.length === 0 ? (
            <p className="text-muted small mb-0">No targets — the client dashboard will show 14.1–14.6 only.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead><tr>
                  <th>Objective</th><th style={{ width: 110 }}>Unit</th>
                  <th style={{ width: 120 }}>Target</th><th style={{ width: 120 }}>Actual</th>
                  <th style={{ width: 120 }}>Lower is better</th><th>Owner / next step</th><th style={{ width: 44 }} />
                </tr></thead>
                <tbody>
                  {c.targets.map((t, i) => (
                    <tr key={i}>
                      <td><Form.Control size="sm" value={t.objective} onChange={e => setTarget(i, 'objective', e.target.value)} placeholder="e.g. Hit $50k GMV" /></td>
                      <td>
                        <Form.Select size="sm" value={t.unit} onChange={e => setTarget(i, 'unit', e.target.value)}>
                          <option value="currency">$ currency</option>
                          <option value="number">number</option>
                          <option value="percent">% percent</option>
                          <option value="ratio">x ratio</option>
                        </Form.Select>
                      </td>
                      <td><NumField size="sm" value={t.target} onChange={n => setTarget(i, 'target', n)} /></td>
                      <td><NumField size="sm" value={t.actual} onChange={n => setTarget(i, 'actual', n)} /></td>
                      <td className="text-center"><Form.Check type="switch" checked={t.lower_is_better} onChange={e => setTarget(i, 'lower_is_better', e.target.checked)} /></td>
                      <td><Form.Control size="sm" value={t.owner} onChange={e => setTarget(i, 'owner', e.target.value)} placeholder="Owner" /></td>
                      <td><Button size="sm" variant="outline-danger" onClick={() => delTarget(i)}><i className="bi bi-trash" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Insights — single advanced rich-text block (dividers built in) */}
      <Card className="mb-4" data-section="insights">
        <Card.Header><HeaderWithFeedback title="Insights" section="insights" sectionId="insights" /></Card.Header>
        <Card.Body>
          <Form.Text className="text-muted d-block mb-2">
            Write all your insights here. Use the <strong>Divider</strong> button to separate topics — pick its thickness, colour and style.
          </Form.Text>
          <RichTextEditor
            value={c.insights.summary}
            onChange={html => setC(prev => ({ ...prev, insights: { summary: html } }))}
            placeholder="Write your insights for this week…"
            minHeight={240}
          />
        </Card.Body>
      </Card>
      {renderCustomAt('insights')}

      {/* Approval Needed (optional) */}
      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold"><i className="bi bi-shield-check me-2 text-warning" />Approval Needed / Action Items</span>
          <Form.Check type="switch" id="approval-needed-toggle"
            checked={!!c.approval?.enabled}
            onChange={e => setC(prev => ({ ...prev, approval: { ...prev.approval, enabled: e.target.checked } }))}
            label={c.approval?.enabled ? 'On — client will see approval prompt' : 'Off'} />
        </Card.Header>
        {c.approval?.enabled && (
          <Card.Body>
            <Form.Text className="text-muted d-block mb-2">
              The client will see this content in a prompt before viewing the report. They can approve, request changes, and add a comment.
            </Form.Text>
            <RichTextEditor
              value={c.approval?.content ?? ''}
              onChange={html => setC(prev => ({ ...prev, approval: { ...prev.approval, content: html } }))}
              placeholder="Describe what needs the client's approval this week…"
              minHeight={180}
            />
            <div className="mt-3 row g-2 align-items-end">
              <Form.Group className="col-md-5">
                <Form.Label className="small fw-semibold">Auto-popup expires at <span className="text-muted">(optional)</span></Form.Label>
                <Form.Control type="datetime-local"
                  value={c.approval?.expires_at ? c.approval.expires_at.slice(0, 16) : ''}
                  onChange={e => setC(prev => ({
                    ...prev,
                    approval: { ...prev.approval, expires_at: e.target.value ? new Date(e.target.value).toISOString() : null },
                  }))} />
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
        show={csModalOpen} onHide={() => setCsModalOpen(false)} initial={csDraft}
        onSave={saveCustomDef} isEdit={csIsEdit} positions={V2_POSITIONS}
        hidePosition={!csIsEdit && csTargetIndex != null} key={csDraft.id}
      />

      <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />Client feedback
            {feedbackSection && <small className="text-muted ms-2 fw-normal">— {labelForFeedback(feedbackSection)}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackSection && (
            <SectionComments
              section={feedbackSection} sectionLabel={labelForFeedback(feedbackSection)}
              comments={comments} mode="authed"
              currentAuthorName={profile?.full_name || profile?.email || 'User'}
              onAdd={(b, n, parentId) => addComment(feedbackSection, b, n, parentId)}
              canReply={profile?.role === 'bob'}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>

      <div className="d-flex justify-content-end gap-2 mb-4">
        <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
        <Button variant="outline-primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
        <Button variant="primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
      </div>

      <Modal show={showComments} onHide={() => setShowComments(false)} centered size="lg" scrollable>
        <Modal.Header closeButton><Modal.Title>Previous comments — reference</Modal.Title></Modal.Header>
        <Modal.Body>
          {priorReports.length === 0 ? (
            <p className="text-muted mb-0">No previous reports for this brand.</p>
          ) : (
            <>
              <Form.Group className="mb-3">
                <Form.Label className="small">Choose a report</Form.Label>
                <Form.Select value={selectedPriorId} onChange={e => { setSelectedPriorId(e.target.value); loadPriorComments(e.target.value); }}>
                  {priorReports.map(p => (
                    <option key={p.id} value={p.id}>Week #{p.week_number} — {formatRange(p.week_start, p.week_end)}</option>
                  ))}
                </Form.Select>
              </Form.Group>
              {loadingComments ? (
                <div className="text-center py-4"><Spinner animation="border" size="sm" /></div>
              ) : priorComments.length === 0 ? (
                <p className="text-muted text-center py-3 mb-0">No comments on this report.</p>
              ) : (
                Object.keys(SECTION_LABELS).map(section => {
                  const sc = priorComments.filter(x => x.section === section);
                  if (sc.length === 0) return null;
                  return (
                    <div key={section} className="mb-3">
                      <h6 className="text-muted">{SECTION_LABELS[section]}</h6>
                      {sc.map(cm => (
                        <div key={cm.id} className="p-2 mb-2 rounded small" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                          <div className="d-flex align-items-center gap-2 mb-1">
                            <strong>{cm.author_name}</strong>
                            <Badge bg={cm.author_type === 'client' ? 'info' : cm.author_type === 'bob' ? 'warning' : 'success'} text={cm.author_type === 'bob' ? 'dark' : undefined}>
                              {cm.author_type === 'client' ? 'Client' : cm.author_type === 'bob' ? 'Bob' : 'APC'}
                            </Badge>
                            <span className="text-muted">{new Date(cm.created_at).toLocaleDateString()}</span>
                            <Button size="sm" variant="outline-primary" className="ms-auto py-0 px-2" style={{ fontSize: '.75rem' }}
                              onClick={() => pullInComment(cm)} title="Copy this comment into the current report for reference">
                              <i className="bi bi-pin-angle me-1" /> Pull into this report
                            </Button>
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{cm.body}</div>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setShowComments(false)}>Close</Button></Modal.Footer>
      </Modal>
    </div>
  );
}
