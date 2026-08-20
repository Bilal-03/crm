import accounts from '../routes/accounts.js';
import assign from '../routes/assign.js';
import activities from '../routes/activities.js';
import contacts from '../routes/contacts.js';
import communicationStatus from '../routes/communication-status.js';
import calendarEvents from '../routes/calendar-events.js';
import googleCalendarConnect from '../routes/integrations/google-calendar/connect.js';
import googleCalendarCallback from '../routes/integrations/google-calendar/callback.js';
import googleCalendarDisconnect from '../routes/integrations/google-calendar/disconnect.js';
import customers from '../routes/customers.js';
import dashboard from '../routes/dashboard.js';
import deals from '../routes/deals.js';
import dealSummary from '../routes/deals/summary.js';
import duplicates from '../routes/duplicates.js';
import imports from '../routes/imports.js';
import invoices from '../routes/invoices.js';
import invoiceActions from '../routes/invoices/actions.js';
import leads from '../routes/leads.js';
import leadBulk from '../routes/leads/bulk.js';
import leadConvert from '../routes/leads/convert.js';
import meetings from '../routes/meetings.js';
import messages from '../routes/messages.js';
import notifications from '../routes/notifications.js';
import notes from '../routes/notes.js';
import pipelines from '../routes/pipelines.js';
import payments from '../routes/payments.js';
import paymentActions from '../routes/payments/actions.js';
import quotes from '../routes/quotes.js';
import quoteActions from '../routes/quotes/actions.js';
import financialEvents from '../routes/financial-events.js';
import financialSettings from '../routes/financial-settings.js';
import goals from '../routes/goals.js';
import reports from '../routes/reports.js';
import reportExport from '../routes/reports/export.js';
import savedViews from '../routes/saved-views.js';
import search from '../routes/search.js';
import sendInvoiceEmail from '../routes/send-invoice-email.js';
import team from '../routes/team.js';
import emailTemplates from '../routes/email-templates.js';
import automations from '../routes/automations.js';

const routeHandlers = {
  accounts,
  assign,
  activities,
  contacts,
  'communication-status': communicationStatus,
  'calendar-events': calendarEvents,
  'integrations/google-calendar/connect': googleCalendarConnect,
  'integrations/google-calendar/callback': googleCalendarCallback,
  'integrations/google-calendar/disconnect': googleCalendarDisconnect,
  customers,
  dashboard,
  deals,
  'deals/summary': dealSummary,
  duplicates,
  invoices,
  'invoices/actions': invoiceActions,
  imports,
  leads,
  'leads/bulk': leadBulk,
  'leads/convert': leadConvert,
  meetings,
  messages,
  notifications,
  notes,
  pipelines,
  payments,
  'payments/actions': paymentActions,
  quotes,
  'quotes/actions': quoteActions,
  'financial-events': financialEvents,
  'financial-settings': financialSettings,
  goals,
  reports,
  'reports/export': reportExport,
  'saved-views': savedViews,
  search,
  'send-invoice-email': sendInvoiceEmail,
  team,
  'email-templates': emailTemplates,
  automations,
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
  const routeParam = req.query?.route;
  if (Array.isArray(routeParam)) return routeParam.map(decodeURIComponent).join('/');
  if (typeof routeParam === 'string' && routeParam) return decodeURIComponent(routeParam);

  const requestUrl = typeof req.url === 'string' ? req.url : '/';
  const pathname = new URL(requestUrl, 'http://localhost').pathname;
  const apiPath = pathname.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
  if (apiPath && apiPath !== pathname) return decodeURIComponent(apiPath);
  return apiPath;
}
