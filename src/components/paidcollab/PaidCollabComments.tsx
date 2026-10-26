import { useEffect, useRef, useState, FormEvent } from 'react';
import './paidCollabComments.css';

/* Threaded comment panel for one BRAND-SCOPED target. Shared by the public
   client share link and the staff surfaces; supports replies + scroll-to/flash
   of a target comment.

   ‼️ IT SERVES TWO BOARDS NOW — paid collab (brand / program / week /
   creator / insights / kpi, in `paid_collab_comments`) and the Promo Tracker
   (`brand_promo_comments`, one thread per brand). It was widened rather than
   copied: the two threads look and behave identically to a client, and a
   second implementation of "post, reply, flash the linked comment" is two
   implementations to keep in step. Which is why it names no table and takes
   the rows structurally — `ThreadComment` below is the only shape it needs.
   Its file and CSS keep the `PaidCollab` / `pcc-` names because renaming them
   would touch every existing call site for no behaviour. */
export interface ThreadComment {
  id: string;
  /** The board's own discriminator. A one-thread board passes a constant. */
  target_type: string;
  target_key: string;
  /** client | handler | bob | team_lead | apc | ads_manager — drives the tag. */
  author_type: string;
  author_name: string;
  body: string;
  parent_id: string | null;
  created_at: string;
}

export interface PaidCollabCommentsProps {
  comments: ThreadComment[];              // all comments for the brand (any target)
  targetType: string;
  targetKey: string;
  title: string;                          // e.g. "Whole brand", "Creator · Jane"
  mode: 'public' | 'authed';
  currentAuthorName?: string;             // authed user's display name
  defaultPublicName?: string;             // remembered public (client) name
  onAdd: (body: string, authorName: string, parentId?: string) => Promise<void>;
  highlightCommentId?: string;
  defaultOpen?: boolean;
  readOnly?: boolean;                     // threads stay readable, posting/replying withdrawn
}

const AUTHOR_LABEL: Record<string, string> = {
  client: 'Client', handler: 'Handler', bob: 'Bob', apc: 'APC',
  team_lead: 'Team Lead', ads_manager: 'Ads Manager',
};

