import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Spinner, Alert, Button, Badge, Modal, Form, InputGroup, Row, Col,
} from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import {
  ReportTemplate, ReportKind, EMPTY_SCHEMA, parseTemplateRow,
} from '../../lib/reportingCanvas';

const KIND_META: Record<ReportKind, { label: string; color: string; icon: string }> = {
  weekly:  { label: 'Weekly',  color: '#2563eb', icon: 'bi-calendar-week' },
  monthly: { label: 'Monthly', color: '#14b8a6', icon: 'bi-calendar-month' },
  custom:  { label: 'Custom',  color: '#6366f1', icon: 'bi-stars' },
};

export default function ReportingCanvasList() {
  const { profile } = useAuth();
  const isBob = profile?.role === 'bob';
  const nav = useNavigate();

  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | ReportKind>('all');

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newKind, setNewKind] = useState<ReportKind>('weekly');
  const [newGlobal, setNewGlobal] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase
      .from('report_templates')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) { setErr(error.message); setLoading(false); return; }
    setTemplates((data ?? []).map(parseTemplateRow));
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter(t => {
      if (kindFilter !== 'all' && t.report_kind !== kindFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [templates, search, kindFilter]);

  const createTemplate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true); setCreateErr(null);
    const { data, error } = await supabase.from('report_templates').insert({
      name: newName.trim(),
      description: newDesc.trim() || null,
      report_kind: newKind,
      is_global: newGlobal,
      schema_json: EMPTY_SCHEMA,
    }).select('*').single();
    setCreating(false);
    if (error) { setCreateErr(error.message); return; }
    const tpl = parseTemplateRow(data);
    setTemplates(prev => [tpl, ...prev]);
    setShowNew(false);
    setNewName(''); setNewDesc(''); setNewKind('weekly'); setNewGlobal(true);
    nav(`/templates/${tpl.id}`);
  };

  const remove = async (t: ReportTemplate) => {
    if (!confirm(`Delete the template "${t.name}"? This can't be undone.`)) return;
    const prev = templates;
    setTemplates(templates.filter(x => x.id !== t.id));
    const { error } = await supabase.from('report_templates').delete().eq('id', t.id);
    if (error) { alert(error.message); setTemplates(prev); }
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  return (
    <div className="ac-themed">
      <div className="ac-page-header d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
        <div>
          <h2 className="mb-1">
            <i className="bi bi-easel2 me-2 text-warning" />
            Reporting Canvas
          </h2>
          <div className="text-muted">
            Design custom report templates with a visual drag-and-drop canvas. Templates can be
            global or assigned to specific brands.
          </div>
        </div>
        {isBob && (
          <Button onClick={() => setShowNew(true)}>
            <i className="bi bi-plus-lg me-1" />New template
          </Button>
        )}
      </div>

      <Card className="mb-3">
        <Card.Body className="py-2">
          <Row className="g-2 align-items-center">
            <Col md>
              <InputGroup size="sm">
                <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
                <Form.Control
                  placeholder="Search templates…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <Button variant="outline-secondary" onClick={() => setSearch('')}>
                    <i className="bi bi-x-lg" />
                  </Button>
                )}
              </InputGroup>
            </Col>
            <Col md="auto">
              <Form.Select size="sm" value={kindFilter} onChange={e => setKindFilter(e.target.value as any)}>
                <option value="all">All kinds</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom</option>
              </Form.Select>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {filtered.length === 0 ? (
        <Card body className="text-center py-5 text-muted">
          <i className="bi bi-easel fs-1 d-block mb-2 opacity-50" />
          {templates.length === 0
            ? 'No templates yet.'
            : 'No templates match your filters.'}
          {isBob && templates.length === 0 && (
            <div className="mt-3">
              <Button onClick={() => setShowNew(true)}>
                <i className="bi bi-plus-lg me-1" />Create your first template
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Row className="g-3">
          {filtered.map(t => {
            const meta = KIND_META[t.report_kind];
            const blockCount = t.schema_json?.blocks?.length ?? 0;
            return (
              <Col md={6} lg={4} key={t.id}>
                <Card
                  className="h-100 shadow-sm"
                  role="button"
                  onClick={() => nav(`/templates/${t.id}`)}
                  style={{ cursor: 'pointer', transition: 'transform .15s, box-shadow .15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,.08)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                >
                  <Card.Body className="d-flex flex-column">
                    <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                      <div className="flex-grow-1 min-w-0">
                        <div className="fw-bold text-truncate">{t.name}</div>
                        {t.description && (
                          <div className="text-muted small text-truncate">{t.description}</div>
                        )}
                      </div>
                      <Badge bg="" style={{ backgroundColor: meta.color }}>
                        <i className={`bi ${meta.icon} me-1`} />{meta.label}
                      </Badge>
                    </div>
                    <div className="d-flex gap-2 flex-wrap small mt-2">
                      {t.is_global && (
                        <Badge bg="warning" text="dark">
                          <i className="bi bi-globe me-1" />Global
                        </Badge>
                      )}
                      <Badge bg="light" text="dark" className="border">
                        <i className="bi bi-stack me-1" />{blockCount} block{blockCount === 1 ? '' : 's'}
                      </Badge>
                    </div>
                    <div className="text-muted small mt-2">
                      Updated {new Date(t.updated_at).toLocaleDateString()}
                    </div>
                    {isBob && (
                      <div className="mt-auto pt-3 border-top d-flex justify-content-end gap-2">
                        <Button size="sm" variant="outline-primary"
                          onClick={(e) => { e.stopPropagation(); nav(`/templates/${t.id}`); }}>
                          <i className="bi bi-pencil-square me-1" />Edit
                        </Button>
                        <Button size="sm" variant="outline-danger"
                          onClick={(e) => { e.stopPropagation(); remove(t); }}>
                          <i className="bi bi-trash" />
                        </Button>
                      </div>
                    )}
                  </Card.Body>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* New template modal */}
      <Modal show={showNew} onHide={() => setShowNew(false)} centered>
        <Form onSubmit={createTemplate}>
          <Modal.Header closeButton>
            <Modal.Title>
              <i className="bi bi-easel2 me-2 text-warning" />New template
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {createErr && <Alert variant="danger" className="py-2">{createErr}</Alert>}
            <Form.Group className="mb-2">
              <Form.Label className="fw-bold">Name *</Form.Label>
              <Form.Control required value={newName}
                placeholder="e.g. Premium brand weekly report"
                onChange={e => setNewName(e.target.value)}
                autoFocus />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label className="fw-bold">Description</Form.Label>
              <Form.Control as="textarea" rows={2} value={newDesc}
                placeholder="What is this template for?"
                onChange={e => setNewDesc(e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label className="fw-bold">Report kind</Form.Label>
              <Form.Select value={newKind} onChange={e => setNewKind(e.target.value as ReportKind)}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom (not tied to a cadence)</option>
              </Form.Select>
              <Form.Text className="text-muted">
                Determines which report-creation flow can pick this template.
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-1">
              <Form.Check type="switch" id="tpl-global"
                checked={newGlobal}
                onChange={e => setNewGlobal(e.target.checked)}
                label={
                  <span>
                    <i className="bi bi-globe me-1 text-warning" />
                    <strong>Global template</strong>
                    <span className="text-muted ms-2 small">
                      — available to every brand. Otherwise you'll link it to specific brands.
                    </span>
                  </span>
                } />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowNew(false)} disabled={creating}>Cancel</Button>
            <Button type="submit" disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create & open'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  );
}
