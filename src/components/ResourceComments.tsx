import { useEffect, useRef, useState, FormEvent } from 'react';
import { Form, Button, Alert, Badge } from 'react-bootstrap';

export interface ResourceComment {
  id: string;
  resource_id: string;
  parent_id: string | null;
  author_type: 'client' | 'apc' | 'bob';
  author_name: string;
  body: string;
  created_at: string;
}

export interface ResourceCommentsProps {
  resourceId: string;
  resourceName?: string;
  comments: ResourceComment[];
  mode: 'authed' | 'public';
  currentAuthorName?: string;
  defaultPublicName?: string;
  onAdd: (body: string, authorName: string, parentId?: string) => Promise<void>;
  highlightCommentId?: string;
}

export default function ResourceComments(props: ResourceCommentsProps) {
  const { resourceId, resourceName, comments, mode, currentAuthorName, defaultPublicName, onAdd, highlightCommentId } = props;
  const [body, setBody] = useState('');
  const [name, setName] = useState(defaultPublicName ?? '');
  const [editingName, setEditingName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasSavedName = mode === 'public' && !!defaultPublicName;
  const resourceComments = comments.filter(c => c.resource_id === resourceId);
  const roots = resourceComments.filter(c => !c.parent_id);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setErr(null);
    try {
      const authorName = mode === 'authed'
        ? (currentAuthorName ?? 'User')
        : (hasSavedName && !editingName ? defaultPublicName! : name.trim());
      if (mode === 'public' && !authorName) { setErr('Please enter your name'); setBusy(false); return; }
      await onAdd(body.trim(), authorName);
      if (mode === 'public') localStorage.setItem('ac_public_name', authorName);
      setBody('');
      setEditingName(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to post');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-3">
        <i className="bi bi-chat-left-text" />
        <span className="fw-semibold">
          {mode === 'authed' ? 'Client feedback' : 'Comments'}
          {resourceName && <span className="text-muted fw-normal ms-2">— {resourceName}</span>}
        </span>
        {resourceComments.length > 0 && (
          <Badge bg="primary" pill>{resourceComments.length}</Badge>
        )}
      </div>

      {roots.length > 0 && (
        <div className="mb-3">
          {roots.map(c => (
            <CommentNode
              key={c.id}
              comment={c}
              all={resourceComments}
              depth={0}
              mode={mode}
              currentAuthorName={currentAuthorName}
              defaultPublicName={defaultPublicName}
              hasSavedName={hasSavedName}
              onAdd={onAdd}
              highlightCommentId={highlightCommentId}
            />
          ))}
        </div>
      )}

      {mode === 'public' || mode === 'authed' ? (
        <Form onSubmit={submit}>
          {err && <Alert variant="danger" className="py-2 mb-2 small">{err}</Alert>}
          {mode === 'public' && (!hasSavedName || editingName) && (
            <Form.Control
              size="sm"
              className="mb-2"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus={editingName}
            />
          )}
          <Form.Control
            as="textarea"
            rows={2}
            placeholder={mode === 'authed' ? 'Reply to client feedback…' : 'Add a comment on this resource…'}
            value={body}
            onChange={e => setBody(e.target.value)}
            required
          />
          <div className="d-flex justify-content-between align-items-center mt-2">
            {mode === 'public' && hasSavedName && !editingName ? (
              <small className="text-muted">
                Commenting as <strong>{defaultPublicName}</strong>
                <button type="button" className="btn btn-link btn-sm p-0 ms-2" onClick={() => { setName(defaultPublicName!); setEditingName(true); }}>
                  change
                </button>
              </small>
            ) : <span />}
            <Button type="submit" size="sm" disabled={busy || !body.trim()}>
              <i className="bi bi-send me-1" />
              {busy ? 'Posting…' : (mode === 'authed' ? 'Post reply' : 'Post comment')}
            </Button>
          </div>
        </Form>
      ) : null}
    </div>
  );
}

interface NodeProps {
  comment: ResourceComment;
  all: ResourceComment[];
  depth: number;
  mode: 'authed' | 'public';
  currentAuthorName?: string;
  defaultPublicName?: string;
  hasSavedName: boolean;
  onAdd: (body: string, authorName: string, parentId?: string) => Promise<void>;
  highlightCommentId?: string;
}

function CommentNode(p: NodeProps) {
  const { comment, all, depth, mode, currentAuthorName, defaultPublicName, hasSavedName, onAdd, highlightCommentId } = p;
  const children = all.filter(c => c.parent_id === comment.id);
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replyName, setReplyName] = useState(defaultPublicName ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const isHighlight = highlightCommentId === comment.id;
  const [flash, setFlash] = useState(isHighlight);

  useEffect(() => {
    if (!isHighlight || !cardRef.current) return;
    const t = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    setFlash(true);
    const off = setTimeout(() => setFlash(false), 2400);
    return () => { clearTimeout(t); clearTimeout(off); };
  }, [isHighlight]);

  const submitReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setBusy(true); setErr(null);
    try {
      const authorName = mode === 'authed'
        ? (currentAuthorName ?? 'User')
        : (hasSavedName ? defaultPublicName! : replyName.trim());
      if (mode === 'public' && !authorName) { setErr('Please enter your name'); setBusy(false); return; }
      await onAdd(replyBody.trim(), authorName, comment.id);
      if (mode === 'public') localStorage.setItem('ac_public_name', authorName);
      setReplyBody('');
      setReplying(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to reply');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-2">
      <div
        ref={cardRef}
        className="p-3 rounded"
        style={{
          background: flash ? '#fef3c7' : 'white',
          border: `1px solid ${flash ? '#f59e0b' : '#e5e7eb'}`,
          boxShadow: flash ? '0 0 0 3px rgba(245,158,11,.25)' : undefined,
          transition: 'background .25s ease, border-color .25s ease, box-shadow .25s ease',
        }}
      >
        <div className="d-flex justify-content-between align-items-start mb-1">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="fw-semibold">{comment.author_name}</span>
            <Badge bg={comment.author_type === 'client' ? 'info' : comment.author_type === 'bob' ? 'warning' : 'success'}
              text={comment.author_type === 'bob' ? 'dark' : undefined}>
              {comment.author_type === 'client' ? 'Client' : comment.author_type === 'bob' ? 'Bob' : 'APC'}
            </Badge>
            <small className="text-muted">{formatTime(comment.created_at)}</small>
          </div>
        </div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</div>
        <div className="mt-2">
          <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none"
            onClick={() => setReplying(v => !v)}>
            <i className="bi bi-reply me-1" />{replying ? 'Cancel' : 'Reply'}
          </button>
        </div>
      </div>

      {replying && (
        <div className="mt-2" style={{ marginLeft: Math.min(depth + 1, 3) * 16 }}>
          <Form onSubmit={submitReply}>
            {err && <Alert variant="danger" className="py-2 mb-2 small">{err}</Alert>}
            {mode === 'public' && !hasSavedName && (
              <Form.Control
                size="sm" className="mb-2" placeholder="Your name"
                value={replyName} onChange={e => setReplyName(e.target.value)} required
              />
            )}
            <Form.Control
              as="textarea" rows={2}
              placeholder={`Reply to ${comment.author_name}…`}
              value={replyBody} onChange={e => setReplyBody(e.target.value)}
              required autoFocus
            />
            <div className="text-end mt-2">
              <Button size="sm" variant="secondary" className="me-2" onClick={() => setReplying(false)} disabled={busy} type="button">Cancel</Button>
              <Button type="submit" size="sm" disabled={busy || !replyBody.trim()}>
                <i className="bi bi-send me-1" />{busy ? 'Posting…' : 'Post reply'}
              </Button>
            </div>
          </Form>
        </div>
      )}

      {children.length > 0 && (
        <div className="mt-2" style={{ marginLeft: Math.min(depth + 1, 3) * 16, borderLeft: '2px solid #e2e8f0', paddingLeft: 12 }}>
          {children.map(child => (
            <CommentNode key={child.id} {...p} comment={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
