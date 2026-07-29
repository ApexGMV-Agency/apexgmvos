import { useEffect, useState } from 'react';
import { Form, Spinner, Badge } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { ReportTemplate, ReportKind, parseTemplateRow } from '../../lib/reportingCanvas';

interface Props {
  reportKind: ReportKind;
  brandId?: string | null;
  value: string | null;            // selected template id
  onChange: (templateId: string | null) => void;
  label?: string;
}

/**
 * Compact picker for slotting into report-creation modals. Lists every
 * template that's global OR linked to the given brand for this report kind.
 * Defaults to "Default layout" (no template) — keeping the legacy flow.
 */
export default function TemplatePicker({
  reportKind, brandId, value, onChange, label = 'Template',
}: Props) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let q = supabase.from('report_templates').select('*').eq('report_kind', reportKind);
      const { data, error } = await q;
      if (error) { setLoading(false); return; }
      const parsed = (data ?? []).map(parseTemplateRow);
      // RLS already filters templates the user can see, but we still need to
      // limit to global + this-brand templates (RLS allows brand-linked
      // templates that the user can access; we further filter to THIS brand).
      let scoped = parsed.filter(t => t.is_global);
      if (brandId) {
        const { data: links } = await supabase
          .from('report_template_brands')
          .select('template_id').eq('brand_id', brandId);
        const linkedIds = new Set(((links ?? []) as any[]).map(r => r.template_id));
        const brandLinked = parsed.filter(t => linkedIds.has(t.id));
        // Merge dedupe
        const merged = [...scoped, ...brandLinked.filter(t => !scoped.find(s => s.id === t.id))];
        scoped = merged;
      }
      setTemplates(scoped);
      setLoading(false);
    })();
  }, [reportKind, brandId]);

  return (
    <Form.Group className="mb-2">
      <Form.Label className="small fw-bold">
        <i className="bi bi-easel2 me-1 text-warning" />{label}
      </Form.Label>
      {loading ? (
        <div className="small text-muted"><Spinner animation="border" size="sm" className="me-1" />Loading templates…</div>
      ) : (
        <>
          <Form.Select size="sm" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">Default layout (no template)</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{t.is_global ? ' · global' : ''}
              </option>
            ))}
          </Form.Select>
          {value && (
            <div className="small text-muted mt-1">
              <Badge bg="info"><i className="bi bi-stars me-1" />Canvas template will overlay this report.</Badge>
            </div>
          )}
          {templates.length === 0 && (
            <div className="small text-muted mt-1">
              No canvas templates available for {reportKind} reports yet.
            </div>
          )}
        </>
      )}
    </Form.Group>
  );
}
