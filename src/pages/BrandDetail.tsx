import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card, Spinner, Alert, Nav, Badge, Button, Dropdown, Form } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import BrandResourcesTab from './brand/BrandResourcesTab';
import BrandReportingTab from './brand/BrandReportingTab';
import BrandApprovalsTab from './brand/BrandApprovalsTab';
import BrandGmvMaxTab from './brand/BrandGmvMaxTab';
import BrandSamplesTab from './brand/BrandSamplesTab';
import BrandProductsTab from './brand/BrandProductsTab';
import BrandBillingTab from './brand/BrandBillingTab';
import BrandSopTab from './brand/BrandSopTab';
import Avatar from '../components/Avatar';
import RegionChip from '../components/RegionChip';
import { SCOPE_LABEL, SCOPE_ICON } from '../lib/brandScope';

/** Minimal person shape for the brand's Team Lead / APC header chips. */
interface OwnerLite { id: string; name: string; avatar: string | null; }

interface Brand {
  id: string;
  name: string;
  client: string;
  client_id: string | null;
  share_enabled: boolean;
  client_status: string | null;
  currency: string | null;
  region: string | null;
  scope: string[] | null;
}

type TabKey = 'resources' | 'sop' | 'reporting' | 'approvals' | 'gmv-max' | 'samples' | 'products' | 'billing';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'resources',   label: 'Resources',      icon: 'bi-folder2-open' },
  { key: 'reporting',   label: 'Reporting',      icon: 'bi-bar-chart' },
  { key: 'approvals',   label: 'Approvals',      icon: 'bi-patch-check' },
  { key: 'gmv-max',     label: 'GMV Max',        icon: 'bi-graph-up-arrow' },
  { key: 'samples',     label: 'Sample Seeding', icon: 'bi-box-seam' },
  { key: 'products',    label: 'Products',       icon: 'bi-tags' },
  { key: 'sop',         label: 'SOP',            icon: 'bi-journal-text' },
  { key: 'billing',     label: 'Billing',        icon: 'bi-cash-coin' },
];

// Status filter for the prev/next walk + brand switcher. Mirrors the Brands list
// vocabulary. Defaults to "In Progress" so navigation walks active brands only.
type ClientStatus = 'onboarding' | 'in_progress' | 'paused' | 'closed';
const STATUS_FILTERS: { key: 'all' | ClientStatus; label: string; icon: string }[] = [
  { key: 'all',         label: 'All brands',         icon: 'bi-asterisk' },
  { key: 'onboarding',  label: 'Onboarding',         icon: 'bi-rocket-takeoff-fill' },
  { key: 'in_progress', label: 'In Progress',        icon: 'bi-check-circle-fill' },
  { key: 'paused',      label: 'Temporarily Paused', icon: 'bi-pause-circle-fill' },
  { key: 'closed',      label: 'Closed',             icon: 'bi-archive-fill' },
];
const statusLabel = (k: 'all' | ClientStatus) => STATUS_FILTERS.find(f => f.key === k)?.label ?? k;

/** A Team Lead option in the brand-nav filter (Bob only — he's the one who
 *  sees every team's brands). 'none' buckets brands with no Team Lead. */
interface LeadOption { id: string; name: string; count: number; }

