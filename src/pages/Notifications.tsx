import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Badge, Spinner, Nav } from 'react-bootstrap';
import { useNotifications, Notification } from '../notifications/NotificationsContext';
import { useAuth } from '../auth/AuthContext';

type TabKey = 'all' | 'unread' | 'weekly' | 'monthly';

// Reporting notifications (review decisions + comments) carry a `/reporting/<kind>/` link
// and/or a `report_type` payload; classify weekly vs monthly from either.
const reportKind = (n: Notification): 'weekly' | 'monthly' | null => {
  if (n.link?.includes('/reporting/weekly/')) return 'weekly';
  if (n.link?.includes('/reporting/monthly/')) return 'monthly';
  const rt = n.payload?.report_type;
  if (rt === 'weekly' || rt === 'monthly') return rt;
  return null;
};

export default function NotificationsPage() {
  const { notifications, unreadCount, loading, markRead, markAllRead, remove } = useNotifications();
  const { profile } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<TabKey>('unread');

  // Reporting notifications only ever reach internal staff (bob / team_lead / apc).
  const role = profile?.role;
  const isInternalStaff = role === 'bob' || role === 'team_lead' || role === 'apc';

  const weeklyCount = useMemo(() => notifications.filter(n => reportKind(n) === 'weekly').length, [notifications]);
  const monthlyCount = useMemo(() => notifications.filter(n => reportKind(n) === 'monthly').length, [notifications]);

  const visible = useMemo(() => {
    if (tab === 'unread') return notifications.filter(n => !n.read_at);
    if (tab === 'weekly') return notifications.filter(n => reportKind(n) === 'weekly');
    if (tab === 'monthly') return notifications.filter(n => reportKind(n) === 'monthly');
    return notifications;
  }, [tab, notifications]);

  const open = (id: string, link: string | null) => {
    markRead(id);
    if (link) nav(link);
  };

  // Theme per tab.
  const accents: Record<TabKey, string> = {
    unread: 'var(--ac-accent-base)',   // orange
    weekly: '#22d3ee',   // cyan
    monthly: '#f472b6',  // pink
    all: 'var(--ac-info)',      // blue
  };
  const accent = accents[tab];
  const accentSoft = tab === 'unread' ? 'rgba(249,115,22,.06)'
    : tab === 'weekly' ? 'rgba(8,145,178,.06)'
    : tab === 'monthly' ? 'rgba(219,39,119,.06)'
    : 'rgba(37,99,235,.04)';

  const emptyMsg = tab === 'unread' ? 'No unread notifications. You\'re all caught up.'
    : tab === 'weekly' ? 'No weekly reporting notifications.'
    : tab === 'monthly' ? 'No monthly reporting notifications.'
    : 'No notifications yet.';

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2 className="mb-0">
          Notifications
          {unreadCount > 0 && <Badge bg="warning" text="dark" pill className="ms-2">{unreadCount} unread</Badge>}
        </h2>
        {unreadCount > 0 && (
          <Button variant="outline-secondary" size="sm" onClick={markAllRead}>
            <i className="bi bi-check2-all me-1" /> Mark all read
          </Button>
        )}
      </div>

      <Card className="mb-3">
        <Card.Body className="py-2">
          <Nav variant="tabs" activeKey={tab} onSelect={k => k && setTab(k as TabKey)}>
            <Nav.Item>
              <Nav.Link eventKey="unread" style={tab === 'unread' ? { color: accents.unread, borderBottomColor: accents.unread } : undefined}>
                <i className="bi bi-envelope me-1" />
                Unread
                {unreadCount > 0 && (
                  <Badge bg="warning" text="dark" pill className="ms-2">{unreadCount}</Badge>
                )}
              </Nav.Link>
            </Nav.Item>
            {isInternalStaff && <>
              <Nav.Item>
                <Nav.Link eventKey="weekly" style={tab === 'weekly' ? { color: accents.weekly, borderBottomColor: accents.weekly } : undefined}>
                  <i className="bi bi-calendar-week me-1" />
                  Weekly Reporting
                  <Badge bg="secondary" pill className="ms-2">{weeklyCount}</Badge>
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="monthly" style={tab === 'monthly' ? { color: accents.monthly, borderBottomColor: accents.monthly } : undefined}>
                  <i className="bi bi-calendar-month me-1" />
                  Monthly Reporting
                  <Badge bg="secondary" pill className="ms-2">{monthlyCount}</Badge>
                </Nav.Link>
              </Nav.Item>
            </>}
            <Nav.Item>
              <Nav.Link eventKey="all">
                <i className="bi bi-list-ul me-1" />
                All
                <Badge bg="secondary" pill className="ms-2">{notifications.length}</Badge>
              </Nav.Link>
            </Nav.Item>
          </Nav>
        </Card.Body>
      </Card>

      {loading
        ? <div className="text-center py-5"><Spinner animation="border" /></div>
        : visible.length === 0
          ? <Card body className="text-center text-muted">{emptyMsg}</Card>
          : (
            <div className="d-flex flex-column gap-2">
              {visible.map(n => {
                const unread = !n.read_at;
                return (
                  <Card key={n.id} className="shadow-sm"
                    style={{
                      borderLeft: unread ? `4px solid ${accent}` : '4px solid #292929',
                      background: unread ? accentSoft : undefined,
                      cursor: n.link ? 'pointer' : 'default',
                    }}
                    onClick={() => open(n.id, n.link)}>
                    <Card.Body className="py-3">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="d-flex align-items-center gap-2">
                            <span className="fw-semibold" style={unread ? { color: accent } : undefined}>{n.title}</span>
                            {unread && <Badge pill style={{ background: accent, width: 8, height: 8, padding: 0 }} />}
                          </div>
                          {n.body && <div className="text-muted small mt-1">{n.body}</div>}
                          <small className="text-muted">{new Date(n.created_at).toLocaleString()}</small>
                        </div>
                        <Button size="sm" variant="link" className="text-danger p-0" onClick={(e) => { e.stopPropagation(); remove(n.id); }} title="Delete">
                          <i className="bi bi-trash" />
                        </Button>
                      </div>
                    </Card.Body>
                  </Card>
                );
              })}
            </div>
          )}
    </>
  );
}
