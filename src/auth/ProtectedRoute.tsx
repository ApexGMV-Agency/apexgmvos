import { Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth, AppRole } from './AuthContext';
import BrandLoader from '../components/BrandLoader';

export function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: AppRole[];
}) {
  const { session, profile, loading } = useAuth();

  if (loading) return <BrandLoader full />;
  if (!session) return <Navigate to="/login" replace />;
  if (roles && profile && !roles.includes(profile.role)) {
    return (
      <div className="p-5 text-center">
        <h3>Access denied</h3>
        <p className="text-muted">Your role does not have permission to view this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}
