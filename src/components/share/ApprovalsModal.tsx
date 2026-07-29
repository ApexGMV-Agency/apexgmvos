import { useState, useMemo, useEffect } from 'react';
import { Modal, Button, Form, Alert, Badge } from 'react-bootstrap';
import DOMPurify from 'dompurify';

export interface PendingApprovalReport {
  id: string;
  report_type: 'weekly' | 'monthly';
  brand_id: string;
  brand_name: string;
  period_label: string;          // e.g. "Week #4 — Apr 19–25" or "March 2026"
  approval_html: string;         // sanitized-or-raw HTML body of the approval request
}

export type ApprovalChoice = 'approved' | 'changes_requested' | null;

interface DraftDecision {
  choice: ApprovalChoice;
  comment: string;
}

export interface ExistingDecisionInfo {
  decision: 'approved' | 'changes_requested';
  comment: string | null;
  decided_by_name: string;
  decided_at: string;
}

interface Props {
  show: boolean;
  pending: PendingApprovalReport[];
  defaultName: string;
  /** Map of report_id → previously-submitted decision via this link. Decisions
   *  are locked once recorded — clients can only follow up via the comment thread. */
  existingDecisions?: Record<string, ExistingDecisionInfo>;
  onClose: () => void;
  onSubmit: (decisions: { report_id: string; report_type: 'weekly' | 'monthly'; decision: 'approved' | 'changes_requested'; comment: string; decided_by_name: string }[]) => Promise<void>;
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function ApprovalsModal({ show, pending, defaultName, existingDecisions, onClose, onSubmit }: Props) {
  const [name, setName] = useState(defaultName);
  const [drafts, setDrafts] = useState<Record<string, DraftDecision>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset state whenever the dialog (re-)opens. Locked items don't get a draft
  // entry — they're rendered read-only from `existingDecisions`.
  useEffect(() => {
    if (!show) return;
    setDrafts({});
    setName(defaultName);
    setErr(null);
  }, [show, pending, defaultName]);

  const isLocked = (reportId: string) => !!existingDecisions?.[reportId];

  const setDraft = (reportId: string, patch: Partial<DraftDecision>) => {
    if (isLocked(reportId)) return; // safety: should never be reachable from UI
    setDrafts(prev => {
      const cur = prev[reportId] ?? { choice: null, comment: '' };
      return { ...prev, [reportId]: { ...cur, ...patch } };
    });
  };

  // Only items without an existing decision are eligible to submit.
  const decided = useMemo(() =>
    Object.entries(drafts).filter(([id, d]) => d.choice != null && !isLocked(id)),
  [drafts, existingDecisions]);

  const newCount   = pending.filter(p => !isLocked(p.id)).length;
  const lockedCount = pending.length - newCount;

  const submit = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Please enter your name first.'); return; }
    if (decided.length === 0) { setErr('Choose Approve or Request changes for at least one item.'); return; }
    setSubmitting(true);
    try {
      await onSubmit(decided.map(([report_id, d]) => {
        const p = pending.find(x => x.id === report_id);
        return {
          report_id,
          report_type: p?.report_type ?? 'weekly',
          decision: d.choice as 'approved' | 'changes_requested',
          comment: d.comment.trim(),
          decided_by_name: name.trim(),
        };
      }));
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onClose} size="lg" centered backdrop="static" dialogClassName="ac-popup-modal">
      <Modal.Header className="ac-popup-header" closeButton closeVariant="white">
        <Modal.Title>
          <i className="bi bi-shield-check me-2" />
          {newCount > 0
            ? (newCount === 1 ? 'Approval requested' : `${newCount} approvals requested`)
            : 'Your decisions'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="ac-popup-body">
        <p className="text-muted mb-3">
          {newCount > 0
            ? 'Please review the following requests from your account manager. Approve or request changes; comments are optional.'
            : 'Your previous decisions are shown below. Once recorded, decisions can\'t be changed — start a reply in the report\'s Approval Needed / Action Items thread to follow up.'}
        </p>

        {err && <Alert variant="danger" className="py-2">{err}</Alert>}

        {newCount > 0 && (
          <Form.Group className="mb-3">
            <Form.Label className="small fw-semibold">Your name</Form.Label>
            <Form.Control
              value={name} onChange={e => setName(e.target.value)}
              placeholder="So we can credit your decision"
              disabled={submitting}
            />
          </Form.Group>
        )}

        {pending.map(p => {
          const draft = drafts[p.id] ?? { choice: null, comment: '' };
          const existing = existingDecisions?.[p.id];
          const safeHtml = DOMPurify.sanitize(p.approval_html ?? '');
          const locked = !!existing;

          return (
            <div key={p.id} className="ac-approval-item mb-3">
              <div className="d-flex flex-wrap align-items-center justify-content-between mb-2 gap-2">
                <div>
                  <Badge bg="dark" className="me-2">{p.brand_name}</Badge>
                  <Badge bg={p.report_type === 'monthly' ? 'info' : 'secondary'} className="me-2">
                    {p.report_type === 'monthly' ? 'Monthly' : 'Weekly'}
                  </Badge>
                  <span className="fw-semibold">{p.period_label}</span>
                </div>
                {locked && (
                  <Badge bg={existing!.decision === 'approved' ? 'success' : 'warning'}
                         text={existing!.decision === 'approved' ? undefined : 'dark'}>
                    <i className={`bi ${existing!.decision === 'approved' ? 'bi-check-circle-fill' : 'bi-arrow-repeat'} me-1`} />
                    {existing!.decision === 'approved' ? 'Approved' : 'Changes requested'}
                  </Badge>
                )}
              </div>
              <div className="ac-rte-view ac-approval-content mb-3"
                   dangerouslySetInnerHTML={{ __html: safeHtml }} />

              {locked ? (
                <div className="border rounded p-3" style={{ backgroundColor: '#f8f9fa' }}>
                  <div className="d-flex align-items-center gap-2 mb-2 small text-muted">
                    <i className="bi bi-lock-fill" />
                    <span>
                      Your decision was recorded by <strong>{existing!.decided_by_name}</strong> on{' '}
                      {fmtDateTime(existing!.decided_at)}.
                    </span>
                  </div>
                  {existing!.comment && (
                    <blockquote className="mb-2 small ps-2 ms-1"
                                style={{ borderLeft: '3px solid #dee2e6', whiteSpace: 'pre-wrap' }}>
                      {existing!.comment}
                    </blockquote>
                  )}
                  <div className="small text-muted">
                    <i className="bi bi-chat-left-text me-1" />
                    Need to follow up? Close this dialog and post a reply in the report's <strong>Approval Needed / Action Items</strong> thread —
                    your decision can't be changed but the conversation stays open.
                  </div>
                </div>
              ) : (
                <>
                  <div className="d-flex gap-2 flex-wrap mb-2">
                    <Button
                      variant={draft.choice === 'approved' ? 'success' : 'outline-success'}
                      onClick={() => setDraft(p.id, { choice: 'approved' })}
                      disabled={submitting}
                    >
                      <i className="bi bi-check-circle me-1" /> Approve
                    </Button>
                    <Button
                      variant={draft.choice === 'changes_requested' ? 'warning' : 'outline-warning'}
                      onClick={() => setDraft(p.id, { choice: 'changes_requested' })}
                      disabled={submitting}
                    >
                      <i className="bi bi-arrow-repeat me-1" /> Request changes
                    </Button>
                  </div>
                  <Form.Control
                    as="textarea" rows={2}
                    placeholder="Comment (optional) — this will be recorded with your decision and you can't edit it later."
                    value={draft.comment}
                    onChange={e => setDraft(p.id, { comment: e.target.value })}
                    disabled={submitting}
                  />
                  <div className="small text-muted mt-1">
                    <i className="bi bi-info-circle me-1" />
                    Heads up: once submitted, your choice is final. You can still post replies in the comment thread.
                  </div>
                </>
              )}
            </div>
          );
        })}

        {lockedCount > 0 && newCount === 0 && (
          <div className="text-center text-muted small mt-2">
            <i className="bi bi-info-circle me-1" />
            All items above are locked. Use the comment threads on the report dashboard to keep the conversation going.
          </div>
        )}
      </Modal.Body>
      <Modal.Footer className="ac-popup-footer">
        <Button variant="link" className="text-muted" onClick={onClose} disabled={submitting}>
          {newCount > 0 ? 'Read Report First' : 'Close'}
        </Button>
        {newCount > 0 && (
          <Button variant="primary" onClick={submit} disabled={submitting || decided.length === 0}>
            {submitting ? 'Submitting…' : `Submit ${decided.length || ''} decision${decided.length === 1 ? '' : 's'}`.trim()}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}
