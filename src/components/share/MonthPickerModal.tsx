import { useMemo } from 'react';
import { Modal, Button, Row, Col } from 'react-bootstrap';

interface Props {
  show: boolean;
  /** All reports across all visible brands, used to know which months have data. */
  monthsWithData: Set<string>;  // 'YYYY-MM' set
  selectedMonth: string;
  onPick: (month: string) => void;
  onClose: () => void;
}

function fmtMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}
function shiftMonth(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MonthPickerModal({ show, monthsWithData, selectedMonth, onPick, onClose }: Props) {
  const current = thisMonth();
  const lastMonth = shiftMonth(current, -1);
  const twoAgo = shiftMonth(current, -2);

  // Calendar grid: previous 12 months in chronological order (oldest → newest).
  const calendar = useMemo(() => {
    const arr: string[] = [];
    for (let i = 11; i >= 0; i--) arr.push(shiftMonth(current, -i));
    return arr;
  }, [current]);

  const QuickPick = ({ ym, label }: { ym: string; label: string }) => {
    const has = monthsWithData.has(ym);
    const active = ym === selectedMonth;
    return (
      <button
        type="button"
        onClick={() => onPick(ym)}
        className={`ac-month-quickpick ${active ? 'active' : ''} ${has ? '' : 'empty'}`}
      >
        <div className="ac-month-label small text-uppercase">{label}</div>
        <div className="ac-month-value">{fmtMonth(ym)}</div>
        <div className="ac-month-note small">
          {has ? 'Reports available' : 'No reports'}
        </div>
      </button>
    );
  };

  return (
    <Modal show={show} onHide={onClose} centered backdrop="static" dialogClassName="ac-popup-modal">
      <Modal.Header className="ac-popup-header">
        <Modal.Title>
          <i className="bi bi-calendar3 me-2" />
          Choose a month to view
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="ac-popup-body">
        <p className="text-muted mb-3">Pick a month to filter the reports you'll see.</p>

        <Row className="g-3 mb-4">
          <Col md={4}><QuickPick ym={current}   label="This month" /></Col>
          <Col md={4}><QuickPick ym={lastMonth} label="Last month" /></Col>
          <Col md={4}><QuickPick ym={twoAgo}    label="Two months ago" /></Col>
        </Row>

        <div className="ac-section-title small text-uppercase text-muted mb-2">Or pick another month</div>
        <div className="ac-month-grid">
          {calendar.map(ym => {
            const has = monthsWithData.has(ym);
            const active = ym === selectedMonth;
            const [y, m] = ym.split('-').map(Number);
            const isJan = m === 1;
            return (
              <button
                key={ym}
                type="button"
                onClick={() => onPick(ym)}
                className={`ac-month-cell ${active ? 'active' : ''} ${has ? 'has-data' : 'no-data'}`}
                title={has ? `${fmtMonth(ym)} — has reports` : `${fmtMonth(ym)} — no reports`}
              >
                <span className="ac-month-cell-name">
                  {new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' })}
                </span>
                {isJan && <span className="ac-month-cell-year">{y}</span>}
              </button>
            );
          })}
        </div>
      </Modal.Body>
      <Modal.Footer className="ac-popup-footer">
        <Button variant="link" className="text-muted" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onPick(selectedMonth)}>
          View {fmtMonth(selectedMonth)}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