export default function PaidCollabComments(props: PaidCollabCommentsProps) {
  const { comments, targetType, targetKey, title, mode, currentAuthorName, defaultPublicName, onAdd, highlightCommentId, defaultOpen, readOnly } = props;
  const scoped = comments.filter(c => c.target_type === targetType && (c.target_key || '') === (targetKey || ''));
  const roots = scoped.filter(c => !c.parent_id);
  const hasHighlight = highlightCommentId ? scoped.some(c => c.id === highlightCommentId) : false;

  const [open, setOpen] = useState(!!defaultOpen || scoped.length > 0 || hasHighlight);
  const [body, setBody] = useState('');
  const [name, setName] = useState(defaultPublicName ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (hasHighlight) setOpen(true); }, [hasHighlight]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    // The fallback is only reached when a signed-in user has no name on their
    // profile, and only ever reaches the SCREEN: both boards stamp the author
    // server-side (the promo board in its fill trigger, paid collab from the
    // caller's own profile).
    const authorName = mode === 'authed' ? (currentAuthorName || 'ApexGMV') : name.trim();
    if (mode === 'public' && !authorName) { setErr('Please enter your name'); return; }
    setBusy(true); setErr(null);
    try {
      await onAdd(body.trim(), authorName);
      if (mode === 'public') localStorage.setItem('ac_public_name', authorName);
      setBody('');
    } catch (e: any) { setErr(e?.message ?? 'Failed to post'); }
    finally { setBusy(false); }
  };

  return (
    <div className="pcc">
      <button type="button" className="pcc-head" onClick={() => setOpen(o => !o)}>
        <i className="bi bi-chat-left-text" />
        <span className="pcc-head-t">Discussion · {title}</span>
        {scoped.length > 0 && <span className="pcc-count">{scoped.length}</span>}
        <i className={`bi bi-chevron-${open ? 'up' : 'down'} pcc-chev`} />
      </button>

      {open && (
        <div className="pcc-body">
          {roots.length > 0 ? (
            <div className="pcc-list">
              {roots.map(c => (
                <CommentNode key={c.id} comment={c} all={scoped} depth={0} mode={mode}
                  currentAuthorName={currentAuthorName} defaultPublicName={defaultPublicName}
                  onAdd={onAdd} highlightCommentId={highlightCommentId} readOnly={readOnly} />
              ))}
            </div>
          ) : (
            <div className="pcc-empty">
              {readOnly ? 'No comments yet.' : 'No comments yet — start the conversation.'}
            </div>
          )}

          {!readOnly && (
            <form className="pcc-form" onSubmit={submit}>
              {err && <div className="pcc-err">{err}</div>}
              {mode === 'public' && (
                <input className="pcc-input" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required />
              )}
              <textarea className="pcc-input pcc-area" rows={2} placeholder={`Add a comment on ${title}…`}
                value={body} onChange={e => setBody(e.target.value)} required />
              <div className="pcc-actions">
                <button type="submit" className="pcc-btn" disabled={busy || !body.trim()}>
                  <i className="bi bi-send" />{busy ? 'Posting…' : 'Post comment'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function CommentNode(p: {
  comment: ThreadComment; all: ThreadComment[]; depth: number; mode: 'public' | 'authed';
  currentAuthorName?: string; defaultPublicName?: string;
  onAdd: (body: string, authorName: string, parentId?: string) => Promise<void>;
  highlightCommentId?: string;
  readOnly?: boolean;
}) {
  const { comment, all, depth, mode, currentAuthorName, defaultPublicName, onAdd, highlightCommentId, readOnly } = p;
  const ref = useRef<HTMLDivElement | null>(null);
  const isHighlight = highlightCommentId === comment.id;
  const [flash, setFlash] = useState(isHighlight);
  const children = all.filter(c => c.parent_id === comment.id);
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replyName, setReplyName] = useState(defaultPublicName ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isHighlight || !ref.current) return;
    const t = setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 140);
    setFlash(true);
    const off = setTimeout(() => setFlash(false), 2400);
    return () => { clearTimeout(t); clearTimeout(off); };
  }, [isHighlight]);

  const submitReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim()) return;
    const authorName = mode === 'authed' ? (currentAuthorName || 'ApexGMV') : replyName.trim();
    if (mode === 'public' && !authorName) { setErr('Please enter your name'); return; }
    setBusy(true); setErr(null);
    try {
      await onAdd(replyBody.trim(), authorName, comment.id);
      if (mode === 'public') localStorage.setItem('ac_public_name', authorName);
      setReplyBody(''); setReplying(false);
    } catch (e: any) { setErr(e?.message ?? 'Failed to reply'); }
    finally { setBusy(false); }
  };

  return (
    <div className="pcc-node">
      <div ref={ref} className={`pcc-card ${flash ? 'flash' : ''} a-${comment.author_type}`}>
        <div className="pcc-meta">
          <span className="pcc-author">{comment.author_name}</span>
          <span className={`pcc-tag a-${comment.author_type}`}>{AUTHOR_LABEL[comment.author_type] || comment.author_type}</span>
          <span className="pcc-time">{timeAgo(comment.created_at)}</span>
        </div>
        <div className="pcc-text">{comment.body}</div>
        {!readOnly && (
          <button type="button" className="pcc-reply" onClick={() => setReplying(v => !v)}>
            <i className="bi bi-reply" />{replying ? 'Cancel' : 'Reply'}
          </button>
        )}
      </div>

      {replying && !readOnly && (
        <form className="pcc-form pcc-replyform" onSubmit={submitReply}>
          {err && <div className="pcc-err">{err}</div>}
          {mode === 'public' && !defaultPublicName && (
            <input className="pcc-input" placeholder="Your name" value={replyName} onChange={e => setReplyName(e.target.value)} required />
          )}
          <textarea className="pcc-input pcc-area" rows={2} placeholder={`Reply to ${comment.author_name}…`}
            value={replyBody} onChange={e => setReplyBody(e.target.value)} required autoFocus />
          <div className="pcc-actions">
            <button type="button" className="pcc-btn ghost" onClick={() => setReplying(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="pcc-btn" disabled={busy || !replyBody.trim()}><i className="bi bi-send" />{busy ? 'Posting…' : 'Reply'}</button>
          </div>
        </form>
      )}

      {children.length > 0 && (
        <div className="pcc-children">
          {children.map(child => (
            <CommentNode key={child.id} {...p} comment={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso), now = new Date();
  const s = (now.getTime() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
