export const APP_ROUTES = Object.freeze([
  { id: 'dashboard', path: '/dashboard' },
  { id: 'leads', path: '/sales/leads' },
  { id: 'contacts', path: '/sales/contacts' },
  { id: 'accounts', path: '/sales/accounts' },
  { id: 'deals', path: '/sales/deals' },
  { id: 'pipeline', path: '/sales/pipeline' },
  { id: 'meetings', path: '/meetings' },
  { id: 'invoices', path: '/invoices' },
  { id: 'reports', path: '/reports' },
  { id: 'team', path: '/team' },
]);

const LEGACY_ROUTES = Object.freeze([
  { path: '/leads', id: 'leads' },
  { path: '/clients', id: 'accounts' },
  { path: '/pipeline', id: 'pipeline' },
]);

export const APP_ROUTE_PATHS = Object.freeze([...APP_ROUTES, ...LEGACY_ROUTES]);

const routeById = new Map(APP_ROUTES.map(route => [route.id, route]));
const routeByPath = new Map([
  ...APP_ROUTES.map(route => [route.path, route]),
  ...LEGACY_ROUTES.map(route => [route.path, { id: route.id, path: pathForPage(route.id) }]),
]);

export function pathForPage(page) {
  return routeById.get(page)?.path || routeById.get('dashboard').path;
}

export function pageFromPathname(pathname) {
  return routeByPath.get(pathname)?.id || 'dashboard';
}