export default function BrandDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { profile } = useAuth();
  const isBob = profile?.role === 'bob';
  const isApc = profile?.role === 'apc';
  const isTeamLead = profile?.role === 'team_lead';
  // Ads Manager: APC-like VIEW access to their assigned brands; edits only GMV Max.
  const isAdsManager = profile?.role === 'ads_manager';
  const canManageGmvMax = !!profile?.can_manage_gmv_max;

  const [brand, setBrand] = useState<Brand | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [assignedToMe, setAssignedToMe] = useState(false);
  // Sibling list (id + name + status + owning Team Lead) so we can offer prev /
  // next nav and a switcher dropdown.
  const [siblings, setSiblings] = useState<
    { id: string; name: string; status: ClientStatus; leadId: string | null }[]>([]);
  // team_lead_id → display name, for the Bob-only Team Lead filter below.
  const [leadNames, setLeadNames] = useState<Map<string, string>>(new Map());
  // Brand-switcher dropdown state.
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [brandSearch, setBrandSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Status filter driving the prev/next walk + switcher list. Defaults to the
  // opened brand's own category (synced on load below) so prev/next walks brands
  // of the same status; the funnel lets you override.
  const [navStatus, setNavStatus] = useState<'all' | ClientStatus>('in_progress');
  // Second axis on the same filter, Bob only: walk one Team Lead's brands.
  // 'all' = every team, 'none' = brands with no Team Lead, else a lead id.
  const [navLead, setNavLead] = useState<string>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  // Reports whose client approval request is still unanswered — drives the red
  // dot on the Approvals tab.
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  // Who runs this brand — its Team Lead and APC, shown in the header. Either can
  // be null (unassigned, or the viewer's RLS hides that profile).
  const [owners, setOwners] = useState<{ lead: OwnerLite | null; apc: OwnerLite | null }>(
    { lead: null, apc: null },
  );

  const tabFromUrl = (params.get('tab') as TabKey) || 'resources';

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      const [
        { data: b, error: bErr }, { data: assigns }, { data: siblings },
        { data: wApprovals }, { data: mApprovals }, { data: decidedRows },
        { data: leadRows }, { data: apcRows },
        { data: allLeadBrands }, { data: allLeads },
      ] = await Promise.all([
        supabase.from('brands').select('id,name,client,client_id,share_enabled,client_status,currency,region,scope').eq('id', id).maybeSingle(),
        isApc
          ? supabase.from('apc_brands').select('brand_id').eq('apc_id', profile?.id ?? '').eq('brand_id', id ?? '')
          : isTeamLead
          ? supabase.from('team_lead_brands').select('brand_id').eq('team_lead_id', profile?.id ?? '').eq('brand_id', id ?? '')
          : isAdsManager
          ? supabase.from('ads_manager_brands').select('brand_id').eq('ads_manager_id', profile?.id ?? '').eq('brand_id', id ?? '')
          : Promise.resolve({ data: [] }),
        // RLS already scopes this to brands the user can see (Bob sees all,
        // APC sees their assigned brands).
        supabase.from('brands').select('id,name,client_status').order('name'),
        // Unanswered client-approval requests for the Approvals tab dot — pull
        // just each report's approval section (not the full content jsonb) and
        // the viewer-visible decisions, intersected below.
        supabase.from('weekly_reports').select('id,approval:content->approval').eq('brand_id', id ?? ''),
        supabase.from('monthly_reports').select('id,approval:content->approval').eq('brand_id', id ?? ''),
        supabase.from('report_approval_decisions').select('report_id'),
        // Brand ownership for the header chips.
        supabase.from('team_lead_brands').select('team_lead_id').eq('brand_id', id ?? ''),
        supabase.from('apc_brands').select('apc_id').eq('brand_id', id ?? ''),
        // Bob only: who owns each sibling brand + the Team Lead directory, for
        // the "walk one team's brands" arm of the nav filter. Everyone else sees
        // a single team's brands anyway, so the filter would be meaningless.
        isBob
          ? supabase.from('team_lead_brands').select('brand_id,team_lead_id')
          : Promise.resolve({ data: [] }),
        isBob
          ? supabase.from('profiles').select('id,email,full_name').eq('role', 'team_lead')
          : Promise.resolve({ data: [] }),
      ]);
      if (bErr) { setErr(bErr.message); setLoading(false); return; }
      if (!b) { setErr('Brand not found.'); setLoading(false); return; }
      setBrand(b as Brand);
      // Default the nav filter to this brand's category so prev/next walks its
      // peers — but keep a manual "All" or already-matching choice (e.g. while
      // walking within a category) instead of fighting the user.
      const st = ((b as Brand).client_status ?? 'in_progress') as ClientStatus;
      setNavStatus(prev => (prev === 'all' || prev === st) ? prev : st);
      setAssignedToMe(((assigns as any[])?.length ?? 0) > 0);
      // Resolve the owner ids to names + photos. RLS decides which profiles the
      // viewer may read, so anyone hidden simply doesn't get a chip.
      const leadId = (leadRows as any[])?.[0]?.team_lead_id ?? null;
      const apcId = (apcRows as any[])?.[0]?.apc_id ?? null;
      const ownerIds = [leadId, apcId].filter(Boolean) as string[];
      if (ownerIds.length === 0) {
        setOwners({ lead: null, apc: null });
      } else {
        const { data: people } = await supabase
          .from('profiles').select('id,email,full_name,avatar_url').in('id', ownerIds);
        const byId = new Map<string, OwnerLite>();
        (people ?? []).forEach((r: any) => byId.set(r.id, {
          id: r.id, name: r.full_name || r.email, avatar: r.avatar_url ?? null,
        }));
        setOwners({
          lead: leadId ? byId.get(leadId) ?? null : null,
          apc: apcId ? byId.get(apcId) ?? null : null,
        });
      }
      // Same rule as the Approvals tab / reporting lists: approval requested
      // (even past expires_at) and no decision recorded yet.
      const decidedIds = new Set(((decidedRows as any[]) ?? []).map(d => d.report_id));
      setPendingApprovalCount(
        [...((wApprovals as any[]) ?? []), ...((mApprovals as any[]) ?? [])]
          .filter(r => !decidedIds.has(r.id) && !!r.approval?.enabled).length,
      );
      const leadOfBrand = new Map<string, string>();
      ((allLeadBrands as any[]) ?? []).forEach(r => leadOfBrand.set(r.brand_id, r.team_lead_id));
      setLeadNames(new Map(((allLeads as any[]) ?? []).map(r => [r.id, r.full_name || r.email])));
      setSiblings(((siblings as any[]) ?? []).map(x => ({
        id: x.id, name: x.name, status: (x.client_status ?? 'in_progress') as ClientStatus,
        leadId: leadOfBrand.get(x.id) ?? null,
      })));
      setLoading(false);
    })();
  }, [id, isBob, isApc, isTeamLead, isAdsManager, profile?.id]);

  // Team Lead options for the filter (Bob only) — one per lead that actually
  // owns a visible brand, plus an "Unassigned" bucket. Counted within the active
  // status filter so the numbers match what the walk will do.
  const leadOptions = useMemo<{ leads: LeadOption[]; noneCount: number }>(() => {
    if (!isBob) return { leads: [], noneCount: 0 };
    const inStatus = navStatus === 'all' ? siblings : siblings.filter(s => s.status === navStatus);
    const map = new Map<string, LeadOption>();
    let noneCount = 0;
    inStatus.forEach(s => {
      if (!s.leadId) { noneCount++; return; }
      const e = map.get(s.leadId)
        ?? { id: s.leadId, name: leadNames.get(s.leadId) ?? 'Team Lead', count: 0 };
      e.count++; map.set(s.leadId, e);
    });
    // Keep the active selection listed even when the status filter leaves it
    // empty, so it still renders as checked (and can be switched off).
    if (navLead !== 'all' && navLead !== 'none' && !map.has(navLead)) {
      map.set(navLead, { id: navLead, name: leadNames.get(navLead) ?? 'Team Lead', count: 0 });
    }
    return {
      leads: Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)),
      noneCount,
    };
  }, [isBob, siblings, navStatus, navLead, leadNames]);

  const leadFilterLabel = navLead === 'all'
    ? 'All teams'
    : navLead === 'none' ? 'No Team Lead' : (leadNames.get(navLead) ?? 'Team Lead');

  // Brands that pass the active status + Team Lead filters, in alphabetical
  // order. Drives both the prev/next walk and the switcher list.
  const navList = useMemo(() => {
    let list = navStatus === 'all' ? siblings : siblings.filter(s => s.status === navStatus);
    if (navLead !== 'all') {
      list = list.filter(s => (s.leadId ?? 'none') === navLead);
    }
    return list;
  }, [siblings, navStatus, navLead]);

  // Compute prev / next neighbour within the filtered list. If the current brand
  // is outside the active filter, anchor by name so prev/next still jump into it.
  const { prevId, nextId, currentIdx, totalSiblings } = useMemo(() => {
    const total = navList.length;
    if (!id || total === 0) {
      return { prevId: null as string | null, nextId: null as string | null, currentIdx: -1, totalSiblings: total };
    }
    const idx = navList.findIndex(s => s.id === id);
    if (idx >= 0) {
      return {
        prevId: idx > 0 ? navList[idx - 1].id : null,
        nextId: idx < total - 1 ? navList[idx + 1].id : null,
        currentIdx: idx,
        totalSiblings: total,
      };
    }
    const curName = brand?.name ?? '';
    const after = navList.findIndex(s => s.name.localeCompare(curName) > 0);
    const insertAt = after === -1 ? total : after;
    return {
      prevId: insertAt > 0 ? navList[insertAt - 1].id : null,
      nextId: insertAt < total ? navList[insertAt].id : null,
      currentIdx: -1,
      totalSiblings: total,
    };
  }, [id, navList, brand?.name]);

  // Brands matching the dropdown search box (within the active status filter).
  const filteredSiblings = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    if (!q) return navList;
    return navList.filter(s => s.name.toLowerCase().includes(q));
  }, [navList, brandSearch]);

  // When the switcher opens, clear the query and focus the search box.
  useEffect(() => {
    if (!brandPickerOpen) return;
    setBrandSearch('');
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [brandPickerOpen]);

  const goToBrand = (brandId: string) => {
    setBrandPickerOpen(false);
    if (brandId !== id) nav(`/brands/${brandId}?tab=${currentTab}`);
  };

  const visibleTabs = useMemo(() => {
    if (isBob) return TABS;
    // Team Lead: APC-level access to their brands, minus the Bob-only Billing.
    if (isTeamLead) {
      if (!assignedToMe) return [];
      return TABS.filter(t => t.key !== 'billing');
    }
    // Ads Manager: view-only APC tab set (GMV Max always included — it's their
    // edit surface), minus the Bob-only Billing.
    if (isAdsManager) {
      if (!assignedToMe) return [];
      return TABS.filter(t => t.key !== 'billing');
    }
    if (!isApc || !assignedToMe) return [];
    return TABS.filter(t => {
      if (t.key === 'gmv-max') return canManageGmvMax;
      if (t.key === 'billing') return false; // Bob-only financial data
      return true;
    });
  }, [isBob, isApc, isTeamLead, isAdsManager, assignedToMe, canManageGmvMax]);

  const currentTab: TabKey = useMemo(() => {
    const fromUrl = visibleTabs.find(t => t.key === tabFromUrl);
    if (fromUrl) return fromUrl.key;
    return visibleTabs[0]?.key ?? 'resources';
  }, [visibleTabs, tabFromUrl]);

  const setTab = (k: TabKey) => {
    params.set('tab', k);
    setParams(params, { replace: true });
  };

  const onShareEnabledChanged = (next: boolean) =>
    setBrand(b => b ? { ...b, share_enabled: next } : b);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!brand) return null;

  if (visibleTabs.length === 0) {
    return (
      <Alert variant="warning">
        You don't have access to this brand's detail page. Ask Bob to assign you to it or grant the relevant permission.
      </Alert>
    );
  }

  // Brand is editable unless it is 'closed'. Onboarding / in-progress /
  // temporarily-paused all count as active/editable.
  const brandActive = brand.client_status !== 'closed';
  // Compose per-tab "can edit" flags by AND-ing role-based perms with brand active.
  // A Team Lead handles their assigned brands with APC-level edit rights.
  const tlAssigned = isTeamLead && assignedToMe;
  // Ads Manager's ONLY tab-level edit surface is GMV Max (RLS mirrors this).
  const amAssigned = isAdsManager && assignedToMe;
  const canEditResources = (isBob) && brandActive;
  const canEditGmvMax    = (isBob || canManageGmvMax || tlAssigned || amAssigned) && brandActive;
  const canEditSamples   = (isBob || (isApc && assignedToMe) || tlAssigned) && brandActive;
  const canEditProducts   = (isBob || (isApc && assignedToMe) || tlAssigned) && brandActive;
  // SOP: Bob + the brand's Team Lead write; APC / Ads Manager read (RLS mirrors this).
  const canEditSop       = (isBob || tlAssigned) && brandActive;
  // Reporting share toggles are Bob-only and require active brand.
  const canEditReporting = isBob && brandActive;

  return (
    <div className="ac-themed">
      <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
        <div className="d-flex align-items-start gap-2 ac-bd-head-left">
          <Button size="sm" variant="outline-secondary" className="ac-bd-back" onClick={() => nav('/brands')} title="Back to brands">
            <i className="bi bi-arrow-left" />
          </Button>
          <div className="ac-bd-ident">
            {/* Row 1: brand name + who runs it (Team Lead / APC) on the same line */}
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h2 className="mb-0">{brand.name}</h2>
              {owners.lead && (
                <span className="ac-owner-chip" title={`Team Lead: ${owners.lead.name}`}>
                  <Avatar name={owners.lead.name} src={owners.lead.avatar} size="sm" variant="dark" />
                  <span className="ac-owner-name">{owners.lead.name}</span>
                  <span className="ac-owner-role">TL</span>
                </span>
              )}
              {owners.apc && (
                <span className="ac-owner-chip" title={`APC: ${owners.apc.name}`}>
                  <Avatar name={owners.apc.name} src={owners.apc.avatar} size="sm" />
                  <span className="ac-owner-name">{owners.apc.name}</span>
                  <span className="ac-owner-role">APC</span>
                </span>
              )}
            </div>
            {/* Row 2: client + live status badges (small) */}
            <div className="text-muted small mt-1 d-flex align-items-center gap-2 flex-wrap">
              {brand.client && <span><i className="bi bi-building me-1" />{brand.client}</span>}
              {!brandActive && (
                <Badge bg="dark"><i className="bi bi-archive me-1" />Inactive</Badge>
              )}
              {brand.share_enabled
                ? <Badge bg="success"><i className="bi bi-globe me-1" />Sharing on</Badge>
                : <Badge bg="secondary"><i className="bi bi-lock me-1" />Sharing off</Badge>}
            </div>
            {/* Row 3: region ($/£/€) + compact scope tags */}
            <div className="d-flex align-items-center gap-2 flex-wrap mt-2">
              <RegionChip region={brand.region} size="sm" />
              {(Array.isArray(brand.scope) ? brand.scope : []).map(k => (
                <span key={k} className="ac-chip ac-chip-sm">
                  <i className={`bi ${SCOPE_ICON[k] ?? 'bi-tag'}`} /> {SCOPE_LABEL[k] ?? k}
                </span>
              ))}
            </div>
          </div>
        </div>
        

        {/* Brand switcher + prev / next navigation — keeps the current tab so
            you can walk through brands without losing context. The funnel filters
            the walk + switcher by status (defaults to In Progress). */}
        {siblings.length > 1 && (
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <Dropdown show={filterOpen} onToggle={(next) => setFilterOpen(next)} autoClose>
              <Dropdown.Toggle
                size="sm"
                variant={navStatus === 'all' && navLead === 'all' ? 'outline-secondary' : 'outline-primary'}
                id="brand-nav-filter"
                className="ac-brand-filter-toggle"
                title={`Filter brands: ${statusLabel(navStatus)}${isBob ? ` · ${leadFilterLabel}` : ''}`}
              >
                <i className="bi bi-funnel" />
              </Dropdown.Toggle>
              <Dropdown.Menu align="end" style={{ minWidth: 240, maxHeight: 420, overflowY: 'auto' }}>
                <Dropdown.Header>Show brands in next / prev</Dropdown.Header>
                {STATUS_FILTERS.map(f => (
                  <Dropdown.Item
                    key={f.key}
                    active={navStatus === f.key}
                    onClick={() => setNavStatus(f.key)}
                    className="d-flex align-items-center"
                  >
                    <i className={`bi ${f.icon} me-2`} />
                    <span className="flex-grow-1">{f.label}</span>
                    {navStatus === f.key && <i className="bi bi-check2 ms-2" />}
                  </Dropdown.Item>
                ))}
                {/* Second axis, Bob only: narrow the walk to one Team Lead's brands. */}
                {isBob && (leadOptions.leads.length > 0 || leadOptions.noneCount > 0) && (
                  <>
                    <Dropdown.Divider />
                    <Dropdown.Header>Team Lead</Dropdown.Header>
                    <Dropdown.Item
                      active={navLead === 'all'}
                      onClick={() => setNavLead('all')}
                      className="d-flex align-items-center"
                    >
                      <i className="bi bi-people me-2" />
                      <span className="flex-grow-1">All teams</span>
                      {navLead === 'all' && <i className="bi bi-check2 ms-2" />}
                    </Dropdown.Item>
                    {leadOptions.leads.map(l => (
                      <Dropdown.Item
                        key={l.id}
                        active={navLead === l.id}
                        onClick={() => setNavLead(l.id)}
                        className="d-flex align-items-center"
                      >
                        <i className="bi bi-person-badge me-2" />
                        <span className="flex-grow-1 text-truncate">{l.name}</span>
                        <span className="text-muted small ms-2">{l.count}</span>
                        {navLead === l.id && <i className="bi bi-check2 ms-2" />}
                      </Dropdown.Item>
                    ))}
                    {leadOptions.noneCount > 0 && (
                      <Dropdown.Item
                        active={navLead === 'none'}
                        onClick={() => setNavLead('none')}
                        className="d-flex align-items-center"
                      >
                        <i className="bi bi-dash-circle me-2" />
                        <span className="flex-grow-1">No Team Lead</span>
                        <span className="text-muted small ms-2">{leadOptions.noneCount}</span>
                        {navLead === 'none' && <i className="bi bi-check2 ms-2" />}
                      </Dropdown.Item>
                    )}
                  </>
                )}
              </Dropdown.Menu>
            </Dropdown>
            <Dropdown
              show={brandPickerOpen}
              onToggle={(next) => setBrandPickerOpen(next)}
              autoClose="outside"
            >
              <Dropdown.Toggle
                size="sm" variant="outline-secondary" id="brand-switcher"
                className="text-truncate" style={{ maxWidth: 220 }}
                title="Switch brand"
              >
                <i className="bi bi-shop me-1" />Switch brand
              </Dropdown.Toggle>
              <Dropdown.Menu
                renderOnMount
                style={{ minWidth: 280, maxHeight: 360, overflowY: 'auto' }}
              >
                <div className="position-sticky top-0 bg-white px-2 pb-2" style={{ zIndex: 1 }}>
                  <Form.Control
                    ref={searchRef}
                    size="sm"
                    placeholder="Search brands…"
                    value={brandSearch}
                    onChange={e => setBrandSearch(e.target.value)}
                    onKeyDown={e => e.stopPropagation()}
                  />
                </div>
                {(navStatus !== 'all' || navLead !== 'all') && (
                  <div className="d-flex align-items-center justify-content-between px-3 pb-1 gap-2">
                    <span className="text-muted small text-truncate">
                      <i className="bi bi-funnel me-1" />
                      {navStatus !== 'all' && statusLabel(navStatus)}
                      {navStatus !== 'all' && navLead !== 'all' && ' · '}
                      {navLead !== 'all' && leadFilterLabel}
                    </span>
                    <Button variant="link" size="sm" className="p-0 small text-nowrap"
                      onClick={() => { setNavStatus('all'); setNavLead('all'); }}>
                      Show all
                    </Button>
                  </div>
                )}
                {filteredSiblings.length === 0 ? (
                  <div className="text-muted small px-3 py-2">
                    {brandSearch.trim()
                      ? 'No brands match.'
                      : navLead !== 'all'
                        ? `No ${navStatus === 'all' ? '' : `${statusLabel(navStatus).toLowerCase()} `}brands under ${leadFilterLabel}.`
                        : `No ${statusLabel(navStatus).toLowerCase()} brands.`}
                  </div>
                ) : (
                  filteredSiblings.map(s => (
                    <Dropdown.Item
                      key={s.id}
                      active={s.id === id}
                      onClick={() => goToBrand(s.id)}
                      className="text-truncate"
                    >
                      {s.name}
                    </Dropdown.Item>
                  ))
                )}
              </Dropdown.Menu>
            </Dropdown>
            <Button
              size="sm" variant="outline-secondary"
              disabled={!prevId}
              onClick={() => prevId && nav(`/brands/${prevId}?tab=${currentTab}`)}
              title="Previous brand">
              <i className="bi bi-chevron-left" /> Prev
            </Button>
            <span
              className="text-muted small"
              style={{ minWidth: 60, textAlign: 'center' }}
              title={currentIdx < 0 ? 'Current brand is outside the active filter' : undefined}
            >
              {currentIdx >= 0 ? currentIdx + 1 : '–'} / {totalSiblings}
            </span>
            <Button
              size="sm" variant="outline-secondary"
              disabled={!nextId}
              onClick={() => nextId && nav(`/brands/${nextId}?tab=${currentTab}`)}
              title="Next brand">
              Next <i className="bi bi-chevron-right" />
            </Button>
          </div>
        )}
      </div>

      {!brandActive && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill" />
          <div>
            <strong>This brand is inactive.</strong>{' '}
            All data is read-only — reports, sample seeding, paid collab, GMV Max and resources can't be edited until the brand is reactivated from the Brands list.
          </div>
        </Alert>
      )}

      <Card className="mb-3">
        <Card.Body className="py-2">
          <Nav variant="tabs" activeKey={currentTab} onSelect={(k) => k && setTab(k as TabKey)}>
            {visibleTabs.map(t => (
              <Nav.Item key={t.key}>
                <Nav.Link eventKey={t.key}>
                  <i className={`bi ${t.icon} me-1`} />{t.label}
                  {t.key === 'approvals' && pendingApprovalCount > 0 && (
                    <span
                      className="ac-tab-dot"
                      title={`${pendingApprovalCount} report${pendingApprovalCount === 1 ? '' : 's'} awaiting the client's decision`}
                    />
                  )}
                </Nav.Link>
              </Nav.Item>
            ))}
          </Nav>
        </Card.Body>
      </Card>

      {currentTab === 'resources'   && <BrandResourcesTab brandId={brand.id} brandName={brand.name} canEdit={canEditResources} />}
      {currentTab === 'sop'         && <BrandSopTab brandId={brand.id} brandName={brand.name} canEdit={canEditSop} />}
      {currentTab === 'reporting'   && <BrandReportingTab brand={brand} isBob={isBob} canEdit={canEditReporting} onShareEnabledChanged={onShareEnabledChanged} />}
      {currentTab === 'approvals'   && <BrandApprovalsTab brandId={brand.id} brandName={brand.name} />}
      {currentTab === 'gmv-max'     && <BrandGmvMaxTab brandId={brand.id} canEdit={canEditGmvMax} currency={brand.currency} />}
      {currentTab === 'samples'     && <BrandSamplesTab brandId={brand.id} canEdit={canEditSamples} currency={brand.currency} />}
      {currentTab === 'products'    && <BrandProductsTab brandId={brand.id} canEdit={canEditProducts} />}
      {currentTab === 'billing'     && <BrandBillingTab brandId={brand.id} />}
    </div>
  );
}
