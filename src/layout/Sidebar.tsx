import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import { Badge } from 'react-bootstrap';
import Avatar from '../components/Avatar';

export default function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const [reportingOpen, setReportingOpen] = useState(true);
  const { profile } = useAuth();
  const { unreadCount, notifications } = useNotifications();
  const isBob = profile?.role === 'bob';
  const reportingUnread = notifications.filter(n => !n.read_at && n.link?.startsWith('/reporting/')).length;
  const isApc = profile?.role === 'apc';
  const isTeamLead = profile?.role === 'team_lead';
  // Ads Manager: APC-like view-only nav (Brands / Resources / Reporting).
  const isAdsManager = profile?.role === 'ads_manager';
  // Paid Collab Handler: the workspace only — no reporting.
  const isHandler = profile?.role === 'paid_collab_handler';

  return (
    <aside className="ac-sidebar">
      <div className="brand">
        <img className="ac-brand-mark" src="/apex-mobile-logo.svg" alt="ApexGMVOS" width={30} height={28} />
        <span className="ac-brand-text">
          ApexGMVOS
          <small>by ApexGMV</small>
        </span>
      </div>
      <nav className="ac-nav">
        {isHandler ? (
          <>
            <NavLink to="/paid-collab/dashboard" title="Dashboard">
              <i className="bi bi-speedometer2" /> <span className="ac-nav-label">Dashboard</span>
            </NavLink>
            <NavLink to="/paid-collab" end title="Workspace">
              <i className="bi bi-tools" /> <span className="ac-nav-label">Workspace</span>
            </NavLink>
            <NavLink to="/paid-collab/notes" title="Private Notes">
              <i className="bi bi-journal-text" /> <span className="ac-nav-label">Private Notes</span>
            </NavLink>
          </>
        ) : isApc || isAdsManager ? (
          <>
            <NavLink to="/brands" title="Brands">
              <i className="bi bi-shop" /> <span className="ac-nav-label">Brands</span>
            </NavLink>
            <NavLink to="/resources" title="Resources">
              <i className="bi bi-folder2" /> <span className="ac-nav-label">Resources</span>
            </NavLink>
          </>
        ) : isTeamLead ? (
          <>
            <NavLink to="/brands" title="Brands">
              <i className="bi bi-shop" /> <span className="ac-nav-label">Brands</span>
            </NavLink>
            <NavLink to="/apcs" title="APCs">
              <i className="bi bi-people" /> <span className="ac-nav-label">APCs</span>
            </NavLink>
            <NavLink to="/resources" title="Resources">
              <i className="bi bi-folder2" /> <span className="ac-nav-label">Resources</span>
            </NavLink>
          </>
        ) : (
          <>
            <NavLink to="/dashboard" title="Dashboard">
              <i className="bi bi-speedometer2" /> <span className="ac-nav-label">Dashboard</span>
            </NavLink>
            {isBob && (
              <>
                <NavLink to="/brands" title="Brands">
                  <i className="bi bi-shop" /> <span className="ac-nav-label">Brands</span>
                </NavLink>
                <NavLink to="/clients" title="Clients">
                  <i className="bi bi-building" /> <span className="ac-nav-label">Clients</span>
                </NavLink>
                {/* Teams — one hub for Team Leads / APCs / Ads Managers / Bobs. */}
                <NavLink to="/teams" title="Teams">
                  <i className="bi bi-diagram-3" /> <span className="ac-nav-label">Teams</span>
                </NavLink>
                <NavLink to="/paid-collab" end title="Paid Collab">
                  <i className="bi bi-camera-video" /> <span className="ac-nav-label">Paid Collab</span>
                </NavLink>
                <NavLink to="/paid-collab/dashboard" title="Collab Dashboard">
                  <i className="bi bi-bar-chart-line" /> <span className="ac-nav-label">Collab Dashboard</span>
                </NavLink>
                <NavLink to="/client-access" title="Client Access">
                  <i className="bi bi-link-45deg" /> <span className="ac-nav-label">Client Access</span>
                </NavLink>
                <NavLink to="/resources" title="Resources">
                  <i className="bi bi-folder2" /> <span className="ac-nav-label">Resources</span>
                </NavLink>
              </>
            )}
          </>
        )}
        {isHandler ? null : collapsed ? (
          <NavLink to="/reporting/weekly" title="Reporting">
            <i className="bi bi-bar-chart" />
            {reportingUnread > 0 && <Badge bg="danger" pill className="ms-2 ac-nav-label">{reportingUnread}</Badge>}
          </NavLink>
        ) : (
          <>
            <button className="ac-nav-toggle" onClick={() => setReportingOpen(o => !o)}>
              <i className="bi bi-bar-chart" /> <span className="ac-nav-label">Reporting</span>
              {reportingUnread > 0 && <Badge bg="danger" pill className="ms-2 ac-nav-label">{reportingUnread}</Badge>}
              <i className={`bi ms-auto ac-nav-label ${reportingOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} />
            </button>
            {reportingOpen && (
              <div className="ac-sub">
                <NavLink to="/reporting/weekly">
                  <span className="ac-nav-label">Weekly {reportingUnread > 0 && <Badge bg="danger" pill className="ms-1">{reportingUnread}</Badge>}</span>
                </NavLink>
                <NavLink to="/reporting/bi-weekly"><span className="ac-nav-label">Bi-Weekly</span></NavLink>
                <NavLink to="/reporting/monthly"><span className="ac-nav-label">Monthly</span></NavLink>
              </div>
            )}
          </>
        )}
        <NavLink to="/notifications" title="Notifications">
          <i className="bi bi-bell" /> <span className="ac-nav-label">Notifications</span>
          {unreadCount > 0 && <Badge bg="danger" pill className="ms-2">{unreadCount}</Badge>}
        </NavLink>
      </nav>
      <div className="footer">
        <NavLink to="/profile" title="My Profile" className="ac-profile-link d-flex align-items-center gap-2">
          <Avatar
            name={profile?.full_name || profile?.email || 'User'}
            src={profile?.avatar_url}
            size="sm"
          />
          <div className="min-w-0 ac-nav-label">
            <div className="text-truncate" >
              {profile?.full_name ?? profile?.email}
            </div>
            <small className="text-muted">Role: {profile?.is_superbob ? 'super boss' : profile?.role?.replace(/_/g, ' ') ?? '—'}</small>
          </div>
          <i className="bi bi-chevron-right ms-auto ac-nav-label" />
        </NavLink>
      </div>
    </aside>
  );
}
