import React from 'react';

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-[#6366F1]">
        <Icon className="h-7 w-7" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">{description}</p>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 rounded-xl bg-[#6366F1] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#5558d9]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
