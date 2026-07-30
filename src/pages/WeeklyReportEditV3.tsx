import { useEffect, useMemo, useRef, useState, CSSProperties, FormEvent, Fragment } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Form, Button, Spinner, Alert, Badge, Modal, Offcanvas, Dropdown, Accordion } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { formatRange } from '../lib/dates';
import { sanitizeRich } from '../lib/sanitize';
import { setReportCurrency } from '../lib/currency';
import {
  WeeklyReportContentV3, emptyContentV3, normalizeContentV3, numOrNull,
  WEEKLY_SECTIONS_V3, SECTION_LABELS_V3, SectionDefV3, emptyRow,
  CustomSection, CustomField, CustomFieldType, StandardSectionIdV3,
} from '../lib/reportSchemaV3';
import { ScalarSectionBodyV3, TableSectionBodyV3 } from '../components/report/SectionBodyV3';
import VideoPasteBar from '../components/report/VideoPasteBar';
import SectionComments, { Comment, CommentSection } from '../components/SectionComments';
import { useAuth } from '../auth/AuthContext';
import { useEditLock } from '../lib/useEditLock';
import { useLiveReportContent } from '../lib/useLiveReportContent';
import EditLockBanner from '../components/EditLockBanner';
import RichTextEditor from '../components/RichTextEditor';
import { CustomSectionInline, CustomSectionDefModal, customSectionsAt, newSection, AddSectionMenu } from '../components/CustomSectionEditor';

// Standard-section render order (for placing a custom section above/below one).
const WEEKLY_STD_ORDER_V3: StandardSectionIdV3[] = ['start', ...WEEKLY_SECTIONS_V3.map(s => s.id), 'insights'];

// Anchor id -> label for the custom-section Position picker (v3 sections).
const V3_POSITIONS: Record<string, string> = {
  start: 'At the very top',
  ...Object.fromEntries(WEEKLY_SECTIONS_V3.map(s => [s.id, `After ${s.num}. ${s.title}`])),
  insights: 'After Insights (end)',
};
type ClickedSection =
  | { type: 'standard'; id: StandardSectionIdV3 }
  | { type: 'custom'; section: CustomSection };

interface ReportRow {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: any;
}
interface Brand { id: string; name: string; client: string; client_status: string | null; currency?: string | null; }
type Msg = { kind: 'success' | 'warning' | 'danger'; text: string } | null;

/** Hand-off freeze: long enough for the previous editor's final save to land. */
const HANDOFF_SETTLE_MS = 2000;

