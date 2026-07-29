import { FormEvent, useEffect, useState } from 'react';
import { Card, Button, Modal, Form, Spinner, Alert, Table, InputGroup } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { BrandProduct } from '../../lib/brandProducts';
import NumberInput from '../../components/NumberInput';

interface Props {
  brandId: string;
  canEdit: boolean;
}

const blankForm = () => ({
  name: '',
  external_product_id: '',
  tiktok_link: '',
  standard_commission: 0,
  shop_ads_commission: 0,
  shop_ads_commission_not_set: false,
});

export default function BrandProductsTab({ brandId, canEdit }: Props) {
  const [products, setProducts] = useState<BrandProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<BrandProduct | null>(null);
  const [form, setForm] = useState(blankForm());
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase
      .from('brand_products')
      .select('*')
      .eq('brand_id', brandId)
      .order('name');
    if (error) { setErr(error.message); setLoading(false); return; }
    setProducts((data as BrandProduct[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [brandId]);

  const openAdd = () => {
    setEditing(null);
    setForm(blankForm());
    setFormErr(null);
    setShow(true);
  };

  const openEdit = (p: BrandProduct) => {
    setEditing(p);
    setForm({
      name: p.name,
      external_product_id: p.external_product_id ?? '',
      tiktok_link: p.tiktok_link ?? '',
      standard_commission: Number(p.standard_commission ?? 0),
      shop_ads_commission: Number(p.shop_ads_commission ?? 0),
      shop_ads_commission_not_set: !!p.shop_ads_commission_not_set,
    });
    setFormErr(null);
    setShow(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr(null);
    try {
      const payload = {
        brand_id: brandId,
        name: form.name.trim(),
        external_product_id: form.external_product_id.trim() || null,
        tiktok_link: form.tiktok_link.trim() || null,
        standard_commission: Number.isFinite(form.standard_commission) ? form.standard_commission : 0,
        shop_ads_commission_not_set: form.shop_ads_commission_not_set,
        shop_ads_commission: form.shop_ads_commission_not_set
          ? 0
          : (Number.isFinite(form.shop_ads_commission) ? form.shop_ads_commission : 0),
      };
      if (editing) {
        const { data, error } = await supabase.from('brand_products')
          .update(payload).eq('id', editing.id).select('*').single();
        if (error) throw error;
        setProducts(products.map(p => p.id === editing.id ? (data as BrandProduct) : p));
      } else {
        const { data, error } = await supabase.from('brand_products')
          .insert(payload).select('*').single();
        if (error) throw error;
        setProducts([...products, data as BrandProduct].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setShow(false);
    } catch (e: any) {
      setFormErr(e?.message ?? 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: BrandProduct) => {
    if (!confirm(`Delete "${p.name}"? It will be removed from all programs and any videos referencing it will lose the link.`)) return;
    const { error } = await supabase.from('brand_products').delete().eq('id', p.id);
    if (error) { alert(error.message); return; }
    setProducts(products.filter(x => x.id !== p.id));
  };

  if (loading) return <div className="text-center py-4"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  return (
    <>
      <Card className="mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <span className="fw-semibold">Brand Products</span>
            <small className="text-muted ms-2">
              Catalog of products for this brand — paid creator programs pick from this list.
            </small>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openAdd}>
              <i className="bi bi-plus-lg me-1" /> Add Product
            </Button>
          )}
        </Card.Header>
        <Card.Body className="p-0">
          {products.length === 0 ? (
            <p className="text-muted text-center py-4 mb-0">No products yet for this brand.</p>
          ) : (
            <Table responsive size="sm" className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Product ID</th>
                  <th>TikTok link</th>
                  <th>Standard %</th>
                  <th>Shop ads %</th>
                  {canEdit && <th style={{ width: 100 }}></th>}
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td className="fw-semibold">{p.name}</td>
                    <td className="text-muted small" style={{ fontFamily: 'monospace' }}>
                      {p.external_product_id || '—'}
                    </td>
                    <td className="small">
                      {p.tiktok_link
                        ? <a href={p.tiktok_link} target="_blank" rel="noreferrer">
                            <i className="bi bi-tiktok me-1" />Open
                          </a>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="small">{Number(p.standard_commission ?? 0)}%</td>
                    <td className="small">
                      {p.shop_ads_commission_not_set
                        ? <span className="text-muted">Not set</span>
                        : `${Number(p.shop_ads_commission ?? 0)}%`}
                    </td>
                    {canEdit && (
                      <td className="text-end">
                        <Button size="sm" variant="outline-primary" className="me-1" onClick={() => openEdit(p)}>
                          <i className="bi bi-pencil" />
                        </Button>
                        <Button size="sm" variant="outline-danger" onClick={() => remove(p)}>
                          <i className="bi bi-trash" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Modal show={show} onHide={() => setShow(false)} centered scrollable>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editing ? 'Edit Product' : 'Add Product'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {formErr && <Alert variant="danger">{formErr}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label className="small fw-semibold">Product name *</Form.Label>
              <Form.Control
                required
                value={form.name}
                placeholder="e.g. Garbage Puck — 4 pack"
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label className="small fw-semibold">Product ID</Form.Label>
              <Form.Control
                value={form.external_product_id}
                placeholder="e.g. 1729401883758137709"
                style={{ fontFamily: 'monospace' }}
                onChange={e => setForm({ ...form, external_product_id: e.target.value })}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label className="small fw-semibold">TikTok link</Form.Label>
              <Form.Control
                type="url"
                value={form.tiktok_link}
                placeholder="https://www.tiktok.com/@brand/product/…"
                onChange={e => setForm({ ...form, tiktok_link: e.target.value })}
              />
            </Form.Group>

            <hr className="my-3" />
            <div className="fw-semibold small text-muted mb-2 text-uppercase" style={{ letterSpacing: '.4px' }}>
              Commission
            </div>

            <Form.Group className="mb-3">
              <Form.Label className="small fw-semibold">Standard commission</Form.Label>
              <InputGroup>
                <NumberInput
                  min={0} step="0.01"
                  value={form.standard_commission}
                  placeholder="e.g. 10"
                  onChange={n => setForm({ ...form, standard_commission: n })}
                />
                <InputGroup.Text>%</InputGroup.Text>
              </InputGroup>
            </Form.Group>

            <Form.Group className="mb-3">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <Form.Label className="small fw-semibold mb-0">Shop ads commission</Form.Label>
                <Form.Check
                  type="switch"
                  id="shop-ads-not-set"
                  label="Not set"
                  checked={form.shop_ads_commission_not_set}
                  onChange={e => setForm({ ...form, shop_ads_commission_not_set: e.target.checked })}
                />
              </div>
              <InputGroup>
                <NumberInput
                  min={0} step="0.01"
                  value={form.shop_ads_commission}
                  placeholder="e.g. 5"
                  disabled={form.shop_ads_commission_not_set}
                  onChange={n => setForm({ ...form, shop_ads_commission: n })}
                />
                <InputGroup.Text>%</InputGroup.Text>
              </InputGroup>
              {form.shop_ads_commission_not_set && (
                <Form.Text className="text-muted">
                  Shop ads commission is marked “Not set” — no value will be recorded.
                </Form.Text>
              )}
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>
              {busy ? 'Saving…' : (editing ? 'Save' : 'Add Product')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
