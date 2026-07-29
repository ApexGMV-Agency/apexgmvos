import { Button, Dropdown, Badge } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import { requestNotificationPermission, subscribePush } from '../notifications/swSetup';
import { useEffect, useState } from 'react';

export default function Topbar({ collapsed, onToggleSidebar }: { collapsed: boolean; onToggleSidebar: () => void }) {
  const { profile, user, signOut } = useAuth();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const nav = useNavigate();
  const [permission, setPermission] = useState<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'default');

  useEffect(() => {
    if (permission === 'granted' && user) subscribePush(user.id);
  }, [permission, user]);

  const enableNotifications = async () => {
    const p = await requestNotificationPermission();
    setPermission(p);
  };

  const recent = notifications.slice(0, 6);

  return (
    <div className="ac-topbar">
      <div className="d-flex align-items-center gap-3">
        <Button
          variant="light"
          size="sm"
          onClick={onToggleSidebar}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          className="ac-sidebar-toggle"
        >
          <i className={`bi ${collapsed ? 'bi-list' : 'bi-layout-sidebar-inset'}`} />
        </Button>
        <div className="fw-semibold">Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}</div>
      </div>
      <div className="d-flex align-items-center gap-2">
        <Dropdown align="end">
          <Dropdown.Toggle variant="light" size="sm" id="notif-bell" className="position-relative">
            <i className="bi bi-bell" />
            {unreadCount > 0 && (
              <Badge bg="danger" pill className="position-absolute top-0 start-100 translate-middle" style={{ fontSize: '.6rem' }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </Dropdown.Toggle>
          <Dropdown.Menu style={{ width: 360, maxHeight: 480, overflowY: 'auto' }}>
            <div className="px-3 py-2 d-flex justify-content-between align-items-center border-bottom">
              <strong>Notifications</strong>
              {unreadCount > 0 && (
                <button className="btn btn-link btn-sm p-0" onClick={markAllRead}>Mark all read</button>
              )}
            </div>
            {permission !== 'granted' && (
              <div className="px-3 py-2 border-bottom small">
                <i className="bi bi-info-circle text-muted me-1" />
                <button className="btn btn-link btn-sm p-0 align-baseline" onClick={enableNotifications}>Enable browser notifications</button>
              </div>
            )}
            {recent.length === 0 ? (
              <div className="text-muted small text-center py-3">No notifications</div>
            ) : recent.map(n => (
              <Dropdown.Item key={n.id} onClick={() => { markRead(n.id); if (n.link) nav(n.link); }} className="py-2">
                <div className="d-flex align-items-start gap-2">
                  {!n.read_at && <span className="bg-primary rounded-circle mt-2" style={{ width: 8, height: 8, flexShrink: 0 }} />}
                  <div style={{ minWidth: 0, flex: 1, whiteSpace: 'normal' }}>
                    <div className="fw-semibold small">{n.title}</div>
                    {n.body && <div className="text-muted" style={{ fontSize: '.78rem' }}>{n.body}</div>}
                    <small className="text-muted" style={{ fontSize: '.7rem' }}>{new Date(n.created_at).toLocaleString()}</small>
                  </div>
                </div>
              </Dropdown.Item>
            ))}
            <Dropdown.Divider />
            <Dropdown.Item as="button" onClick={() => nav('/notifications')} className="text-center">View all</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>

        <Dropdown align="end">
          <Dropdown.Toggle variant="light" size="sm" className="d-flex align-items-center" title={profile?.email}>
            <Avatar
              name={profile?.full_name || profile?.email || 'User'}
              src={profile?.avatar_url}
              size="sm"
            />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.ItemText>Role: <strong>{profile?.is_superbob ? 'super boss' : profile?.role}</strong></Dropdown.ItemText>
            <Dropdown.Divider />
            <Dropdown.Item as="button" onClick={() => nav('/profile')}>
              <i className="bi bi-person me-2" />My Profile
            </Dropdown.Item>
            <Dropdown.Item as="button" onClick={signOut}>Sign out</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </div>
    </div>
  );
}
