import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Mail, Plus, RefreshCw, RotateCcw, Send, Unplug } from 'lucide-react';
import { ErrorState, LoadingState } from '../../components/ui/ResourceState.jsx';

const EMPTY_MESSAGE = { target: '', recipient: '', template_id: '', subject: '', body_text: '' };
const EMPTY_TEMPLATE = { name: '', subject: '', body_text: '' };

export default function CommunicationsWorkspace({ request, leads = [], accounts = [], contacts = [], deals = [], onNotify, onSent }) {
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [messageForm, setMessageForm] = useState(EMPTY_MESSAGE);
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE);
  const targets = useMemo(() => buildTargets({ leads, accounts, contacts, deals }), [leads, accounts, contacts, deals]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [messageRows, templateRows, integrationStatus] = await Promise.all([
        request('/messages?pageSize=50'),
        request('/email-templates?pageSize=100&state=active'),
        request('/communication-status'),
      ]);
      setMessages(messageRows || []);
      setTemplates(templateRows || []);
      setStatus(integrationStatus);
    } catch (loadError) {
      setError(loadError.message || 'Communication records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('integration') === 'google-calendar-connected') onNotify?.('Google Calendar connected.');
    if (params.get('integration_error')) onNotify?.('Google Calendar could not be connected. Please try again.', 'error');
    if (params.has('integration') || params.has('integration_error')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [onNotify]);

  const connectCalendar = async () => {
    setCalendarBusy(true);
    try {
      const result = await request('/integrations/google-calendar/connect', { method: 'POST', body: {} });
      window.location.assign(result.authorizationUrl);
    } catch (connectError) {
      onNotify?.(connectError.message || 'Google Calendar connection could not be started.', 'error');
      setCalendarBusy(false);
    }
  };

  const disconnectCalendar = async () => {
    setCalendarBusy(true);
    try {
      await request('/integrations/google-calendar/disconnect', { method: 'POST', body: {} });
      onNotify?.('Google Calendar disconnected. Existing Google events were not deleted.');
      await load();
    } catch (disconnectError) {
      onNotify?.(disconnectError.message || 'Google Calendar could not be disconnected.', 'error');
    } finally {
      setCalendarBusy(false);
    }
  };

  const updateMessage = (field, value) => setMessageForm(previous => ({ ...previous, [field]: value }));
  const selectTarget = value => {
    const target = targets.find(item => item.value === value);
    setMessageForm(previous => ({ ...previous, target: value, recipient: target?.email || previous.recipient }));
  };
  const selectTemplate = value => {
    const template = templates.find(item => item.id === value);
    setMessageForm(previous => ({
      ...previous,
      template_id: value,
      subject: template?.subject || previous.subject,
      body_text: template?.body_text || previous.body_text,
    }));
  };

  const sendMessage = async event => {
    event.preventDefault();
    const target = parseTarget(messageForm.target);
    if (!target) return;
    setSending(true);
    try {
      await request('/messages', {
        method: 'POST',
        body: {
          recipient: messageForm.recipient,
          subject: messageForm.subject,
          body_text: messageForm.body_text,
          template_id: messageForm.template_id || null,
          idempotency_key: crypto.randomUUID(),
          [target.field]: target.id,
        },
      });
      setMessageForm(EMPTY_MESSAGE);
      onNotify?.('Email sent and added to the CRM timeline.');
      await onSent?.();
      await load();
    } catch (sendError) {
      onNotify?.(sendError.message || 'The email could not be sent.', 'error');
      await load();
    } finally {
      setSending(false);
    }
  };

  const retryMessage = async message => {
    setSending(true);
    try {
      await request('/messages', {
        method: 'POST',
        body: {
          recipient: message.recipient,
          subject: message.subject,
          body_text: message.body_text,
          idempotency_key: crypto.randomUUID(),
          retry_of_id: message.id,
          [`${message.target.resource}_id`]: message.target.id,
        },
      });
      onNotify?.('Email retry sent.');
      await onSent?.();
    } catch (retryError) {
      onNotify?.(retryError.message || 'The retry could not be sent.', 'error');
    } finally {
      setSending(false);
      await load();
    }
  };

  const createTemplate = async event => {
    event.preventDefault();
    setSavingTemplate(true);
    try {
      await request('/email-templates', { method: 'POST', body: templateForm });
      setTemplateForm(EMPTY_TEMPLATE);
      onNotify?.('Email template created.');
      await load();
    } catch (templateError) {
      onNotify?.(templateError.message || 'The template could not be saved.', 'error');
    } finally {
      setSavingTemplate(false);
    }
  };

  const deactivateTemplate = async template => {
    try {
      await request(`/email-templates?id=${template.id}`, { method: 'DELETE' });
      onNotify?.('Email template archived.');
      await load();
    } catch (templateError) {
      onNotify?.(templateError.message || 'The template could not be archived.', 'error');
    }
  };

  if (loading && !status) return <LoadingState label="Loading communication workspace…" />;
  if (error && !status) return <ErrorState title="Communications unavailable" message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Communication and integrations</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">Communications</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">Compose customer email inside CRM Pro, retain delivery state, and keep every successful message on the related record timeline.</p></div>
        <button type="button" onClick={load} className="crm-btn crm-btn-secondary"><RefreshCw className="h-4 w-4" />Refresh</button>
      </header>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <section className="grid gap-4 md:grid-cols-2">
        <IntegrationCard icon={Mail} title="Transactional email" connected={status?.email?.configured} detail={status?.email?.configured ? `${status.email.provider} · ${status.email.fromAddress}` : status?.email?.configurationError || 'Email provider is not configured.'} />
        <IntegrationCard
          icon={CalendarClock}
          title="Google Calendar"
          connected={status?.calendar?.connected}
          detail={status?.calendar?.connected ? `Connected as ${status.calendar.connection?.display_name || 'Google account'}` : status?.calendar?.message || 'Calendar OAuth is not connected.'}
          action={!status?.calendar?.providerConfigured ? null : status?.calendar?.connected
            ? <button type="button" disabled={calendarBusy} onClick={disconnectCalendar} className="crm-btn crm-btn-secondary mt-3">Disconnect</button>
            : <button type="button" disabled={calendarBusy} onClick={connectCalendar} className="crm-btn crm-btn-primary mt-3">{calendarBusy ? 'Connecting…' : 'Connect Google Calendar'}</button>}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-2"><Send className="h-5 w-5 text-indigo-600" /><h2 className="text-lg font-bold text-gray-950">Compose email</h2></div>
          <form onSubmit={sendMessage} className="mt-5 space-y-4">
            <Field label="Related CRM record"><select required value={messageForm.target} onChange={event => selectTarget(event.target.value)}><option value="">Select a lead, contact, account or deal</option>{targets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}</select></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Recipient"><input required type="email" value={messageForm.recipient} onChange={event => updateMessage('recipient', event.target.value)} placeholder="customer@example.com" /></Field><Field label="Template"><select value={messageForm.template_id} onChange={event => selectTemplate(event.target.value)}><option value="">No template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field></div>
            <Field label="Subject"><input required maxLength={200} value={messageForm.subject} onChange={event => updateMessage('subject', event.target.value)} /></Field>
            <Field label="Message"><textarea required rows={9} maxLength={20000} value={messageForm.body_text} onChange={event => updateMessage('body_text', event.target.value)} /></Field>
            {!status?.email?.configured && <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Configure the email provider before sending. Failed attempts remain visible and retryable.</p>}
            <button type="submit" disabled={sending} className="crm-btn crm-btn-primary w-full"><Send className="h-4 w-4" />{sending ? 'Sending…' : 'Send and log email'}</button>
          </form>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-2"><Plus className="h-5 w-5 text-indigo-600" /><h2 className="text-lg font-bold text-gray-950">Email templates</h2></div>
          <form onSubmit={createTemplate} className="mt-5 space-y-3"><Field label="Template name"><input required maxLength={120} value={templateForm.name} onChange={event => setTemplateForm(previous => ({ ...previous, name: event.target.value }))} /></Field><Field label="Subject"><input required maxLength={200} value={templateForm.subject} onChange={event => setTemplateForm(previous => ({ ...previous, subject: event.target.value }))} /></Field><Field label="Message"><textarea required rows={5} maxLength={20000} value={templateForm.body_text} onChange={event => setTemplateForm(previous => ({ ...previous, body_text: event.target.value }))} /></Field><button type="submit" disabled={savingTemplate} className="crm-btn crm-btn-secondary w-full">{savingTemplate ? 'Saving…' : 'Save template'}</button></form>
          <div className="mt-5 space-y-2 border-t border-gray-100 pt-5">{templates.length ? templates.map(template => <div key={template.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 p-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-gray-900">{template.name}</p><p className="truncate text-xs text-gray-500">{template.subject}</p></div><button type="button" onClick={() => deactivateTemplate(template)} className="text-xs font-semibold text-gray-500 hover:text-red-600">Archive</button></div>) : <p className="text-sm text-gray-500">No active templates yet.</p>}</div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 p-5"><h2 className="text-lg font-bold text-gray-950">Outbound history</h2><p className="mt-1 text-sm text-gray-500">Provider IDs, delivery failures and retry lineage are retained for support and audit.</p></div>
        <div className="divide-y divide-gray-100">{messages.length ? messages.map(message => <article key={message.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={message.status} /><p className="truncate font-bold text-gray-900">{message.subject}</p></div><p className="mt-1 text-sm text-gray-600">To {message.recipient} · {message.target?.name || 'Linked CRM record'}</p><p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-500">{message.body_text}</p>{message.failure_reason && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{message.failure_reason}</p>}<p className="mt-2 text-xs text-gray-400">{formatDateTime(message.created_at)}{message.provider_message_id ? ` · ${message.provider}: ${message.provider_message_id}` : ''}{message.retry_of_id ? ' · Retry' : ''}</p></div>{message.status === 'failed' && <button type="button" disabled={sending} onClick={() => retryMessage(message)} className="crm-btn crm-btn-secondary shrink-0"><RotateCcw className="h-4 w-4" />Retry</button>}</article>) : <p className="p-10 text-center text-sm text-gray-500">No outbound messages have been recorded.</p>}</div>
      </section>
    </div>
  );
}

function buildTargets({ leads, accounts, contacts, deals }) {
  return [
    ...leads.map(item => ({ value: `lead:${item.id}`, label: `Lead · ${item.name}`, email: item.email || '' })),
    ...contacts.map(item => ({ value: `contact:${item.id}`, label: `Contact · ${item.name}`, email: item.email || '' })),
    ...accounts.map(item => ({ value: `account:${item.id}`, label: `Account · ${item.name}`, email: '' })),
    ...deals.map(item => ({ value: `deal:${item.id}`, label: `Deal · ${item.name}`, email: item.primary_contact?.email || '' })),
  ].sort((a, b) => a.label.localeCompare(b.label));
}
function parseTarget(value) { const [resource, id] = value.split(':'); return resource && id ? { resource, field: `${resource}_id`, id } : null; }
function Field({ label, children }) { return <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">{label}{React.cloneElement(children, { className: 'crm-field mt-1 w-full normal-case tracking-normal' })}</label>; }
function IntegrationCard({ icon: Icon, title, connected, detail, action }) { return <article className={`rounded-2xl border p-5 shadow-sm ${connected ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'}`}><div className="flex items-start gap-3"><span className={`rounded-xl p-2.5 ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{connected ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}</span><div><h2 className="font-bold text-gray-950">{title}</h2><p className="mt-1 text-sm leading-6 text-gray-600">{detail}</p><p className={`mt-2 text-xs font-bold uppercase tracking-wide ${connected ? 'text-emerald-700' : 'text-gray-500'}`}>{connected ? 'Connected' : <span className="inline-flex items-center gap-1"><Unplug className="h-3.5 w-3.5" />Not connected</span>}</p>{action}</div></div></article>; }
function StatusBadge({ status }) { const tone = status === 'failed' ? 'bg-red-50 text-red-700' : status === 'delivered' ? 'bg-emerald-50 text-emerald-700' : status === 'sent' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'; return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tone}`}>{status}</span>; }
function formatDateTime(value) { return value ? new Date(value).toLocaleString() : 'Unknown time'; }
