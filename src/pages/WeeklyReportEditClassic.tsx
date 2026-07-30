import { useEffect, useMemo, useRef, useState, FormEvent, CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Form, Button, Row, Col, Table, Spinner, Alert, Badge, Modal, Offcanvas, Dropdown } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import { formatRange } from '../lib/dates';
import {
  WeeklyReportContent, emptyContent, normalizeContent,
  emptyTopCreator, emptyTopVideo, emptyProduct,
  ListingQuality, YesNoNA,
} from '../lib/reportSchema';
import SectionComments, { Comment, CommentSection } from '../components/SectionComments';
import { useAuth } from '../auth/AuthContext';
import RichTextEditor from '../components/RichTextEditor';
import { CustomSectionInline, CustomSectionDefModal, customSectionsAt, newSection, AddSectionMenu } from '../components/CustomSectionEditor';
import { CustomSection, CustomField, CustomFieldType, StandardSectionId } from '../lib/reportSchema';

// Standard-section render order — used to place a new custom section
// "above" / "below" a clicked section.
const WEEKLY_STD_ORDER: StandardSectionId[] = [
  'start', 'overall', 'top_creators', 'top_videos', 'video_performance',
  'gmv_max', 'product_highlights', 'shop_health', 'insights',
];
type ClickedSection =
  | { type: 'standard'; id: StandardSectionId }
  | { type: 'custom'; section: CustomSection };
import NumberInput from '../components/NumberInput';
import { parseReportPdf } from '../lib/importReport';
import { useEditLock } from '../lib/useEditLock';
import { useLiveReportContent } from '../lib/useLiveReportContent';
import EditLockBanner from '../components/EditLockBanner';

const SECTION_LABELS: Record<string, string> = {
  overall: 'Overall Performance',
  top_creators: 'Top Creators',
  top_videos: 'Top Videos',
  video_performance: 'Video Performance',
  gmv_max: 'GMV Max',
  product_highlights: 'Product Highlights',
  shop_health: 'Shop Health',
  insights: 'Insights',
};

interface ReportRow {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: any;
}
interface Brand { id: string; name: string; client: string; client_status: string | null; }

/** Hand-off freeze: long enough for the previous editor's final save to land. */
const HANDOFF_SETTLE_MS = 2000;

