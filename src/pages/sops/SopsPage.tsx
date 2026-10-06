import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Form, Spinner } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import SopDocPane from './SopDocPane';

interface BrandLite { id: string; name: string; client_status: string | null; hasSop: boolean; }

/**
 * /sops — cross-brand overview (URL only, no sidebar link): a brand rail plus
 * the same document pane as the Brand Detail tab. The pane is deliberately
 * NOT keyed by brand — see SopDocPane.
 */
export default function SopsPage() {
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
      const [b, s, tl] = await Promise.all([
        supabase.from('brands').select('id,name,client_status').order('name'),
        supabase.from('brand_sops').select('brand_id'),
        profile?.role === 'team_lead'
          ? supabase.from('team_lead_brands').select('brand_id').eq('team_lead_id', profile.id)
          : Promise.resolve({ data: [] as { brand_id: string }[], error: null }),
      ]);
      if (b.error) { setErr(b.error.message); setLoading(false); return; }
      const withSop = new Set((s.data ?? []).map((r: any) => r.brand_id));
      setBrands((b.data ?? []).map((r: any) => ({ ...r, hasSop: withSop.has(r.id) })));
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

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  const canEdit = !!selected && selected.client_status !== 'closed' && (isBob || leadBrands.has(selected.id));

  return (
    <div className="ac-themed ac-sops-page">
      <aside className="ac-sops-rail">
        <h2>SOPs</h2>
        <Form.Control size="sm" placeholder="Search brands…" value={q} onChange={e => setQ(e.target.value)} />
        <ul>
          {shown.map(b => (
            <li key={b.id}>
              <button type="button" className={b.id === selectedId ? 'active' : ''} onClick={() => pick(b.id)}>
                <span className="text-truncate">{b.name}</span>
                {b.hasSop
                  ? <i className="bi bi-journal-check" title="Has an SOP" />
                  : <i className="bi bi-journal ac-sops-none" title="No SOP yet" />}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="text-muted small px-2">No brands match.</li>}
        </ul>
      </aside>
      <section className="ac-sops-doc">
        {selected
          ? <SopDocPane brandId={selected.id} brandName={selected.name} canEdit={canEdit} />
          : <Alert variant="secondary">No brands to show.</Alert>}
      </section>
    </div>
  );
}
