import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Nav } from 'react-bootstrap';
import { useAuth } from '../auth/AuthContext';
import TeamLeads from './TeamLeads';
import APCs from './APCs';
import AdsManagers from './AdsManagers';
import Bobs from './Bobs';

// "Teams" — a single Bob/Super Boss hub that consolidates what used to be four
// separate sidebar links (Team Leads, APCs, Ads Managers, Bobs) into one page
// with top tabs, clearing the sidebar. The Bobs tab only shows to a Super Boss
// (mirrors the /bobs page self-guard).

type TabKey = 'team-leads' | 'apcs' | 'ads-managers' | 'bobs';

const TABS: { key: TabKey; label: string; icon: string; superOnly?: boolean }[] = [
  { key: 'team-leads',           label: 'Team Leads',           icon: 'bi-diagram-3' },
  { key: 'apcs',                 label: 'APCs',                 icon: 'bi-people' },
  { key: 'ads-managers',         label: 'Ads Managers',         icon: 'bi-badge-ad' },
  { key: 'bobs',                 label: 'Bobs',                 icon: 'bi-person-badge', superOnly: true },
];

export default function Teams() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();

  // A stale ?tab= falls through to the first visible tab.
  const visibleTabs = useMemo(
    () => TABS.filter(t => !t.superOnly || profile?.is_superbob),
    [profile?.is_superbob]
  );

  const tabFromUrl = params.get('tab') as TabKey | null;
  const currentTab: TabKey = useMemo(() => {
    const found = visibleTabs.find(t => t.key === tabFromUrl);
    return found?.key ?? visibleTabs[0].key;
  }, [visibleTabs, tabFromUrl]);

  const setTab = (k: TabKey) => {
    params.set('tab', k);
    setParams(params, { replace: true });
  };

  return (
    <div>
      <h4 className="mb-3">Teams</h4>
      <Card className="mb-3">
        <Card.Body className="py-2">
          <Nav variant="tabs" activeKey={currentTab} onSelect={(k) => k && setTab(k as TabKey)}>
            {visibleTabs.map(t => (
              <Nav.Item key={t.key}>
                <Nav.Link eventKey={t.key}>
                  <i className={`bi ${t.icon} me-1`} />{t.label}
                </Nav.Link>
              </Nav.Item>
            ))}
          </Nav>
        </Card.Body>
      </Card>

      {currentTab === 'team-leads'           && <TeamLeads />}
      {currentTab === 'apcs'                 && <APCs />}
      {currentTab === 'ads-managers'         && <AdsManagers />}
      {currentTab === 'bobs'                 && <Bobs />}
    </div>
  );
}
