import { useEffect, useMemo, useState } from 'react';
import { Offcanvas, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import SectionComments, { Comment, CommentSection } from './SectionComments';

// A read-through of a report's full client-feedback conversation, section by
// section — used by the weekly/monthly "Approved" list. Replies post through
// the post-staff-comment edge function, which is Bob-only (APCs / Team Leads
// pass canReply=false and see the thread read-only).

export type ConvReport = {
  id: string;
  type: 'weekly' | 'monthly';
  title: string;
  subtitle?: string;
};

// approval first (the tab's whole point), then the standard dashboard order.
const SECTION_ORDER = [
  'approval', 'overall', 'top_creators', 'top_videos', 'video_performance',
  'gmv_max', 'product_highlights', 'shop_health', 'insights',
];
const orderIndex = (s: CommentSection) => {
  const i = SECTION_ORDER.indexOf(s);
  return i === -1 ? SECTION_ORDER.length : i;   // custom (cs:) sections last
};
const sectionLabelFor = (s: CommentSection): string | undefined =>
  s.startsWith('cs:') ? 'Custom section' : undefined;   // else SectionComments' built-in label

export default function ReportConversationOffcanvas({
  report, canReply, currentAuthorName, onClose,
}: {
  report: ConvReport | null;
  canReply: boolean;
  currentAuthorName: string;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!report) { setComments([]); setErr(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      const { data, error } = await supabase.from('report_comments')
        .select('*').eq('report_id', report.id).order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) setErr(error.message);
      else setComments((data as Comment[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [report?.id]);

  // Distinct sections present in this report's thread, in display order.
  const sections = useMemo(() => {
    const set = new Set<CommentSection>();
    comments.forEach(c => set.add(c.section));
    return Array.from(set).sort((a, b) => orderIndex(a) - orderIndex(b));
  }, [comments]);

  const postComment = async (section: CommentSection, body: string, parentId?: string) => {
    if (!report) return;
    const { data, error } = await supabase.functions.invoke('post-staff-comment', {
      body: { report_id: report.id, section, body, parent_id: parentId ?? null, report_type: report.type },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
  };

  return (
    <Offcanvas show={!!report} onHide={onClose} placement="end" style={{ width: 480 }}>
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>
          <i className="bi bi-chat-left-text me-2" />
          Conversation
          {report && (
            <div className="small text-muted fw-normal mt-1">
              {report.title}{report.subtitle ? ` — ${report.subtitle}` : ''}
            </div>
          )}
        </Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {loading ? (
          <div className="text-center py-5"><Spinner animation="border" /></div>
        ) : err ? (
          <Alert variant="danger">{err}</Alert>
        ) : sections.length === 0 ? (
          <div className="text-center py-5 text-muted">
            <i className="bi bi-chat-square-dots" style={{ fontSize: '2rem' }} /><br />
            No client feedback on this report yet.
          </div>
        ) : (
          <>
            {!canReply && (
              <div className="text-muted small mb-3">
                <i className="bi bi-eye me-1" /> Read-only — replying to client feedback is Bob-only.
              </div>
            )}
            {sections.map(section => (
              <SectionComments
                key={section}
                section={section}
                sectionLabel={sectionLabelFor(section)}
                comments={comments}
                mode="authed"
                currentAuthorName={currentAuthorName}
                canReply={canReply}
                onAdd={(body, _name, parentId) => postComment(section, body, parentId)}
              />
            ))}
          </>
        )}
      </Offcanvas.Body>
    </Offcanvas>
  );
}
