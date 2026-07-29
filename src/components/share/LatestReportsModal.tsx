import { useMemo } from 'react';
import { Modal, Button, Badge } from 'react-bootstrap';

interface BrandLite { id: string; name: string }
interface WeeklyReportLite { id: string; brand_id: string; week_start: string; week_end: string; week_number?: number; status?: string }
interface MonthlyReportLite { id: string; brand_id: string; month: string; status?: string }

interface Props {
  show: boolean;
  brands: BrandLite[];
  weeklyReports: WeeklyReportLite[];
  monthlyReports: MonthlyReportLite[];
  onPickWeekly: (r: WeeklyReportLite) => void;
  onPickMonthly: (r: MonthlyReportLite) => void;
  onClose: () => void;
}

type LatestRow =
  | { kind: 'weekly';  report: WeeklyReportLite;  sortKey: string }
  | { kind: 'monthly'; report: MonthlyReportLite; sortKey: string };

function fmtRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const sFmt = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const eFmt = sameMonth
    ? e.toLocaleDateString(undefined, { day: 'numeric', year: 'numeric' })
    : e.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${sFmt} – ${eFmt}`;
}
function fmtMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
function relative(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const day = 1000 * 60 * 60 * 24;
  const d = Math.floor(diffMs / day);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 30) return `${Math.floor(d / 7)} week${Math.floor(d / 7) === 1 ? '' : 's'} ago`;
  if (d < 365) return `${Math.floor(d / 30)} month${Math.floor(d / 30) === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

export default function LatestReportsModal({
  show, brands, weeklyReports, monthlyReports,
  onPickWeekly, onPickMonthly, onClose,
}: Props) {
  const brandName = (id: string) => brands.find(b => b.id === id)?.name ?? 'Brand';

  const latest3: LatestRow[] = useMemo(() => {
    const rows: LatestRow[] = [
      ...weeklyReports.map<LatestRow>(r => ({
        kind: 'weekly', report: r, sortKey: r.week_start || '',
      })),
      ...monthlyReports.map<LatestRow>(r => ({
        kind: 'monthly', report: r, sortKey: (r.month || '') + '-01',
      })),
    ];
    return rows
      .filter(r => r.sortKey)
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
      .slice(0, 3);
  }, [weeklyReports, monthlyReports]);

  return (
    <Modal show={show} onHide={onClose} centered backdrop="static" dialogClassName="ac-popup-modal">
      <Modal.Header className="ac-popup-header" closeButton>
        <Modal.Title>
          <i className="bi bi-collection me-2" />
          Welcome — here are your latest reports
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="ac-popup-body">
        {latest3.length === 0 ? (
          <div className="text-center text-muted py-4">
            <i className="bi bi-inbox fs-2 d-block mb-2 opacity-50" />
            No reports available yet.
          </div>
        ) : (
          <>
            <p className="text-muted mb-3">
              Pick a report to jump straight in, or close this to browse on your own.
            </p>
            <div className="d-flex flex-column gap-2">
              {latest3.map(row => {
                const isWeekly = row.kind === 'weekly';
                const r = row.report;
                const dateLabel = isWeekly
                  ? fmtRange((r as WeeklyReportLite).week_start, (r as WeeklyReportLite).week_end)
                  : fmtMonth((r as MonthlyReportLite).month);
                const sortDate = new Date(row.sortKey + 'T00:00:00');
                return (
                  <button
                    key={`${row.kind}-${r.id}`}
                    type="button"
                    onClick={() => isWeekly ? onPickWeekly(r as WeeklyReportLite) : onPickMonthly(r as MonthlyReportLite)}
                    className="ac-latest-report-card"
                  >
                    <div className="ac-latest-report-icon" style={{
                      background: isWeekly ? 'rgba(37,99,235,.10)' : 'rgba(20,184,166,.10)',
                      color: isWeekly ? '#2563eb' : '#0d9488',
                    }}>
                      <i className={`bi ${isWeekly ? 'bi-calendar-week' : 'bi-calendar-month'}`} />
                    </div>
                    <div className="flex-grow-1 min-w-0 text-start">
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <Badge bg={isWeekly ? 'primary' : 'info'} pill>
                          {isWeekly ? 'Weekly' : 'Monthly'}
                        </Badge>
                        <span className="fw-bold text-truncate">{dateLabel}</span>
                      </div>
                      <div className="text-muted small mt-1 text-truncate">
                        <i className="bi bi-shop me-1" />{brandName(r.brand_id)}
                        <span className="mx-2">·</span>
                        {relative(sortDate)}
                      </div>
                    </div>
                    <i className="bi bi-arrow-right-circle-fill text-primary fs-4" />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Modal.Body>
      <Modal.Footer className="ac-popup-footer">
        <Button variant="link" className="text-muted" onClick={onClose}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}
