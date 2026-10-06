import { Routes, Route, Navigate } from 'react-router-dom';
import BrandLoader from './components/BrandLoader';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import Layout from './layout/Layout';
import Dashboard from './pages/Dashboard';
import Brands from './pages/Brands';
import BrandDetail from './pages/BrandDetail';
import APCs from './pages/APCs';
import Clients from './pages/Clients';
import ClientAccess from './pages/ClientAccess';
import Resources from './pages/Resources';
import NotificationsPage from './pages/Notifications';
import Profile from './pages/Profile';
import SharedReports from './pages/SharedReports';
import Reporting from './pages/Reporting';
import BudgetManager from './pages/BudgetManager';
import CompanyBudget from './pages/CompanyBudget';
import WeeklyReports from './pages/WeeklyReports';
import WeeklyReportEdit from './pages/WeeklyReportEdit';
import WeeklyReportView from './pages/WeeklyReportView';
import MonthlyReports from './pages/MonthlyReports';
import MonthlyReportEdit from './pages/MonthlyReportEdit';
import MonthlyReportView from './pages/MonthlyReportView';
import ReportingCanvasList from './pages/templates/ReportingCanvasList';
import ReportingCanvasEditor from './pages/templates/ReportingCanvasEditor';
import TeamLeads from './pages/TeamLeads';
import AdsManagers from './pages/AdsManagers';
import Bobs from './pages/Bobs';
import Teams from './pages/Teams';
import SopsPage from './pages/sops/SopsPage';
import SharedSop from './pages/sops/SharedSop';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';

function RoleHome() {
  const { profile, loading } = useAuth();
  // Wait for the profile before routing — otherwise a non-Bob role briefly falls
  // through to /dashboard and hits the role guard's denied page.
  if (loading || !profile) return <BrandLoader />;
  if (profile.role === 'apc' || profile.role === 'team_lead' || profile.role === 'ads_manager') return <Navigate to="/brands" replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      <Route path="/terms-of-service" element={<TermsOfService />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/share/:token" element={<SharedReports />} />
      <Route path="/sop/:token" element={<SharedSop />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<RoleHome />} />
        <Route path="dashboard" element={<ProtectedRoute roles={['bob', 'apc']}><Dashboard /></ProtectedRoute>} />
        <Route path="brands" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead', 'ads_manager']}><Brands /></ProtectedRoute>} />
        <Route path="brands/:id" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead', 'ads_manager']}><BrandDetail /></ProtectedRoute>} />
        <Route path="apcs" element={<ProtectedRoute roles={['bob', 'team_lead']}><APCs /></ProtectedRoute>} />
        <Route path="ads-managers" element={<ProtectedRoute roles={['bob']}><AdsManagers /></ProtectedRoute>} />
        <Route path="team-leads" element={<ProtectedRoute roles={['bob']}><TeamLeads /></ProtectedRoute>} />
        {/* Teams — Bob/Super Boss hub consolidating Team Leads / APCs / Ads Managers / Bobs. */}
        <Route path="teams" element={<ProtectedRoute roles={['bob']}><Teams /></ProtectedRoute>} />
        {/* Bobs management — role-gated to bob here; the page itself additionally requires is_superbob. */}
        <Route path="bobs" element={<ProtectedRoute roles={['bob']}><Bobs /></ProtectedRoute>} />
        <Route path="clients" element={<ProtectedRoute roles={['bob']}><Clients /></ProtectedRoute>} />
        <Route path="client-access" element={<ProtectedRoute roles={['bob']}><ClientAccess /></ProtectedRoute>} />
        {/* Cross-brand SOP overview — URL only, no sidebar link. */}
        <Route path="sops" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead', 'ads_manager']}><SopsPage /></ProtectedRoute>} />
        <Route path="resources" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead', 'ads_manager']}><Resources /></ProtectedRoute>} />
        <Route path="budget" element={<Navigate to="/budget/brands" replace />} />
        <Route path="budget/brands" element={<ProtectedRoute roles={['bob']}><BudgetManager /></ProtectedRoute>} />
        <Route path="budget/company" element={<ProtectedRoute roles={['bob']}><CompanyBudget /></ProtectedRoute>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<Profile />} />
        <Route path="reporting/weekly" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead', 'ads_manager']}><WeeklyReports /></ProtectedRoute>} />
        <Route path="reporting/weekly/:id" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead', 'ads_manager']}><WeeklyReportView /></ProtectedRoute>} />
        {/* Report EDIT routes stay closed to ads_manager (view-only role). */}
        <Route path="reporting/weekly/:id/edit" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><WeeklyReportEdit /></ProtectedRoute>} />
        <Route path="reporting/monthly" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead', 'ads_manager']}><MonthlyReports /></ProtectedRoute>} />
        <Route path="reporting/monthly/:id" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead', 'ads_manager']}><MonthlyReportView /></ProtectedRoute>} />
        <Route path="reporting/monthly/:id/edit" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead']}><MonthlyReportEdit /></ProtectedRoute>} />
        <Route path="reporting/bi-weekly" element={<ProtectedRoute roles={['bob', 'apc', 'team_lead', 'ads_manager']}><Reporting kind="Bi-Weekly" /></ProtectedRoute>} />
        <Route path="templates" element={<ProtectedRoute roles={['bob', 'apc']}><ReportingCanvasList /></ProtectedRoute>} />
        <Route path="templates/:id" element={<ProtectedRoute roles={['bob']}><ReportingCanvasEditor /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
