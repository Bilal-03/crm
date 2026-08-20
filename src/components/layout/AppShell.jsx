import React from 'react';

export function AppShell({ sidebar, sidebarOverlay, header, mobileNav, children }) {
  return (
    <div className="crm-app-shell flex h-screen overflow-hidden font-sans">
      {sidebar}
      {sidebarOverlay}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {header}
        <main className="flex-1 overflow-y-auto p-4 pb-24 md:p-8">{children}</main>
      </div>
      {mobileNav}
    </div>
  );
}
