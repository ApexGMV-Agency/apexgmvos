import { Row, Col, Form, Table, Button, Badge } from 'react-bootstrap';
import { SectionDef, SectionField, ScalarData, RowData, fieldValue, formatValue } from '../../lib/reportSchemaV2';
import NumField from '../NumField';

// Currency/decimal fields step by cents; counts step by 1.
function stepFor(f: SectionField): string {
  return f.format === 'currency' || f.format === 'ratio' || f.format === 'score' || f.format === 'decimal' || f.format === 'percent'
    ? '0.01' : '1';
}
function unitHint(f: SectionField): string {
  switch (f.format) {
    case 'currency': return '($)';
    case 'percent': return '(%)';
    case 'ratio': return '(x)';
    case 'score': return '(/5)';
    default: return '';
  }
}

function AutoCell({ f, vals }: { f: SectionField; vals: Record<string, any> }) {
  return (
    <>
      <Form.Label className="small d-flex justify-content-between align-items-center mb-1">
        <span>{f.label}</span>
        <Badge bg="light" text="secondary" className="border" title={f.formula}>auto</Badge>
      </Form.Label>
      <div className="form-control bg-light fw-semibold" style={{ cursor: 'default' }}>
        {formatValue(f.format, fieldValue(f, vals))}
      </div>
      {f.formula && <Form.Text className="text-muted" style={{ fontSize: '.72rem' }}>{f.formula}</Form.Text>}
    </>
  );
}

/** Scalar section: a grid of manual number inputs + read-only auto fields. */
export function ScalarSectionBody({ def, data, onField }: {
  def: SectionDef;
  data: ScalarData;
  onField: (key: string, v: number | null) => void;
}) {
  return (
    <Row className="g-3">
      {def.fields.map(f => {
        if (f.format === 'bool') return null;   // booleans handled by special sections
        return (
          <Col md={f.col ?? 3} key={f.key}>
            {f.auto ? (
              <AutoCell f={f} vals={data} />
            ) : (
              <>
                <Form.Label className="small fw-semibold">{f.label} {unitHint(f)}</Form.Label>
                <NumField step={stepFor(f)} value={(data?.[f.key] as number | null) ?? null}
                  onChange={n => onField(f.key, n)} />
              </>
            )}
          </Col>
        );
      })}
    </Row>
  );
}

/** Table section: editable rows. `fixed` locks row count + the label column. */
export function TableSectionBody({ def, rows, onCell, onAddRow, onDelRow, fixed }: {
  def: SectionDef;
  rows: RowData[];
  onCell: (i: number, key: string, v: any) => void;
  onAddRow: () => void;
  onDelRow: (i: number) => void;
  fixed?: boolean;
}) {
  const labelKey = def.labelKey;
  return (
    <>
      <div className="table-responsive">
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            {def.fields.map(f => (
              <th key={f.key} className={f.format === 'text' || f.format === 'url' ? '' : 'text-end'}
                  style={{ whiteSpace: 'nowrap' }}>
                {f.label}{f.auto && <i className="bi bi-calculator ms-1 text-muted" title={f.formula} />}
              </th>
            ))}
            {!fixed && <th style={{ width: 44 }} />}
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={def.fields.length + 1} className="text-muted text-center py-3 small">
                No rows yet — click “Add row”.
              </td></tr>
            ) : rows.map((row, i) => (
              <tr key={i}>
                {def.fields.map(f => {
                  if (f.auto) {
                    return <td key={f.key} className="text-end text-muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatValue(f.format, fieldValue(f, row))}
                    </td>;
                  }
                  if (fixed && f.key === labelKey) {
                    return <td key={f.key} className="fw-semibold" style={{ whiteSpace: 'nowrap' }}>{String(row[f.key] ?? '')}</td>;
                  }
                  if (f.format === 'text' || f.format === 'url') {
                    return <td key={f.key} style={{ minWidth: f.format === 'url' ? 200 : 130 }}>
                      <Form.Control size="sm" placeholder={f.format === 'url' ? 'https://…' : ''}
                        value={String(row[f.key] ?? '')} onChange={e => onCell(i, f.key, e.target.value)} />
                    </td>;
                  }
                  return <td key={f.key} style={{ minWidth: 96 }}>
                    <NumField size="sm" step={stepFor(f)} value={(row[f.key] as number | null) ?? null}
                      onChange={n => onCell(i, f.key, n)} />
                  </td>;
                })}
                {!fixed && <td>
                  <Button size="sm" variant="outline-danger" onClick={() => onDelRow(i)}><i className="bi bi-trash" /></Button>
                </td>}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      {!fixed && (
        <div className="mt-2">
          <Button size="sm" variant="outline-primary" onClick={onAddRow}><i className="bi bi-plus-lg me-1" />Add row</Button>
        </div>
      )}
    </>
  );
}
