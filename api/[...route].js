import accounts from '../routes/accounts.js';
import assign from '../routes/assign.js';
import activities from '../routes/activities.js';
import contacts from '../routes/contacts.js';
import customers from '../routes/customers.js';
import dashboard from '../routes/dashboard.js';
import deals from '../routes/deals.js';
import dealSummary from '../routes/deals/summary.js';
import duplicates from '../routes/duplicates.js';
import imports from '../routes/imports.js';
import invoices from '../routes/invoices.js';
import leads from '../routes/leads.js';
import leadBulk from '../routes/leads/bulk.js';
import leadConvert from '../routes/leads/convert.js';
import meetings from '../routes/meetings.js';
import notes from '../routes/notes.js';
import pipelines from '../routes/pipelines.js';
import reports from '../routes/reports.js';
import savedViews from '../routes/saved-views.js';
import search from '../routes/search.js';
import sendInvoiceEmail from '../routes/send-invoice-email.js';
import team from '../routes/team.js';

const routeHandlers = {
  accounts,
  assign,
  activities,
  contacts,
  customers,
  dashboard,
  deals,
  'deals/summary': dealSummary,
  duplicates,
  invoices,
  imports,
  leads,
  'leads/bulk': leadBulk,
  'leads/convert': leadConvert,
  meetings,
  notes,
  pipelines,
  reports,
  'saved-views': savedViews,
  search,
  'send-invoice-email': sendInvoiceEmail,
  team,
};

export default function handler(req, res) {
  const route = getRoute(req);
  const routeHandler = routeHandlers[route];

  if (!routeHandler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({
      error: {
        code: 'not_found',
        message: 'API route not found.',
      },
    }));
  }

  return routeHandler(req, res);
}

function getRoute(req) {
  const requestUrl = typeof req.url === 'string' ? req.url : '/';
  const pathname = new URL(requestUrl, 'http://localhost').pathname;
  const apiPath = pathname.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
  if (apiPath && apiPath !== pathname) return decodeURIComponent(apiPath);

  const routeParam = req.query?.route;
  if (Array.isArray(routeParam)) return routeParam.map(decodeURIComponent).join('/');
  return typeof routeParam === 'string' ? decodeURIComponent(routeParam) : apiPath;
}
