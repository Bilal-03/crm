export const APP_ROUTES = Object.freeze([
  { id: 'dashboard', path: '/dashboard' },
  { id: 'leads', path: '/leads' },
  { id: 'clients', path: '/clients' },
  { id: 'pipeline', path: '/pipeline' },
  { id: 'meetings', path: '/meetings' },
  { id: 'invoices', path: '/invoices' },
  { id: 'reports', path: '/reports' },
  { id: 'team', path: '/team' },
]);

const routeById = new Map(APP_ROUTES.map(route => [route.id, route]));
const routeByPath = new Map(APP_ROUTES.map(route => [route.path, route]));

export function pathForPage(page) {
  return routeById.get(page)?.path || routeById.get('dashboard').path;
}

export function pageFromPathname(pathname) {
  return routeByPath.get(pathname)?.id || 'dashboard';
}
