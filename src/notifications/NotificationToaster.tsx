import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from './NotificationsContext';

// Per-type look: icon + accent colour + short label.
const TYPE_META: Record<string, { icon: string; color: string; label: string }> = {
  chat:            { icon: 'bi-chat-dots-fill',      color: '#0d6efd', label: 'Message' },
  staff_comment:   { icon: 'bi-chat-left-text-fill', color: '#e8862e', label: 'Team reply' },
  client_comment:  { icon: 'bi-chat-left-text-fill', color: '#198754', label: 'Client comment' },
  announcement:    { icon: 'bi-megaphone-fill',      color: '#8b5cf6', label: 'Announcement' },
  task:            { icon: 'bi-check2-square',        color: '#0ea5e9', label: 'Task' },
  report_review:   { icon: 'bi-clipboard-check-fill', color: '#0ea5e9', label: 'Report' },
};
const DEFAULT_META = { icon: 'bi-bell-fill', color: '#64748b', label: 'Notification' };
const metaFor = (t: string) => TYPE_META[t] ?? DEFAULT_META;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

/**
 * Slide-in notification toaster. Surfaces unread notifications one at a time
 * from the right: close advances to the next (and marks it read), "View
 * details" opens it, "Mark all as read" clears the queue. Realtime inserts
 * (via NotificationsContext) appear automatically.
 */
export default function NotificationToaster() {
  const { notifications, markRead, markAllRead } = useNotifications();
  const nav = useNavigate();
  const [leaving, setLeaving] = useState(false);

  const unread = notifications.filter(n => !n.read_at);  // newest first
  const current = unread[0] ?? null;
  const moreCount = Math.max(0, unread.length - 1);

  // New card -> reset the exit state so the entrance animation plays.
  useEffect(() => { setLeaving(false); }, [current?.id]);

  if (!current) return null;
  const meta = metaFor(current.type);

  const advance = (fn: () => void) => { setLeaving(true); window.setTimeout(fn, 240); };
  const onClose = () => advance(() => markRead(current.id));
  const onView = () => { markRead(current.id); if (current.link) nav(current.link); };
  const onAll = () => advance(() => markAllRead());

  return (
    <div className="ac-toaster" aria-live="polite">
      <div key={current.id} className={`ac-toast ${leaving ? 'leaving' : 'entering'} ${moreCount > 0 ? 'has-stack' : ''}`}>
        <span className="ac-toast-accent" style={{ background: meta.color }} />
        <div className="ac-toast-main">
          <div className="ac-toast-head">
            <span className="ac-toast-avatar" style={{ background: `${meta.color}1f`, color: meta.color }}>
              <i className={`bi ${meta.icon}`} />
            </span>
            <span className="ac-toast-type" style={{ color: meta.color }}>{meta.label}</span>
            <span className="ac-toast-time">{timeAgo(current.created_at)}</span>
            <button className="ac-toast-x" onClick={onClose} aria-label="Dismiss" title="Dismiss"><i className="bi bi-x-lg" /></button>
          </div>
          <div className="ac-toast-title">{current.title}</div>
          {current.body && <div className="ac-toast-body">{current.body}</div>}
          <div className="ac-toast-actions">
            {current.link && (
              <button className="ac-toast-link" onClick={onView}>
                <i className="bi bi-box-arrow-up-right me-1" />View details
              </button>
            )}
            <button className="ac-toast-allread" onClick={onAll}>
              <i className="bi bi-check2-all me-1" />Mark all as read
            </button>
          </div>
          {moreCount > 0 && (
            <div className="ac-toast-more">
              <i className="bi bi-stack me-1" />{moreCount} more waiting · close to see the next
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
