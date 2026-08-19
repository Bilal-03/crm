import React, { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from '../ErrorBoundary.jsx';
import { APP_ROUTES } from './routes.js';

const CRMApp = lazy(() => import('../../crm-system.jsx'));

function RoutedCRMApp() {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={(
          <div className="min-h-screen bg-gray-50 p-6 md:p-8" aria-busy="true" aria-label="Loading CRM application">
            <div className="mx-auto max-w-7xl space-y-6 animate-pulse">
              <div className="h-10 w-56 rounded-lg bg-gray-200" />
              <div className="h-72 rounded-2xl bg-white shadow-sm" />
            </div>
          </div>
        )}
      >
        <CRMApp />
      </Suspense>
    </ErrorBoundary>
  );
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      {APP_ROUTES.map(route => (
        <Route key={route.id} path={route.path} element={<RoutedCRMApp />} />
      ))}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