export default function WeeklyReportEditV3() {
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
  const [c, setC] = useState<WeeklyReportContentV3>(emptyContentV3());
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Autosave: silently persist content (never status) after a short idle.
  const lastSavedContent = useRef<string | null>(null);
  const [autoSave, setAutoSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

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

  // Auto-fetch UI state (one per AUTO section) — all manual, button-driven.
  const [fetchingSampling, setFetchingSampling] = useState(false);
  const [samplingMsg, setSamplingMsg] = useState<Msg>(null);
  const [fetchingScore, setFetchingScore] = useState(false);
  const [scoreMsg, setScoreMsg] = useState<Msg>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productsMsg, setProductsMsg] = useState<Msg>(null);
  const [fetchingGmv, setFetchingGmv] = useState(false);
  const [gmvMsg, setGmvMsg] = useState<Msg>(null);
  const [fetchingLive, setFetchingLive] = useState(false);
  const [liveMsg, setLiveMsg] = useState<Msg>(null);

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
      const normalized = normalizeContentV3(r.content);
      setC(normalized);
      lastSavedContent.current = JSON.stringify(normalized);   // autosave baseline
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

  // ----- autosave: debounced, content-only (status is left untouched) --------
  //  Writes are serialized through savingRef so a slow earlier write can never
  //  land after a newer one (out-of-order = silent stale persistence). Reads go
  //  through refs so the in-flight write always persists the latest content.
  const contentKey = JSON.stringify(c);
  const latestContentRef = useRef(c);
  latestContentRef.current = c;
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const runAutosave = async () => {
    if (savingRef.current || !mountedRef.current) return;      // one write at a time
    if (brand?.client_status === 'closed') return;
    if (lockRef.current.isLockedOut || lockRef.current.reloading) return;   // read-only / mid hand-off
    const snap = JSON.stringify(latestContentRef.current);
    if (snap === lastSavedContent.current) return;             // nothing new
    savingRef.current = true;
    setAutoSave('saving');
    const { error } = await supabase.from('weekly_reports').update({ content: latestContentRef.current }).eq('id', id);
    savingRef.current = false;
    if (!mountedRef.current) return;
    if (error) { setAutoSave('error'); return; }
    lastSavedContent.current = snap;
    setAutoSave('saved');
    // content edited while the write was in flight → save the newer content next
    if (JSON.stringify(latestContentRef.current) !== lastSavedContent.current) void runAutosave();
  };

  useEffect(() => {
    if (loading || !report || lastSavedContent.current === null) return;   // not until first load
    if (brand?.client_status === 'closed') return;                          // inactive brand
    if (contentKey === lastSavedContent.current) return;                    // nothing changed
    if (lock.isLockedOut || reloading) return;      // never write from a read-only view
    const t = setTimeout(() => void runAutosave(), 1200);
    return () => clearTimeout(t);   // debounce: cancel the not-yet-fired timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, lock.isLockedOut, reloading]);

  // Follow the current editor's autosaved changes live while locked out, so a
  // read-only viewer never has to reload to see the latest data. It stays on
  // through the hand-off freeze too, so whoever takes over arrives holding the
  // previous editor's final save instead of a stale snapshot.
  useLiveReportContent({
    table: 'weekly_reports',
    id,
    active: lock.isLockedOut || reloading,
    onContent: raw => {
      const normalized = normalizeContentV3(raw);
      setC(normalized);
      lastSavedContent.current = JSON.stringify(normalized);
    },
  });

  // Edit-lock hand-off. Flush our newest edits the instant we LOSE control so
  // the next editor continues from them, and re-pull the latest content when we
  // GAIN it, briefly freezing the form so typing can't clobber the swap.
  const lockRef = useRef({ isLockedOut: false, reloading: false });
  lockRef.current = { isLockedOut: lock.isLockedOut, reloading };
  const wasLockedOut = useRef(false);
  useEffect(() => {
    if (loading || !report) return;
    const nowLocked = lock.isLockedOut;
    if (nowLocked === wasLockedOut.current) return;   // no transition
    const lostControl = nowLocked && !wasLockedOut.current;
    wasLockedOut.current = nowLocked;

    if (lostControl) {
      if (brand?.client_status === 'closed') return;
      const snapshot = latestContentRef.current;
      void supabase.from('weekly_reports').update({ content: snapshot }).eq('id', id)
        .then(({ error }) => { if (!error) lastSavedContent.current = JSON.stringify(snapshot); });
    } else {
      setReloading(true);
      const t = setTimeout(async () => {
        const { data, error } = await supabase.from('weekly_reports').select('content').eq('id', id).single();
        if (!error && data) {
          const normalized = normalizeContentV3(data.content);
          setC(normalized);
          lastSavedContent.current = JSON.stringify(normalized);
          setAutoSave('idle');
        }
        setReloading(false);
      }, HANDOFF_SETTLE_MS);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lock.isLockedOut]);

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
  // Standard presets share one library across formats; v3 sections have their
  // own field shapes, so namespace v3 standard presets ("v3:<id>") to keep them
  // from clashing with a same-named v2/classic section.
  const stdKey = (sectionId: string) => `v3:${sectionId}`;
  const standardPresetsFor = (sectionId: string): PresetRow[] =>
    presets.filter(p => p.kind === 'standard' && p.section_id === stdKey(sectionId));

  const applyStandardPreset = (sectionId: string, data: any) => {
    setC(prev => ({ ...prev, [sectionId]: data }));
    setPresetMsg(`Loaded preset into ${SECTION_LABELS_V3[sectionId] ?? sectionId}.`);
  };

  const saveStandardPreset = async (sectionId: string) => {
    const sectionLabel = SECTION_LABELS_V3[sectionId] ?? sectionId;
    const name = window.prompt(`Save "${sectionLabel}" as a preset. Name:`, `${brand?.name ?? ''} — ${sectionLabel}`.trim());
    if (!name) return;
    const data = (c as any)[sectionId];
    if (data == null) return;
    const { data: row, error } = await supabase.from('section_presets')
      .insert({ name: name.trim(), kind: 'standard', section_id: stdKey(sectionId), payload: { data }, created_by: profile?.id ?? null })
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
  const addRow = (def: SectionDefV3) =>
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

  // ----- §1 Sampling & Videos — pull from the brand's Sample-Seeding page ----
  const fetchSamplingFromBrand = async () => {
    if (!report) return;
    setFetchingSampling(true); setSamplingMsg(null);
    const label = formatRange(report.week_start, report.week_end);
    const { data, error } = await supabase
      .from('brand_samples_daily')
      .select('entry_date,new_videos,others_count,product_counts')
      .eq('brand_id', report.brand_id)
      .gte('entry_date', report.week_start)
      .lte('entry_date', report.week_end);
    setFetchingSampling(false);
    if (error) { setSamplingMsg({ kind: 'danger', text: error.message }); return; }
    const rows = (data as any[]) ?? [];
    if (rows.length === 0) {
      setSamplingMsg({ kind: 'warning', text: `No Sample-Seeding data for ${label} on this brand. Fill it on the brand's Sample Seeding tab, or enter the numbers manually here.` });
      return;
    }
    const approved = rows.reduce((s, d) =>
      s + Object.values(d.product_counts ?? {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0)
        + (Number(d.others_count) || 0), 0);
    const videos = rows.reduce((s, d) => s + (Number(d.new_videos) || 0), 0);
    setC(prev => ({ ...prev, sampling: { ...prev.sampling, samples_approved: approved, new_videos_posted: videos } }));
    setSamplingMsg({ kind: 'success', text: `Pulled ${approved} approved sample${approved === 1 ? '' : 's'} and ${videos} new video${videos === 1 ? '' : 's'} for ${label}. Don't forget to save.` });
  };

  // ----- §2 Shop Performance Score — weekly avg SPS from the Sample-Seeding page.
  //  Mirrors the "Avg SPS" the Sample Seeding tab shows: the mean of the week's
  //  logged daily SPS values (weekend rows carry no SPS, so filtering non-null
  //  already excludes them). Only fills Shop Performance Score — every other
  //  Overall metric (GMV, orders, Shop Ranking, …) stays manual.
  const fetchShopScoreFromBrand = async () => {
    if (!report) return;
    setFetchingScore(true); setScoreMsg(null);
    const label = formatRange(report.week_start, report.week_end);
    const { data, error } = await supabase
      .from('brand_samples_daily')
      .select('entry_date,daily_sps')
      .eq('brand_id', report.brand_id)
      .gte('entry_date', report.week_start)
      .lte('entry_date', report.week_end);
    setFetchingScore(false);
    if (error) { setScoreMsg({ kind: 'danger', text: error.message }); return; }
    const vals = ((data as any[]) ?? [])
      .map(d => d.daily_sps)
      .filter((n: any) => n != null)
      .map(Number)
      .filter((n: number) => Number.isFinite(n));
    if (vals.length === 0) {
      setScoreMsg({ kind: 'warning', text: `No daily SPS logged for ${label} on this brand's Sample Seeding page. Enter the Shop Performance Score manually here.` });
      return;
    }
    const avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    setC(prev => ({ ...prev, overall: { ...prev.overall, shop_performance_score: avg } }));
    setScoreMsg({ kind: 'success', text: `Set Shop Performance Score to ${avg.toFixed(1)} — the average of ${vals.length} daily SPS entr${vals.length === 1 ? 'y' : 'ies'} for ${label}. Don't forget to save.` });
  };

  // ----- §8 LIVE Sessions — sum this week's daily live_sessions from Sample Seeding
  const fetchLiveSessionsFromBrand = async () => {
    if (!report) return;
    setFetchingLive(true); setLiveMsg(null);
    const label = formatRange(report.week_start, report.week_end);
    const { data, error } = await supabase
      .from('brand_samples_daily')
      .select('entry_date,live_sessions')
      .eq('brand_id', report.brand_id)
      .gte('entry_date', report.week_start)
      .lte('entry_date', report.week_end);
    setFetchingLive(false);
    if (error) { setLiveMsg({ kind: 'danger', text: error.message }); return; }
    const rows = (data as any[]) ?? [];
    const logged = rows.filter(d => d.live_sessions != null);
    if (logged.length === 0) {
      setLiveMsg({ kind: 'warning', text: `No daily LIVE sessions logged for ${label} on this brand's Sample Seeding page. Enter LIVE Sessions manually here.` });
      return;
    }
    const total = logged.reduce((s, d) => s + (Number(d.live_sessions) || 0), 0);
    setC(prev => ({ ...prev, affiliate: { ...prev.affiliate, live_sessions: total } }));
    setLiveMsg({ kind: 'success', text: `Set LIVE Sessions to ${total} — the sum of ${logged.length} day${logged.length === 1 ? '' : 's'} logged for ${label}. Don't forget to save.` });
  };

  // ----- §3 Product Analytics — load the brand's product catalogue into rows --
  const loadProductsIntoAnalytics = async () => {
    if (!report) return;
    setLoadingProducts(true); setProductsMsg(null);
    const { data, error } = await supabase
      .from('brand_products').select('id,name,external_product_id')
      .eq('brand_id', report.brand_id).order('name');
    setLoadingProducts(false);
    if (error) { setProductsMsg({ kind: 'danger', text: error.message }); return; }
    const prods = (data as any[]) ?? [];
    if (prods.length === 0) {
      setProductsMsg({ kind: 'warning', text: 'No products found for this brand. Add them on the brand’s Products tab, or add rows manually here.' });
      return;
    }
    setC(prev => {
      // Preserve any metrics already typed, matched by product name.
      const existing = new Map((prev.product_analytics as any[]).map(r => [String(r.product ?? ''), r]));
      const base = emptyRow(WEEKLY_SECTIONS_V3.find(s => s.id === 'product_analytics')!);
      const rows = prods.map(p => ({
        ...base,
        ...(existing.get(String(p.name)) ?? {}),
        product: String(p.name ?? ''),
        product_id: String(p.external_product_id ?? ''),
      }));
      return { ...prev, product_analytics: rows };
    });
    setProductsMsg({ kind: 'success', text: `Loaded ${prods.length} product${prods.length === 1 ? '' : 's'}. Fill each row’s metrics, then save.` });
  };

  // ----- §12 GMV Max — pull per-product ad spend from the brand's GMV Max page.
  const fetchGmvMaxProduct = async () => {
    if (!report) return;
    setFetchingGmv(true); setGmvMsg(null);
    let label = formatRange(report.week_start, report.week_end);
    const { data: exact, error } = await supabase
      .from('brand_gmv_max_weekly').select('id')
      .eq('brand_id', report.brand_id).eq('week_start', report.week_start);
    if (error) { setFetchingGmv(false); setGmvMsg({ kind: 'danger', text: error.message }); return; }
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
      setFetchingGmv(false);
      setGmvMsg({ kind: 'warning', text: `No GMV Max data for ${label} on this brand. Add it on the brand's GMV Max tab, or enter rows manually here.` });
      return;
    }
    const [{ data: kids }, { data: prods }] = await Promise.all([
      supabase.from('brand_gmv_max_weekly_products').select('*').in('weekly_id', weeklyIds),
      supabase.from('brand_products').select('id,name,external_product_id').eq('brand_id', report.brand_id),
    ]);
    setFetchingGmv(false);
    const childRows = (kids as any[]) ?? [];
    if (childRows.length === 0) {
      setGmvMsg({ kind: 'warning', text: `No product-level GMV Max data for ${label} on this brand. Open the brand's GMV Max tab and fill the product breakdown, or enter rows manually here.` });
      return;
    }
    const prodById = new Map(((prods as any[]) ?? []).map(p => [p.id, p]));
    const agg = new Map<string, { product: string; product_id: string; cost: number; orders: number; gmv: number }>();
    for (const r of childRows) {
      const key = r.is_other ? '__other__' : String(r.product_id ?? '__unknown__');
      const prod = r.is_other ? null : prodById.get(r.product_id);
      const name = r.is_other ? 'Other Products' : (prod?.name ?? 'Unknown product');
      const extId = r.is_other ? '' : String(prod?.external_product_id ?? '');
      const cur = agg.get(key) ?? { product: name, product_id: extId, cost: 0, orders: 0, gmv: 0 };
      cur.cost   += Number(r.ad_spend) || 0;
      cur.orders += Number(r.orders) || 0;
      cur.gmv    += Number(r.gmv) || 0;
      agg.set(key, cur);
    }
    const rows = Array.from(agg.values())
      .sort((a, b) =>
        a.product === 'Other Products' ? 1 : b.product === 'Other Products' ? -1 : a.product.localeCompare(b.product))
      .map(a => ({
        product: a.product,
        product_id: a.product_id,
        cost: numOrNull(a.cost),
        sku_orders: numOrNull(a.orders),
        gross_revenue: numOrNull(a.gmv),
      }));
    setC(prev => ({ ...prev, gmv_max: rows }));
    setGmvMsg({ kind: 'success', text: `Pulled ${rows.length} product row${rows.length === 1 ? '' : 's'} from GMV Max for ${label}. Don't forget to save.` });
  };

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

  // Editor previews format money too — set the brand currency so a stale value
  // from a previously-viewed dashboard doesn't leak into this brand's preview.
  setReportCurrency(brand.currency);
  const brandInactive = brand.client_status === 'closed';
  // Freeze the form body when another teammate holds the lock OR while we're
  // pulling the latest content right after taking over.
  const formFrozen = lock.isLockedOut || reloading;
  const lockStyle: CSSProperties | undefined = formFrozen
    ? { pointerEvents: 'none', opacity: 0.55, userSelect: 'none' }
    : undefined;
  const autoSaveBadge = autoSave === 'idle' ? null : (
    <span className={`small d-inline-flex align-items-center me-2 ${autoSave === 'error' ? 'text-danger' : 'text-muted'}`}>
      {autoSave === 'saving' && <><Spinner animation="border" size="sm" className="me-1" style={{ width: 13, height: 13 }} />Saving…</>}
      {autoSave === 'saved' && <><i className="bi bi-check-circle-fill text-success me-1" />Saved</>}
      {autoSave === 'error' && <><i className="bi bi-exclamation-triangle-fill me-1" />Autosave failed</>}
    </span>
  );
  const sectionFeedbackCount = (section: CommentSection) => comments.filter(x => x.section === section).length;

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
      const stdIdx = WEEKLY_STD_ORDER_V3.indexOf(clicked.id);
      anchor = stdIdx > 0 ? WEEKLY_STD_ORDER_V3[stdIdx - 1] : 'start';
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
  const removeCustom = (idToRemove: string) => {
    if (!confirm('Delete this custom section and all its data?')) return;
    setC(prev => ({ ...prev, custom_sections: prev.custom_sections.filter(s => s.id !== idToRemove) }));
  };
  const updateCustomData = (idToUpdate: string, patch: Partial<CustomSection>) => {
    setC(prev => ({ ...prev, custom_sections: prev.custom_sections.map(s => s.id === idToUpdate ? { ...s, ...patch } : s) }));
  };

  const renderCustomAt = (anchor: StandardSectionIdV3) =>
    customSectionsAt(c.custom_sections, anchor).map(s => (
      <CustomSectionInline
        key={s.id}
        section={s}
        onChange={(patch) => updateCustomData(s.id, patch)}
        onEditDef={() => openEditCustom(s)}
        onRemove={() => removeCustom(s.id)}
        headerExtra={<FeedbackButton section={`cs:${s.id}` as CommentSection} />}
      />
    ));

  const customSectionLabel = (section: CommentSection): string | undefined => {
    if (!section.startsWith('cs:')) return undefined;
    const csid = section.slice(3);
    return c.custom_sections.find(s => s.id === csid)?.name;
  };
  const labelForFeedback = (section: CommentSection): string =>
    customSectionLabel(section) ?? SECTION_LABELS_V3[section] ?? section;

  // ----- reusable pull-button + message bar for AUTO sections ---------------
  const AutoFetchBar = ({ label, busy, onClick, msg, onClose }: {
    label: string; busy: boolean; onClick: () => void; msg: Msg; onClose: () => void;
  }) => (
    <>
      <div className="d-flex justify-content-end mb-2">
        <Button size="sm" variant="outline-info" disabled={busy} onClick={onClick}>
          <i className="bi bi-cloud-download me-1" />{busy ? 'Fetching…' : label}
        </Button>
      </div>
      {msg && (
        <Alert variant={msg.kind} className="py-2 small mb-3" onClose={onClose} dismissible>{msg.text}</Alert>
      )}
    </>
  );

  const renderSectionBody = (def: SectionDefV3) => {
    if (def.special === 'sampling') {
      return (
        <>
          <AutoFetchBar label="Auto-fill from Sample Seeding" busy={fetchingSampling}
            onClick={fetchSamplingFromBrand} msg={samplingMsg} onClose={() => setSamplingMsg(null)} />
          <ScalarSectionBodyV3 def={def} data={(c as any)[def.id]} onField={(k, v) => setSec(def.id, k, v)} />
        </>
      );
    }
    if (def.special === 'shop_score') {
      return (
        <>
          <AutoFetchBar label="Pull Shop Performance Score (Sample Seeding)" busy={fetchingScore}
            onClick={fetchShopScoreFromBrand} msg={scoreMsg} onClose={() => setScoreMsg(null)} />
          <ScalarSectionBodyV3 def={def} data={(c as any)[def.id]} onField={(k, v) => setSec(def.id, k, v)} />
        </>
      );
    }
    if (def.special === 'live_sessions') {
      return (
        <>
          <AutoFetchBar label="Pull LIVE Sessions (Sample Seeding)" busy={fetchingLive}
            onClick={fetchLiveSessionsFromBrand} msg={liveMsg} onClose={() => setLiveMsg(null)} />
          <ScalarSectionBodyV3 def={def} data={(c as any)[def.id]} onField={(k, v) => setSec(def.id, k, v)} />
        </>
      );
    }
    if (def.special === 'product_catalog') {
      return (
        <>
          <AutoFetchBar label="Load products" busy={loadingProducts}
            onClick={loadProductsIntoAnalytics} msg={productsMsg} onClose={() => setProductsMsg(null)} />
          <TableSectionBodyV3 def={def} rows={(c as any)[def.id]}
            onCell={(i, k, v) => setCell(def.id, i, k, v)} onAddRow={() => addRow(def)} onDelRow={(i) => delRow(def.id, i)} />
        </>
      );
    }
    if (def.special === 'gmv_max_product') {
      return (
        <>
          <AutoFetchBar label="Pull from GMV Max" busy={fetchingGmv}
            onClick={fetchGmvMaxProduct} msg={gmvMsg} onClose={() => setGmvMsg(null)} />
          <TableSectionBodyV3 def={def} rows={(c as any)[def.id]}
            onCell={(i, k, v) => setCell(def.id, i, k, v)} onAddRow={() => addRow(def)} onDelRow={(i) => delRow(def.id, i)} />
        </>
      );
    }
    if (def.special === 'video_paste') {
      return (
        <>
          <VideoPasteBar onParsed={(parsed) => setC(prev => ({
            ...prev,
            top_videos: parsed.map(r => ({
              video_link: r.video_link, product_promoted: r.product_promoted,
              gmv: r.gmv, items_sold: r.items_sold,
            })),
          }))} />
          <TableSectionBodyV3 def={def} rows={(c as any)[def.id]}
            onCell={(i, k, v) => setCell(def.id, i, k, v)} onAddRow={() => addRow(def)} onDelRow={(i) => delRow(def.id, i)} />
        </>
      );
    }
    if (def.kind === 'scalar') {
      return <ScalarSectionBodyV3 def={def} data={(c as any)[def.id]} onField={(k, v) => setSec(def.id, k, v)} />;
    }
    return (
      <TableSectionBodyV3 def={def} rows={(c as any)[def.id]} fixed={def.kind === 'fixed'}
        onCell={(i, k, v) => setCell(def.id, i, k, v)} onAddRow={() => addRow(def)} onDelRow={(i) => delRow(def.id, i)} />
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
            <Badge bg="dark" className="ms-2">New format</Badge>
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
          {autoSaveBadge}
          <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
          <Button variant="outline-primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
          <Button variant="primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}
      {presetMsg && <Alert variant="info" className="py-2 small" dismissible onClose={() => setPresetMsg(null)}>{presetMsg}</Alert>}

      <div style={lockStyle} aria-disabled={formFrozen}>
      {renderCustomAt('start')}

      {/* 12 standard sections, registry-driven */}
      {WEEKLY_SECTIONS_V3.map(def => (
        <Fragment key={def.id}>
          <Card className="mb-4" data-section={def.id}>
            <Card.Header>
              <HeaderWithFeedback title={`${def.num}. ${def.title}`} section={def.id as CommentSection} sectionId={def.id} />
            </Card.Header>
            <Card.Body>
              {def.blurb && <p className="text-muted small mb-3">{def.blurb}</p>}
              {renderSectionBody(def)}
            </Card.Body>
          </Card>
          {renderCustomAt(def.id)}
        </Fragment>
      ))}

      {/* Insights — single advanced rich-text block (dividers built in) */}
      <Card className="mb-4" data-section="insights">
        <Card.Header><HeaderWithFeedback title="Insights" section="insights" sectionId="insights" /></Card.Header>
        <Card.Body>
          <Form.Text className="text-muted d-block mb-2">
            Write your insights for this week. Use the <strong>Divider</strong> button to separate topics — pick its thickness, colour and style.
          </Form.Text>
          <RichTextEditor
            value={c.insights.summary}
            onChange={html => setC(prev => ({ ...prev, insights: { summary: html } }))}
            placeholder="Write your insights for this week…"
            minHeight={240}
          />
          {priorReports.length > 0 && (
            <div className="mt-4">
              <div className="text-muted small fw-semibold mb-2">
                <i className="bi bi-clock-history me-1" />Previous weeks' insights (read-only) — for reference
              </div>
              <Accordion>
                {priorReports.map((p, i) => {
                  const cn: any = p.content ?? {};
                  const html: string = cn?.insights?.summary ?? (typeof cn?.insights === 'string' ? cn.insights : '') ?? cn?.summary ?? '';
                  const clean = sanitizeRich(html);
                  const hasText = clean.replace(/<[^>]*>/g, '').trim().length > 0;
                  return (
                    <Accordion.Item eventKey={String(i)} key={p.id}>
                      <Accordion.Header>
                        <span className="fw-semibold">Week #{(p as any).week_number ?? i + 1}</span>
                        <span className="text-muted ms-2 small">{formatRange(p.week_start, p.week_end)}</span>
                      </Accordion.Header>
                      <Accordion.Body>
                        {hasText
                          ? <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: clean }} />
                          : <span className="text-muted fst-italic">No insights were written for this week.</span>}
                      </Accordion.Body>
                    </Accordion.Item>
                  );
                })}
              </Accordion>
            </div>
          )}
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
        onSave={saveCustomDef} isEdit={csIsEdit} positions={V3_POSITIONS}
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
        {autoSaveBadge}
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
                Object.keys(SECTION_LABELS_V3).map(section => {
                  const sc = priorComments.filter(x => x.section === section);
                  if (sc.length === 0) return null;
                  return (
                    <div key={section} className="mb-3">
                      <h6 className="text-muted">{SECTION_LABELS_V3[section]}</h6>
                      {sc.map(cm => (
                        <div key={cm.id} className="p-2 mb-2 rounded small" style={{ background: 'var(--ac-surface-strong)', border: '1px solid var(--ac-border)' }}>
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
