import React from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';

export function LoadingState({ label = 'Loading…', compact = false }) {
  return (
    <div className={`flex items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white text-sm text-gray-600 shadow-sm ${compact ? 'p-6' : 'min-h-56 p-10'}`} role="status" aria-busy="true">
      <Loader2 className="h-5 w-5 animate-spin text-indigo-600" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message = 'Something went wrong.', onRetry }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900" role="alert">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">This section could not load</h2>
          <p className="mt-1 text-sm text-red-800">{message}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-4 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-100">
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ResourceEmptyState({ title, description, actionLabel, onAction }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
        <Inbox className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">{description}</p>
      {actionLabel && (
        <button type="button" onClick={onAction} className="mt-5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
