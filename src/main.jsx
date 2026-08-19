import React from 'react'
import ReactDOM from 'react-dom/client'
import CRMApp from '../crm-system.jsx'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'
import { ErrorBoundary } from './ErrorBoundary.jsx'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const clerkDeploymentMode = (import.meta.env.VITE_CLERK_DEPLOYMENT_MODE || 'production').trim().toLowerCase()
const isProductionTestKey = clerkDeploymentMode !== 'development' && PUBLISHABLE_KEY?.startsWith('pk_test_')

const root = ReactDOM.createRoot(document.getElementById('root'))

root.render(
  <React.StrictMode>
    {PUBLISHABLE_KEY && !isProductionTestKey ? (
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <ErrorBoundary>
          <CRMApp />
        </ErrorBoundary>
      </ClerkProvider>
    ) : (
      <main className="min-h-screen grid place-items-center bg-gray-50 p-6">
        <section className="max-w-lg rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">Application configuration is incomplete</h1>
          <p className="mt-2 text-gray-600">
            {isProductionTestKey
              ? 'Production builds must use a live Clerk publishable key (pk_live_…).'
              : 'Set VITE_CLERK_PUBLISHABLE_KEY and rebuild the application.'}
          </p>
        </section>
      </main>
    )}
  </React.StrictMode>,
)