export default function WeeklyReportEditClassic() {
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
  const [report, setReport] = useState<ReportRow | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [c, setC] = useState<WeeklyReportContent>(emptyContent());
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-save state (debounced) — persists the whole report content as it's edited.
  const lastSavedContent = useRef<string | null>(null);
  const [autoSave, setAutoSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // True while we re-pull the latest content right after taking over editing.
  const [reloading, setReloading] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [priorReports, setPriorReports] = useState<ReportRow[]>([]);
  const [selectedPriorId, setSelectedPriorId] = useState<string>('');
  const [priorComments, setPriorComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  const [csModalOpen, setCsModalOpen] = useState(false);
  const [csDraft, setCsDraft] = useState<CustomSection>(newSection());
  const [csIsEdit, setCsIsEdit] = useState(false);
  // Where to splice a newly-added section (null = append at end).
  const [csTargetIndex, setCsTargetIndex] = useState<number | null>(null);

  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);

  const [fetchingGmv, setFetchingGmv] = useState(false);
  const [gmvFetchMsg, setGmvFetchMsg] = useState<{ kind: 'success' | 'warning' | 'danger'; text: string } | null>(null);

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
  const [presetSavingId, setPresetSavingId] = useState<string | null>(null);
  const [presetMsg, setPresetMsg] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: 'success' | 'warning' | 'danger'; text: string } | null>(null);

  const onImportFile = async (file: File) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const parsed = await parseReportPdf(file);
      setC(prev => {
        const next: WeeklyReportContent = { ...prev };
        if (parsed.content.overall)                      next.overall            = parsed.content.overall;
        if (parsed.content.video_performance)            next.video_performance  = parsed.content.video_performance;
        if (parsed.content.gmv_max)                      next.gmv_max            = parsed.content.gmv_max;
        if (parsed.content.shop_health)                  next.shop_health        = parsed.content.shop_health;
        if (parsed.content.top_creators?.length)         next.top_creators       = parsed.content.top_creators;
        if (parsed.content.top_videos?.length)           next.top_videos         = parsed.content.top_videos;
        if (parsed.content.product_highlights?.length)   next.product_highlights = parsed.content.product_highlights;
        if (parsed.content.insights)                     next.insights           = parsed.content.insights;
        return next;
      });
      const pieces: string[] = [];
      if (parsed.content.overall)                       pieces.push('KPIs');
      if (parsed.content.video_performance)             pieces.push('Video Performance');
      if (parsed.content.gmv_max)                       pieces.push('GMV Max');
      if (parsed.content.shop_health)                   pieces.push('Shop Health');
      if (parsed.content.top_creators?.length)          pieces.push(`${parsed.content.top_creators.length} creator${parsed.content.top_creators.length === 1 ? '' : 's'}`);
      if (parsed.content.top_videos?.length)            pieces.push(`${parsed.content.top_videos.length} video${parsed.content.top_videos.length === 1 ? '' : 's'}`);
      if (parsed.content.product_highlights?.length)    pieces.push(`${parsed.content.product_highlights.length} product${parsed.content.product_highlights.length === 1 ? '' : 's'}`);
      if (parsed.content.insights?.summary)             pieces.push('Insights');
      const summary = pieces.length > 0
        ? `Imported: ${pieces.join(', ')}. Review the fields and save when ready.`
        : 'Nothing recognizable was extracted. Make sure the PDF uses the standard report layout.';
      const warnSuffix = parsed.warnings.length > 0 ? ` (warnings: ${parsed.warnings.join('; ')})` : '';
      setImportMsg({ kind: pieces.length > 0 ? 'success' : 'warning', text: summary + warnSuffix });
    } catch (e: any) {
      setImportMsg({ kind: 'danger', text: `Failed to parse PDF: ${e?.message ?? 'unknown error'}` });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

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
      const normalized = normalizeContent(r.content);
      setC(normalized);
      lastSavedContent.current = JSON.stringify(normalized);
      const { data: bd } = await supabase.from('brands').select('id,name,client,client_status').eq('id', r.brand_id).single();
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
        ...p,
        kind: p.kind ?? 'custom',
        section_id: p.section_id ?? null,
      })) as PresetRow[]);
      setLoading(false);
    })();
  }, [id]);

  // Debounced auto-save of the whole report content (status untouched) ~1s
  // after the user stops editing — covers Insights, Approval and every other
  // section (rich-text Quill editors included).
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
      const { error } = await supabase.from('weekly_reports')
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
    table: 'weekly_reports',
    id,
    active: lock.isLockedOut || reloading,
    onContent: raw => {
      const normalized = normalizeContent(raw);
      setC(normalized);
      lastSavedContent.current = JSON.stringify(normalized);
    },
  });

  // Edit-lock hand-off. When control changes hands we (a) flush our newest edits
  // the instant we LOSE control so the next editor continues from them, and
  // (b) re-pull the latest content when we GAIN control after being locked out,
  // briefly freezing the form so we don't clobber it by typing during the swap.
  const wasLockedOut = useRef(false);
  useEffect(() => {
    if (loading || !report) return;
    const nowLocked = lock.isLockedOut;
    if (nowLocked === wasLockedOut.current) return; // no transition
    const lostControl = nowLocked && !wasLockedOut.current;
    const gainedControl = !nowLocked && wasLockedOut.current;
    wasLockedOut.current = nowLocked;

    if (lostControl) {
      if (brand?.client_status === 'closed') return;
      const snapshot = c;
      void supabase.from('weekly_reports').update({ content: snapshot }).eq('id', id)
        .then(({ error }) => { if (!error) lastSavedContent.current = JSON.stringify(snapshot); });
    } else if (gainedControl) {
      setReloading(true);
      const t = setTimeout(async () => {
        const { data, error } = await supabase.from('weekly_reports').select('content').eq('id', id).single();
        if (!error && data) {
          const normalized = normalizeContent(data.content);
          setC(normalized);
          lastSavedContent.current = JSON.stringify(normalized);
          setAutoSave('idle');
        }
        setReloading(false);
      }, HANDOFF_SETTLE_MS);
      return () => clearTimeout(t);
    }
  }, [lock.isLockedOut]);

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
      insert_after: p.insert_after ?? 'insights',
    };
    setC(prev => ({ ...prev, custom_sections: [...prev.custom_sections, cs] }));
    setPresetMsg(`Added "${cs.name}" from preset.`);
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

  const saveSectionAsPreset = async (s: CustomSection) => {
    const name = window.prompt('Save this section as a preset. Name:', s.name || 'Untitled section');
    if (!name) return;
    setPresetSavingId(s.id);
    const payload = {
      name: s.name,
      description: s.description,
      is_repeater: s.is_repeater,
      insert_after: s.insert_after,
      fields: s.fields.map(f => ({ label: f.label, type: f.type, options: f.options })),
    };
    const { data, error } = await supabase.from('section_presets')
      .insert({ name: name.trim(), payload, created_by: profile?.id ?? null })
      .select().single();
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

  // Standard-section presets — snapshot a section's current data and reapply later.
  const customPresets: PresetRow[] = useMemo(
    () => presets.filter((p: PresetRow) => p.kind === 'custom'),
    [presets]
  );
  const standardPresetsFor = (sectionId: string): PresetRow[] =>
    presets.filter((p: PresetRow) => p.kind === 'standard' && p.section_id === sectionId);

  const standardSectionData = (sectionId: string): any => {
    switch (sectionId) {
      case 'overall':            return c.overall;
      case 'top_creators':       return c.top_creators;
      case 'top_videos':         return c.top_videos;
      case 'video_performance':  return c.video_performance;
      case 'gmv_max':            return c.gmv_max;
      case 'product_highlights': return c.product_highlights;
      case 'shop_health':        return c.shop_health;
      case 'insights':           return c.insights;
      default: return null;
    }
  };

  const applyStandardPreset = (sectionId: string, data: any) => {
    setC(prev => ({ ...prev, [sectionId]: data }));
    setPresetMsg(`Loaded preset into ${SECTION_LABELS[sectionId] ?? sectionId}.`);
  };

  const saveStandardPreset = async (sectionId: string) => {
    const sectionLabel = SECTION_LABELS[sectionId] ?? sectionId;
    const name = window.prompt(`Save "${sectionLabel}" as a preset. Name:`, `${brand?.name ?? ''} — ${sectionLabel}`.trim());
    if (!name) return;
    const data = standardSectionData(sectionId);
    if (data == null) return;
    const { data: row, error } = await supabase.from('section_presets')
      .insert({
        name: name.trim(),
        kind: 'standard',
        section_id: sectionId,
        payload: { data },
        created_by: profile?.id ?? null,
      }).select().single();
    if (error) { alert(error.message); return; }
    setPresets(prev => [row as PresetRow, ...prev]);
    setPresetMsg(`Saved preset "${(row as PresetRow).name}".`);
  };

  const addComment = async (section: CommentSection, body: string, _authorName: string, parentId?: string) => {
    if (!report) return;
    // Goes through the edge function so other staff get notified.
    const { data, error } = await supabase.functions.invoke('post-staff-comment', {
      body: { report_id: report.id, section, body, parent_id: parentId ?? null },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
  };

  const o = c.overall;
  const vp = c.video_performance;
  const gm = c.gmv_max;
  const sh = c.shop_health;

  const setOverall = (k: keyof typeof o, v: any) => setC({ ...c, overall: { ...o, [k]: v } });
  const setVP = (k: keyof typeof vp, v: any) => setC({ ...c, video_performance: { ...vp, [k]: v } });
  const setGM = (k: keyof typeof gm, v: any) => setC({ ...c, gmv_max: { ...gm, [k]: v } });
  const setSH = (k: keyof typeof sh, v: any) => setC({ ...c, shop_health: { ...sh, [k]: v } });

  const num = (v: string) => v === '' ? 0 : Number(v);
  const numOrNull = (v: string) => v === '' ? null : Number(v);

  const updRow = <T,>(key: 'top_creators' | 'top_videos' | 'product_highlights', i: number, patch: Partial<T>) => {
    const arr = [...(c[key] as any[])];
    arr[i] = { ...arr[i], ...patch };
    setC({ ...c, [key]: arr });
  };
  const addRow = (key: 'top_creators' | 'top_videos' | 'product_highlights', factory: () => any) =>
    setC({ ...c, [key]: [...(c[key] as any[]), factory()] });
  const delRow = (key: 'top_creators' | 'top_videos' | 'product_highlights', i: number) => {
    const arr = [...(c[key] as any[])];
    arr.splice(i, 1);
    setC({ ...c, [key]: arr });
  };

  const fetchGmvMaxFromBrand = async () => {
    if (!report) return;
    setFetchingGmv(true); setGmvFetchMsg(null);
    const { data, error } = await supabase
      .from('brand_gmv_max_weekly')
      .select('*')
      .eq('brand_id', report.brand_id)
      .eq('week_start', report.week_start)
      .maybeSingle();
    setFetchingGmv(false);
    if (error) { setGmvFetchMsg({ kind: 'danger', text: error.message }); return; }
    if (!data) {
      setGmvFetchMsg({
        kind: 'warning',
        text: `No GMV Max weekly entry exists for ${formatRange(report.week_start, report.week_end)} on this brand. Add it on the brand's GMV Max tab first.`,
      });
      return;
    }
    const w: any = data;
    setC(prev => ({
      ...prev,
      gmv_max: {
        not_yet_started: false,
        ad_spend: Number(w.ad_spend) || 0,
        roi: Number(w.roi) || 0,
        orders: Number(w.orders) || 0,
        cpo: Number(w.cpo) || 0,
        gmv: Number(w.gmv) || 0,
        notes: String(w.notes ?? ''),
      },
    }));
    setGmvFetchMsg({ kind: 'success', text: `Pulled GMV Max for ${formatRange(report.week_start, report.week_end)} from brand. Don't forget to save.` });
  };

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
    // If the report is asking the client for approval, the client has to be
    // able to see it via the share link, so auto-enable per-report sharing.
    // (We never auto-disable; that's an explicit choice on the brand reporting
    // tab.)
    const update: Record<string, any> = { content: c, status };
    if (c.approval?.enabled) update.is_shared = true;
    const { error } = await supabase.from('weekly_reports')
      .update(update).eq('id', id);
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
    } catch (e: any) {
      alert(e?.message ?? 'Failed to pull comment');
    }
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

  const sectionFeedbackCount = (section: CommentSection) =>
    comments.filter(c => c.section === section).length;

  const FeedbackButton = ({ section }: { section: CommentSection }) => {
    const n = sectionFeedbackCount(section);
    if (n === 0) return null;
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFeedbackSection(section); }}
        title="View client feedback">
        <i className="bi bi-chat-left-text" />
        <Badge bg="primary" pill>{n}</Badge>
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

  // Per-standard-section preset menu: save current values, load saved preset, delete a preset.
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
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); removePreset(p); }}
                  title="Delete preset">
                  <i className="bi bi-trash" />
                </Button>
              )}
            </div>
          ))}
        </Dropdown.Menu>
      </Dropdown>
    );
  };

  // Wrap a header label so it sits at left, with optional extras + feedback icon on the right.
  // For standard sections, automatically attaches a preset save/load menu.
  const HeaderWithFeedback = ({ title, section, extra, sectionId }: {
    title: string; section: CommentSection; extra?: React.ReactNode; sectionId?: string;
  }) => (
    <div className="d-flex justify-content-between align-items-center">
      <span className="fw-semibold">{title}</span>
      <div className="d-flex align-items-center gap-2">
        {extra}
        {sectionId && <StdPresetMenu sectionId={sectionId} />}
        <AddSectionMenu onPick={(pl) => openAddSectionRelative({ type: 'standard', id: section as StandardSectionId }, pl)} />
        <FeedbackButton section={section} />
      </div>
    </div>
  );

  // Custom section management
  const openAddCustom = () => {
    setCsDraft(newSection('insights')); setCsIsEdit(false); setCsTargetIndex(null); setCsModalOpen(true);
  };
  const openEditCustom = (s: CustomSection) => { setCsDraft({ ...s, fields: s.fields.map(f => ({ ...f })) }); setCsIsEdit(true); setCsModalOpen(true); };

  // Open the add-section modal positioned above/below a clicked section.
  const openAddSectionRelative = (clicked: ClickedSection, placement: 'above' | 'below') => {
    const cs = c.custom_sections;
    // insert_after was widened to `string` (v2 anchors) — keep this in step.
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
    setC({ ...c, custom_sections: c.custom_sections.filter(s => s.id !== id) });
  };
  const updateCustomData = (id: string, patch: Partial<CustomSection>) => {
    setC({ ...c, custom_sections: c.custom_sections.map(s => s.id === id ? { ...s, ...patch } : s) });
  };

  const renderCustomAt = (anchor: StandardSectionId) =>
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
            title="Upload a report PDF and auto-fill the form fields">
            <i className="bi bi-file-earmark-arrow-up me-1" />
            {importing ? 'Reading PDF…' : 'Import from PDF'}
          </Button>
          {priorReports.length > 0 && (
            <Button variant="outline-info" onClick={openCommentsModal}>
              <i className="bi bi-chat-left-text me-1" /> Load previous comments
            </Button>
          )}
          <Dropdown>
            <Dropdown.Toggle variant="outline-info" disabled={formFrozen} title="Insert a saved custom-section preset">
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
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); removePreset(p); }}
                      title="Delete preset">
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
          <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
          <Button variant="outline-primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
          <Button variant="primary" disabled={saving || brandInactive || formFrozen} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}
      {presetMsg && <Alert variant="info" className="py-2 small" dismissible onClose={() => setPresetMsg(null)}>{presetMsg}</Alert>}
      {importMsg && (
        <Alert variant={importMsg.kind} className="py-2 small" dismissible onClose={() => setImportMsg(null)}>
          {importMsg.text}
        </Alert>
      )}

      <div style={lockStyle} aria-disabled={formFrozen}>
      {renderCustomAt('start')}

      {/* Overall Performance */}
      <Card className="mb-4">
        <Card.Header><HeaderWithFeedback title="Overall Performance" section="overall" sectionId="overall" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={3}><Form.Label className="small">Total GMV ($)</Form.Label>
              <NumberInput step="0.01" value={o.total_gmv} onChange={n => setOverall('total_gmv', n)} /></Col>
            <Col md={3}><Form.Label className="small">Affiliate GMV ($)</Form.Label>
              <NumberInput step="0.01" value={o.affiliate_gmv} onChange={n => setOverall('affiliate_gmv', n)} /></Col>
            <Col md={3}><Form.Label className="small">Orders</Form.Label>
              <NumberInput value={o.orders} onChange={n => setOverall('orders', n)} /></Col>
            <Col md={3}><Form.Label className="small">Pending Collabs</Form.Label>
              <NumberInput value={o.pending_collabs} onChange={n => setOverall('pending_collabs', n)} /></Col>

            <Col md={3}><Form.Label className="small">Samples Approved</Form.Label>
              <NumberInput value={o.samples_approved} onChange={n => setOverall('samples_approved', n)} /></Col>
            <Col md={6}><Form.Label className="small">Samples note (e.g. MTD Approved: 38)</Form.Label>
              <Form.Control value={o.samples_approved_note} onChange={e => setOverall('samples_approved_note', e.target.value)} /></Col>

            <Col md={12}><hr className="my-0" /></Col>
            <Col md={4}>
              <Form.Check type="switch" id="ad-spend-not-started"
                label="Ad Spend — not yet started"
                checked={o.ad_spend_not_started}
                onChange={e => setOverall('ad_spend_not_started', e.target.checked)} />
            </Col>
            {!o.ad_spend_not_started && (
              <Col md={4}><Form.Label className="small">Ad Spend ($)</Form.Label>
                <NumberInput step="0.01" value={o.ad_spend} onChange={n => setOverall('ad_spend', n)} /></Col>
            )}
            <Col md={o.ad_spend_not_started ? 8 : 4}>
              <Form.Label className="small">Target (e.g. "Target: $5,000")</Form.Label>
              <Form.Control value={o.ad_spend_target} onChange={e => setOverall('ad_spend_target', e.target.value)} />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('overall')}

      {/* Top Creators */}
      <Section title="Top Creators" onAdd={() => addRow('top_creators', emptyTopCreator)} empty={c.top_creators.length === 0} onAddSection={(pl) => openAddSectionRelative({ type: 'standard', id: 'top_creators' }, pl)} headerRight={<><StdPresetMenu sectionId="top_creators" /><FeedbackButton section="top_creators" /></>}>
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            <th>Creator Name</th>
            <th style={{width:130}}>Videos Posted</th>
            <th style={{width:120}}>Items sold</th>
            <th style={{width:140}}>GMV Generated ($)</th>
            <th style={{width:50}}></th>
          </tr></thead>
          <tbody>
            {c.top_creators.map((r, i) => (
              <tr key={i}>
                <td><Form.Control size="sm" value={r.name} onChange={e => updRow('top_creators', i, { name: e.target.value })} /></td>
                <td><NumberInput size="sm" value={r.videos} onChange={n => updRow('top_creators', i, { videos: n })} /></td>
                <td><NumberInput size="sm" value={r.items_sold} onChange={n => updRow('top_creators', i, { items_sold: n })} /></td>
                <td><NumberInput size="sm" step="0.01" value={r.gmv} onChange={n => updRow('top_creators', i, { gmv: n })} /></td>
                <td><Button size="sm" variant="outline-danger" onClick={() => delRow('top_creators', i)}><i className="bi bi-trash" /></Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
      {renderCustomAt('top_creators')}

      {/* Top Videos — current week only; last week auto-shown in dashboard */}
      <Section title="Top Videos (this week)" onAdd={() => addRow('top_videos', emptyTopVideo)} empty={c.top_videos.length === 0} onAddSection={(pl) => openAddSectionRelative({ type: 'standard', id: 'top_videos' }, pl)} headerRight={<><StdPresetMenu sectionId="top_videos" /><FeedbackButton section="top_videos" /></>}>
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            <th>Creator Name</th>
            <th>Video URL</th>
            <th style={{width:120}}>Items sold</th>
            <th style={{width:140}}>GMV Generated ($)</th>
            <th style={{width:50}}></th>
          </tr></thead>
          <tbody>
            {c.top_videos.map((r, i) => (
              <tr key={i}>
                <td><Form.Control size="sm" value={r.creator_name} onChange={e => updRow('top_videos', i, { creator_name: e.target.value })} /></td>
                <td><Form.Control size="sm" placeholder="https://…" value={r.video_url} onChange={e => updRow('top_videos', i, { video_url: e.target.value })} /></td>
                <td><NumberInput size="sm" value={r.items_sold} onChange={n => updRow('top_videos', i, { items_sold: n })} /></td>
                <td><NumberInput size="sm" step="0.01" value={r.gmv} onChange={n => updRow('top_videos', i, { gmv: n })} /></td>
                <td><Button size="sm" variant="outline-danger" onClick={() => delRow('top_videos', i)}><i className="bi bi-trash" /></Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
      {renderCustomAt('top_videos')}

      {/* Video Performance */}
      <Card className="mb-4">
        <Card.Header><HeaderWithFeedback title="Video Performance" section="video_performance" sectionId="video_performance" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={3}><Form.Label className="small">Total Videos Posted</Form.Label>
              <NumberInput value={vp.total_videos_posted} onChange={n => setVP('total_videos_posted', n)} /></Col>
            <Col md={3}><Form.Label className="small">Video Views</Form.Label>
              <NumberInput value={vp.video_views} onChange={n => setVP('video_views', n)} /></Col>
            <Col md={3}><Form.Label className="small">CTR (%)</Form.Label>
              <NumberInput step="0.01" value={vp.ctr} onChange={n => setVP('ctr', n)} /></Col>
            <Col md={3}><Form.Label className="small">CTOR (%)</Form.Label>
              <NumberInput step="0.01" value={vp.ctor} onChange={n => setVP('ctor', n)} /></Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('video_performance')}

      {/* GMV Max */}
      <Card className="mb-4">
        <Card.Header><HeaderWithFeedback title="Overall GMV Max Performance" section="gmv_max" sectionId="gmv_max" extra={
          <Button size="sm" variant="outline-info" disabled={fetchingGmv}
            onClick={fetchGmvMaxFromBrand}
            title={`Pull weekly entry from the brand's GMV Max page for ${formatRange(report.week_start, report.week_end)}`}>
            <i className="bi bi-cloud-download me-1" />
            {fetchingGmv ? 'Fetching…' : 'Fetch from brand'}
          </Button>
        } /></Card.Header>
        <Card.Body>
          {gmvFetchMsg && (
            <Alert variant={gmvFetchMsg.kind} className="py-2 small mb-3" onClose={() => setGmvFetchMsg(null)} dismissible>
              {gmvFetchMsg.text}
            </Alert>
          )}
          <Row className="g-3">
            <Col md={3}>
              <Form.Check type="switch" id="gm-not-started"
                label="Not yet started"
                checked={gm.not_yet_started}
                onChange={e => setGM('not_yet_started', e.target.checked)} />
            </Col>
            {!gm.not_yet_started && (
              <>
                <Col md={3}><Form.Label className="small">Ad Spend ($)</Form.Label>
                  <NumberInput step="0.01" value={gm.ad_spend} onChange={n => setGM('ad_spend', n)} /></Col>
                <Col md={3}><Form.Label className="small">ROI</Form.Label>
                  <NumberInput step="0.01" value={gm.roi} onChange={n => setGM('roi', n)} /></Col>
                <Col md={3}><Form.Label className="small">Orders</Form.Label>
                  <NumberInput value={gm.orders} onChange={n => setGM('orders', n)} /></Col>
                <Col md={3}><Form.Label className="small">CPO ($)</Form.Label>
                  <NumberInput step="0.01" value={gm.cpo} onChange={n => setGM('cpo', n)} /></Col>
                <Col md={3}><Form.Label className="small">GMV ($)</Form.Label>
                  <NumberInput step="0.01" value={gm.gmv} onChange={n => setGM('gmv', n)} /></Col>
                <Col md={6}><Form.Label className="small">Notes</Form.Label>
                  <Form.Control value={gm.notes} onChange={e => setGM('notes', e.target.value)} /></Col>
              </>
            )}
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('gmv_max')}

      {/* Product Highlights */}
      <Section title="Product Highlights" onAdd={() => addRow('product_highlights', emptyProduct)} empty={c.product_highlights.length === 0} onAddSection={(pl) => openAddSectionRelative({ type: 'standard', id: 'product_highlights' }, pl)} headerRight={<><StdPresetMenu sectionId="product_highlights" /><FeedbackButton section="product_highlights" /></>}>
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            <th>Product Name</th>
            <th style={{width:180}}>Product ID</th>
            <th style={{width:120}}>Total Units Sold</th>
            <th style={{width:130}}>Affiliate Units Sold</th>
            <th style={{width:140}}>Total GMV ($)</th>
            <th style={{width:140}}>Affiliate GMV ($)</th>
            <th style={{width:120}}>Videos Posted</th>
            <th style={{width:140}}>Listing Quality</th>
            <th style={{width:50}}></th>
          </tr></thead>
          <tbody>
            {c.product_highlights.map((r, i) => (
              <tr key={i}>
                <td><Form.Control size="sm" value={r.product_name} onChange={e => updRow('product_highlights', i, { product_name: e.target.value })} /></td>
                <td><Form.Control size="sm" value={r.product_id} onChange={e => updRow('product_highlights', i, { product_id: e.target.value })} /></td>
                <td><NumberInput size="sm" value={r.total_units_sold} onChange={n => updRow('product_highlights', i, { total_units_sold: n })} /></td>
                <td><NumberInput size="sm" value={r.affiliate_units_sold} onChange={n => updRow('product_highlights', i, { affiliate_units_sold: n })} /></td>
                <td><NumberInput size="sm" step="0.01" value={r.total_gmv} onChange={n => updRow('product_highlights', i, { total_gmv: n })} /></td>
                <td><NumberInput size="sm" step="0.01" value={r.affiliate_gmv} onChange={n => updRow('product_highlights', i, { affiliate_gmv: n })} /></td>
                <td><NumberInput size="sm" value={r.videos_posted} onChange={n => updRow('product_highlights', i, { videos_posted: n })} /></td>
                <td>
                  <Form.Select size="sm" value={r.listing_quality}
                    onChange={e => updRow('product_highlights', i, { listing_quality: e.target.value as ListingQuality })}>
                    <option value="">—</option>
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                  </Form.Select>
                </td>
                <td><Button size="sm" variant="outline-danger" onClick={() => delRow('product_highlights', i)}><i className="bi bi-trash" /></Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
      {renderCustomAt('product_highlights')}

      {/* Shop Health */}
      <Card className="mb-4">
        <Card.Header><HeaderWithFeedback title="Shop Health" section="shop_health" sectionId="shop_health" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={3}><Form.Label className="small">Shop Performance Score (out of 5)</Form.Label>
              <Form.Control type="number" step="0.1" min={0} max={5} placeholder="Not yet assigned"
                onWheel={e => (e.currentTarget as HTMLInputElement).blur()}
                value={sh.shop_performance_score ?? ''} onChange={e => setSH('shop_performance_score', numOrNull(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Product Satisfaction (out of 5)</Form.Label>
              <Form.Control type="number" step="0.1" min={0} max={5} placeholder="Not yet rated"
                onWheel={e => (e.currentTarget as HTMLInputElement).blur()}
                value={sh.product_satisfaction_rating ?? ''} onChange={e => setSH('product_satisfaction_rating', numOrNull(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Fulfillment & Logistics (out of 5)</Form.Label>
              <Form.Control type="number" step="0.1" min={0} max={5} placeholder="Not yet rated"
                onWheel={e => (e.currentTarget as HTMLInputElement).blur()}
                value={sh.fulfillment_rating ?? ''} onChange={e => setSH('fulfillment_rating', numOrNull(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Customer Service (out of 5)</Form.Label>
              <Form.Control type="number" step="0.1" min={0} max={5} placeholder="Not yet rated"
                onWheel={e => (e.currentTarget as HTMLInputElement).blur()}
                value={sh.customer_service_rating ?? ''} onChange={e => setSH('customer_service_rating', numOrNull(e.target.value))} /></Col>

            <Col md={3}><Form.Label className="small">Dispatching on time?</Form.Label>
              <Form.Select value={sh.dispatching_on_time} onChange={e => setSH('dispatching_on_time', e.target.value as YesNoNA)}>
                <option value="not_rated">Not rated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Form.Select>
            </Col>
            <Col md={3}><Form.Label className="small">Replying within 24h?</Form.Label>
              <Form.Select value={sh.replying_within_24h} onChange={e => setSH('replying_within_24h', e.target.value as YesNoNA)}>
                <option value="not_rated">Not rated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Form.Select>
            </Col>
            <Col md={3} className="d-flex align-items-end">
              <Form.Check type="switch" id="sh-warn" label="Warnings this week"
                checked={sh.warnings_received} onChange={e => setSH('warnings_received', e.target.checked)} />
            </Col>
            <Col md={3} className="d-flex align-items-end">
              <Form.Check type="switch" id="sh-viol" label="Violations this week"
                checked={sh.violations_received} onChange={e => setSH('violations_received', e.target.checked)} />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('shop_health')}

      {/* Insights */}
      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <HeaderWithFeedback title="Insights" section="insights" sectionId="insights" />
          <AutoSaveBadge />
        </Card.Header>
        <Card.Body>
          <RichTextEditor
            value={c.insights.summary}
            onChange={html => setC(prev => ({ ...prev, insights: { summary: html } }))}
            placeholder="Write your insights for this week…"
            minHeight={220}
          />
        </Card.Body>
      </Card>
      {renderCustomAt('insights')}

      {/* Approval Needed (optional) */}
      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold">
            <i className="bi bi-shield-check me-2 text-warning" />
            Approval Needed / Action Items
          </span>
          <div className="d-flex align-items-center gap-3">
            <AutoSaveBadge />
            <Form.Check
              type="switch"
              id="approval-needed-toggle"
              checked={!!c.approval?.enabled}
              onChange={e => setC(prev => ({ ...prev, approval: { ...prev.approval, enabled: e.target.checked } }))}
              label={c.approval?.enabled ? 'On — client will see approval prompt' : 'Off'}
            />
          </div>
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
            Client feedback
            {feedbackSection && <small className="text-muted ms-2 fw-normal">— {labelForFeedback(feedbackSection)}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackSection && (
            <SectionComments
              section={feedbackSection}
              sectionLabel={labelForFeedback(feedbackSection)}
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
        <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
        <Button variant="outline-primary" disabled={saving || brandInactive} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
        <Button variant="primary" disabled={saving || brandInactive} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
      </div>

      <Modal show={showComments} onHide={() => setShowComments(false)} centered size="lg" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>Previous comments — reference</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {priorReports.length === 0 ? (
            <p className="text-muted mb-0">No previous reports for this brand.</p>
          ) : (
            <>
              <Form.Group className="mb-3">
                <Form.Label className="small">Choose a report</Form.Label>
                <Form.Select value={selectedPriorId} onChange={e => { setSelectedPriorId(e.target.value); loadPriorComments(e.target.value); }}>
                  {priorReports.map(p => (
                    <option key={p.id} value={p.id}>
                      Week #{p.week_number} — {formatRange(p.week_start, p.week_end)}
                    </option>
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
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowComments(false)}>Close</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

function Section({ title, onAdd, empty, children, headerRight, onAddSection }: {
  title: string; onAdd: () => void; empty: boolean; children: React.ReactNode;
  headerRight?: React.ReactNode; onAddSection?: (placement: 'above' | 'below') => void;
}) {
  return (
    <Card className="mb-4">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span className="fw-semibold">{title}</span>
        <div className="d-flex align-items-center gap-2">
          <Button size="sm" onClick={onAdd}><i className="bi bi-plus-lg me-1" />Add row</Button>
          {onAddSection && <AddSectionMenu onPick={onAddSection} />}
          {headerRight}
        </div>
      </Card.Header>
      <Card.Body className="p-2">
        {empty ? <p className="text-muted text-center mb-0 py-3 small">No rows yet — click "Add row".</p> : children}
      </Card.Body>
    </Card>
  );
}
