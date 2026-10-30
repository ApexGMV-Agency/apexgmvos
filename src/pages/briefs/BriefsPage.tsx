import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Form, Spinner } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import BrandBriefsTab from '../brand/BrandBriefsTab';
import './briefs.css';

interface BrandLite { id: string; name: string; client_status: string | null; briefs: number; }

/**
 * /briefs — every brand's content briefs in one place: a brand rail (RLS
 * already limits it to the caller's brands) plus the same view as the Brand
 * Detail → Briefs tab. ?brand=<id> picks the brand.
 */
export default function BriefsPage() {
  const { profile } = useAuth();
  const isBob = profile?.role === 'bob';
  const [params, setParams] = useSearchParams();
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [leadBrands, setLeadBrands] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [b, cb, tl] = await Promise.all([
        supabase.from('brands').select('id,name,client_status').order('name'),
        supabase.from('content_briefs').select('brand_id'),
        profile?.role === 'team_lead'
          ? supabase.from('team_lead_brands').select('brand_id').eq('team_lead_id', profile.id)
          : Promise.resolve({ data: [] as { brand_id: string }[], error: null }),
      ]);
      if (b.error) { setErr(b.error.message); setLoading(false); return; }
      const counts = new Map<string, number>();
      for (const r of (cb.data ?? []) as { brand_id: string }[]) counts.set(r.brand_id, (counts.get(r.brand_id) ?? 0) + 1);
      setBrands((b.data ?? []).map((r: any) => ({ ...r, briefs: counts.get(r.id) ?? 0 })));
      setLeadBrands(new Set(((tl.data as any[]) ?? []).map(r => r.brand_id)));
      setLoading(false);
    })();
  }, [profile?.id, profile?.role]);

  const selectedId = params.get('brand') ?? brands[0]?.id ?? null;
  const selected = brands.find(b => b.id === selectedId) ?? null;
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? brands.filter(b => b.name.toLowerCase().includes(t)) : brands;
  }, [brands, q]);

  const pick = (id: string) => { params.set('brand', id); setParams(params, { replace: true }); };
  // Keep the rail's count in step with what the explorer just loaded.
  const onCount = useCallback((n: number) => {
    if (!selectedId) return;
    setBrands(bs => bs.map(b => (b.id === selectedId && b.briefs !== n ? { ...b, briefs: n } : b)));
  }, [selectedId]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  // Same rule as the Brand Detail tab: Bob + the brand's Team Lead, brand not closed.
  const canEdit = !!selected && selected.client_status !== 'closed' && (isBob || leadBrands.has(selected.id));

  return (
    <div className="ac-themed ac-briefs-page">
      <aside className="ac-briefs-rail">
        <h2>Content Briefs</h2>
        <Form.Control size="sm" placeholder="Search brands…" value={q} onChange={e => setQ(e.target.value)} />
        <ul>
          {shown.map(b => (
            <li key={b.id}>
              <button type="button" className={b.id === selectedId ? 'active' : ''} onClick={() => pick(b.id)}>
                <span className="text-truncate">{b.name}</span>
                {b.briefs > 0
                  ? <span className="ac-briefs-count" title={`${b.briefs} brief${b.briefs === 1 ? '' : 's'}`}>{b.briefs}</span>
                  : <i className="bi bi-file-earmark ac-briefs-none" title="No briefs yet" />}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="text-muted small px-2">No brands match.</li>}
        </ul>
      </aside>
      <section className="ac-briefs-main-col">
        {selected
          ? (
            <>
              <h1 className="ac-briefs-title">{selected.name}</h1>
              <BrandBriefsTab brandId={selected.id} brandName={selected.name} canEdit={canEdit} onCountChange={onCount} />
            </>
          )
          : <Alert variant="secondary">No brands to show.</Alert>}
      </section>
    </div>
  );
}
