import { useEffect, useState } from 'react';
import { Badge, Button, Form, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

export type ReviewStatus = 'none' | 'submitted' | 'approved' | 'rejected';

export interface ReviewState {
  status: ReviewStatus;
  reviewed_at?: string | null;
  review_note?: string | null;
}

const META: Record<Exclude<ReviewStatus, 'none'>, { bg: string; text?: string; icon: string; label: string }> = {
  submitted: { bg: 'warning', text: 'dark', icon: 'bi-hourglass-split', label: 'Pending review' },
  approved:  { bg: 'success', icon: 'bi-patch-check-fill', label: 'Reviewed' },
  rejected:  { bg: 'danger',  icon: 'bi-arrow-counterclockwise', label: 'Changes requested' },
};

// Internal report-review controls (APC submits → Team Lead accepts/rejects → Bob
// sees "Reviewed"). Rendered inline near the report header. `kind` selects the
// weekly vs monthly RPC variant; everything else is driven by the caller's role.
export default function ReportReviewBar({
  kind, reportId, brandId, review, onChanged, disabled,
}: {
  kind: 'weekly' | 'monthly';
  reportId: string;
  brandId: string;
  review: ReviewState;
  onChanged: (next: ReviewState) => void;
  disabled?: boolean;
}) {
  const { profile } = useAuth();
  const role = profile?.role;
  const isApc = role === 'apc';
  // The report only loads for a Team Lead if it's one of their brands (RLS), so a
  // team_lead viewer is necessarily this brand's reviewer.
  const isReviewer = role === 'team_lead';

  const [hasTeamLead, setHasTeamLead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showReject, setShowReject] = useState(false);

  // APCs need to know whether a reviewer exists before offering "Submit".
  useEffect(() => {
    if (!isApc) return;
    let alive = true;
    supabase.rpc('brand_has_team_lead', { b_id: brandId }).then(({ data }) => {
      if (alive) setHasTeamLead(!!data);
    });
    return () => { alive = false; };
  }, [isApc, brandId]);

  const meta = review.status !== 'none' ? META[review.status] : null;

  const submit = async () => {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('submit_report_for_review', { p_kind: kind, p_id: reportId });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onChanged({ status: 'submitted', reviewed_at: null, review_note: null });
  };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !showReject) { setShowReject(true); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('decide_report_review', {
      p_kind: kind, p_id: reportId, p_decision: decision, p_note: note || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onChanged({ status: decision, reviewed_at: new Date().toISOString(), review_note: note || null });
    setShowReject(false); setNote('');
  };

  const canSubmit = isApc && hasTeamLead && (review.status === 'none' || review.status === 'rejected');
  const canDecide = isReviewer && review.status === 'submitted';

  // Nothing to show: a viewer with no badge and no available action.
  if (!meta && !canSubmit && !canDecide) return null;

  return (
    <div className="d-flex flex-column gap-2 mt-2">
      <div className="d-flex align-items-center gap-2 flex-wrap">
        {meta && (
          <Badge bg={meta.bg} text={meta.text as any}>
            <i className={`bi ${meta.icon} me-1`} />{meta.label}
          </Badge>
        )}
        {review.status === 'rejected' && review.review_note && (
          <span className="text-muted small">— {review.review_note}</span>
        )}

        {canSubmit && (
          <Button size="sm" variant="primary" disabled={busy || disabled} onClick={submit}>
            <i className="bi bi-send me-1" />
            {review.status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
          </Button>
        )}

        {canDecide && !showReject && (
          <>
            <Button size="sm" variant="success" disabled={busy} onClick={() => decide('approved')}>
              <i className="bi bi-check2 me-1" /> Accept
            </Button>
            <Button size="sm" variant="outline-danger" disabled={busy} onClick={() => decide('rejected')}>
              <i className="bi bi-x-lg me-1" /> Reject
            </Button>
          </>
        )}
      </div>

      {canDecide && showReject && (
        <div className="d-flex flex-column gap-2" style={{ maxWidth: 460 }}>
          <Form.Control
            as="textarea" rows={2} placeholder="What needs changing? (sent to the APC)"
            value={note} onChange={e => setNote(e.target.value)} autoFocus
          />
          <div className="d-flex gap-2">
            <Button size="sm" variant="danger" disabled={busy} onClick={() => decide('rejected')}>
              Send rejection
            </Button>
            <Button size="sm" variant="link" className="text-muted" disabled={busy}
              onClick={() => { setShowReject(false); setNote(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {err && <Alert variant="danger" className="py-1 px-2 mb-0 small">{err}</Alert>}
    </div>
  );
}
