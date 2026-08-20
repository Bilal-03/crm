import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileCheck2, FileText, Plus, Receipt, RefreshCw, Send, Settings2, WalletCards } from 'lucide-react';
import { ErrorState, LoadingState, ResourceEmptyState } from '../../components/ui/ResourceState.jsx';
import { createFinancialPdf, pdfBase64 } from './document-pdf.js';

const today = () => new Date().toISOString().slice(0, 10);
const inThirtyDays = () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const blankLine = () => ({ description: '', quantity: 1, unit_price: 0 });

export default function RevenueWorkspace({ page, request, deals = [], customers = [], onNavigate, onNotify }) {
  const [records, setRecords] = useState([]);
  const [invoiceOptions, setInvoiceOptions] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [quoteForm, setQuoteForm] = useState({ deal_id: '', issue_date: today(), expiry_date: inThirtyDays(), currency: '', description: '', quantity: 1, unit_price: 0, tax_rate: 0, terms: '' });
  const [invoiceForm, setInvoiceForm] = useState({ customer_id: '', deal_id: '', invoice_date: today(), due_date: inThirtyDays(), currency: '', description: '', quantity: 1, unit_price: 0, tax_rate: 0, terms: '' });
  const [paymentForm, setPaymentForm] = useState({ invoice_id: '', amount: '', payment_date: today(), payment_method: '', transaction_reference: '' });
  const [settingsForm, setSettingsForm] = useState({});

  const resource = page === 'quotes' ? 'quotes' : page === 'payments' ? 'payments' : 'invoices';
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, financialSettings, payableInvoices] = await Promise.all([
        page === 'financial-settings' ? Promise.resolve([]) : request(`/${resource}?pageSize=100`),
        request('/financial-settings'),
        page === 'payments' ? request('/invoices?pageSize=100') : Promise.resolve([]),
      ]);
      setRecords(Array.isArray(rows) ? rows : []);
      setInvoiceOptions(Array.isArray(payableInvoices) ? payableInvoices : []);
      setSettings(financialSettings);
      setSettingsForm(financialSettings || {});
      if (selected?.id && resource !== 'payments') {
        setSelected(await request(`/${resource}?id=${selected.id}`));
      }
    } catch (loadError) {
      setError(loadError.message || 'Financial records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [page, request, resource, selected?.id]);

  useEffect(() => { void load(); }, [page, request]);

  const currency = settings?.base_currency || 'USD';
  const money = useMemo(() => new Intl.NumberFormat('en', { style: 'currency', currency }), [currency]);
  const formatMoney = (value, code = currency) => {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(Number(value || 0)); }
    catch { return `${code} ${Number(value || 0).toFixed(2)}`; }
  };

  const mutate = async (operation, message) => {
    setBusy(true);
    try {
      const result = await operation();
      onNotify?.(message);
      setShowForm(false);
      await load();
      return result;
    } catch (mutationError) {
      onNotify?.(mutationError.message || 'The financial operation could not be completed.', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const createQuote = event => {
    event.preventDefault();
    return mutate(() => request('/quotes', { method: 'POST', body: {
      deal_id: quoteForm.deal_id,
      issue_date: quoteForm.issue_date,
      expiry_date: quoteForm.expiry_date || null,
      currency: quoteForm.currency || currency,
      items: [{ ...blankLine(), description: quoteForm.description, quantity: Number(quoteForm.quantity), unit_price: Number(quoteForm.unit_price) }],
      discount_type: 'fixed', discount_value: 0,
      tax_components: Number(quoteForm.tax_rate) > 0 ? [{ name: 'Tax', rate: Number(quoteForm.tax_rate), inclusive: false }] : [],
      terms: quoteForm.terms || null,
    } }), 'Quote created as a draft.');
  };

  const createInvoice = event => {
    event.preventDefault();
    return mutate(() => request('/invoices', { method: 'POST', body: {
      customer_id: invoiceForm.customer_id,
      deal_id: invoiceForm.deal_id || null,
      invoice_date: invoiceForm.invoice_date,
      due_date: invoiceForm.due_date,
      currency: invoiceForm.currency || currency,
      items: [{ description: invoiceForm.description, quantity: Number(invoiceForm.quantity), rate: Number(invoiceForm.unit_price) }],
      discount_type: 'fixed', discount_value: 0,
      tax_components: Number(invoiceForm.tax_rate) > 0 ? [{ name: 'Tax', rate: Number(invoiceForm.tax_rate), inclusive: false }] : [],
      terms: invoiceForm.terms || null,
    } }), 'Invoice created as a draft.');
  };

  const recordPayment = event => {
    event.preventDefault();
    const invoice = invoiceOptions.find(option => option.id === paymentForm.invoice_id);
    return mutate(() => request('/payments', { method: 'POST', body: {
      ...paymentForm, amount: Number(paymentForm.amount), currency: invoice?.currency || currency,
    } }), 'Payment recorded and invoice balance reconciled.');
  };

  const saveSettings = event => {
    event.preventDefault();
    const address = typeof settingsForm.billing_address === 'string'
      ? { line1: settingsForm.billing_address }
      : settingsForm.billing_address;
    return mutate(() => request('/financial-settings', { method: 'PUT', body: {
      legal_name: settingsForm.legal_name || null,
      billing_email: settingsForm.billing_email || null,
      billing_phone: settingsForm.billing_phone || null,
      billing_address: address || {},
      tax_registration_id: settingsForm.tax_registration_id || null,
      base_currency: settingsForm.base_currency,
      quote_prefix: settingsForm.quote_prefix,
      invoice_prefix: settingsForm.invoice_prefix,
      credit_note_prefix: settingsForm.credit_note_prefix,
      default_quote_terms: settingsForm.default_quote_terms || null,
      default_invoice_terms: settingsForm.default_invoice_terms || null,
    } }), 'Financial settings updated.');
  };

  const openDetail = async record => {
    if (resource === 'payments') return;
    setBusy(true);
    try { setSelected(await request(`/${resource}?id=${record.id}`)); }
    catch (detailError) { onNotify?.(detailError.message || 'Record details could not be loaded.', 'error'); }
    finally { setBusy(false); }
  };

  const quoteAction = (action, values = {}) => mutate(async () => {
    const body = { quote_id: selected.id, action, ...values };
    if (action === 'reject') body.reason = window.prompt('Reason for rejection:') || '';
    const result = await request('/quotes/actions', { method: 'POST', body });
    setSelected(result);
    return result;
  }, `Quote action “${action}” completed.`);

  const invoiceAction = action => mutate(async () => {
    const body = { invoice_id: selected.id, action };
    if (action === 'void') body.reason = window.prompt('Reason for voiding this invoice:') || '';
    if (action === 'credit_note') {
      body.reason = window.prompt('Reason for this credit note:') || '';
      body.amount = Number(window.prompt('Credit amount:', selected.balance_due) || 0);
    }
    const result = await request('/invoices/actions', { method: 'POST', body });
    setSelected(result.invoice || result);
    return result;
  }, `Invoice action “${action}” completed.`);

  const downloadPdf = async () => {
    const kind = page === 'quotes' ? 'quote' : 'invoice';
    const pdf = await createFinancialPdf(selected, settings, kind);
    pdf.save(`${kind}-${kind === 'quote' ? selected.quote_number : selected.invoice_number}.pdf`);
  };

  const sendInvoice = () => mutate(async () => {
    const pdf = await createFinancialPdf(selected, settings, 'invoice');
    const result = await request('/send-invoice-email', { method: 'POST', body: { invoiceId: selected.id, pdfBase64: pdfBase64(pdf) } });
    setSelected(await request(`/invoices?id=${selected.id}`));
    return result;
  }, 'Invoice queued with the email provider and delivery history recorded.');

  if (loading && !settings) return <LoadingState label="Loading financial workspace…" />;
  if (error) return <ErrorState title="Financial workspace unavailable" message={error} onRetry={load} />;

  if (page === 'financial-settings') {
    return <SettingsPanel value={settingsForm} onChange={setSettingsForm} onSubmit={saveSettings} busy={busy} canEdit={['owner', 'admin'].includes(settings?.role)} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Quote to cash</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">{page === 'quotes' ? 'Quotes' : page === 'payments' ? 'Payments' : 'Invoices'}</h1>
          <p className="mt-2 text-sm text-gray-600">Versioned commercial documents, derived balances, and traceable financial events.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="crm-btn crm-btn-secondary"><RefreshCw className="h-4 w-4" /> Refresh</button>
          <button type="button" onClick={() => setShowForm(value => !value)} className="crm-btn crm-btn-primary"><Plus className="h-4 w-4" /> {page === 'payments' ? 'Record payment' : `New ${page === 'quotes' ? 'quote' : 'invoice'}`}</button>
        </div>
      </header>

      <RevenueNav page={page} onNavigate={onNavigate} />
      {showForm && page === 'quotes' && <DocumentForm type="quote" form={quoteForm} setForm={setQuoteForm} deals={deals} customers={customers} currency={currency} onSubmit={createQuote} busy={busy} />}
      {showForm && page === 'invoices' && <DocumentForm type="invoice" form={invoiceForm} setForm={setInvoiceForm} deals={deals} customers={customers} currency={currency} onSubmit={createInvoice} busy={busy} />}
      {showForm && page === 'payments' && <PaymentForm form={paymentForm} setForm={setPaymentForm} invoices={invoiceOptions} onSubmit={recordPayment} busy={busy} />}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {records.length === 0 ? <ResourceEmptyState icon={page === 'payments' ? WalletCards : FileText} title={`No ${page} yet`} description="Create the first financial record to begin this workflow." /> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr>
                <th className="px-5 py-3">Reference</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Date</th><th className="px-5 py-3 text-right">Amount</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">{records.map(record => (
                <tr key={record.id} className={resource !== 'payments' ? 'cursor-pointer hover:bg-indigo-50/40' : ''} onClick={() => openDetail(record)}>
                  <td className="px-5 py-4 font-semibold text-gray-900">{record.quote_number || record.invoice_number || record.transaction_reference || record.id.slice(0, 8)}<span className="block text-xs font-normal text-gray-500">{record.deal_name || record.customer_name || record.payment_method || '—'}</span></td>
                  <td className="px-5 py-4"><Status value={record.status} /></td>
                  <td className="px-5 py-4 text-gray-600">{record.issue_date || record.invoice_date || record.payment_date}</td>
                  <td className="px-5 py-4 text-right font-semibold">{formatMoney(record.total_amount ?? record.amount, record.currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {selected && <DetailPanel document={selected} type={page === 'quotes' ? 'quote' : 'invoice'} formatMoney={formatMoney} busy={busy} onClose={() => setSelected(null)} onDownload={downloadPdf} onSend={sendInvoice} onQuoteAction={quoteAction} onInvoiceAction={invoiceAction} customers={customers} />}
    </div>
  );
}

function RevenueNav({ page, onNavigate }) {
  return <nav className="flex flex-wrap gap-2" aria-label="Revenue sections">{[
    ['quotes', FileCheck2, 'Quotes'], ['invoices', Receipt, 'Invoices'], ['payments', WalletCards, 'Payments'], ['financial-settings', Settings2, 'Settings'],
  ].map(([id, Icon, label]) => <button key={id} type="button" onClick={() => onNavigate(id)} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${page === id ? 'bg-indigo-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}><Icon className="h-4 w-4" />{label}</button>)}</nav>;
}

function DocumentForm({ type, form, setForm, deals, customers, currency, onSubmit, busy }) {
  const set = (field, value) => setForm(previous => ({ ...previous, [field]: value }));
  return <form onSubmit={onSubmit} className="grid gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5 md:grid-cols-3">
    {type === 'quote' ? <Field label="Deal"><select required value={form.deal_id} onChange={event => set('deal_id', event.target.value)}><option value="">Select deal</option>{deals.map(deal => <option key={deal.id} value={deal.id}>{deal.name}</option>)}</select></Field> : <Field label="Customer"><select required value={form.customer_id} onChange={event => set('customer_id', event.target.value)}><option value="">Select customer</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field>}
    {type === 'invoice' && <Field label="Deal (optional)"><select value={form.deal_id} onChange={event => set('deal_id', event.target.value)}><option value="">No linked deal</option>{deals.map(deal => <option key={deal.id} value={deal.id}>{deal.name}</option>)}</select></Field>}
    <Field label={type === 'quote' ? 'Issue date' : 'Invoice date'}><input required type="date" value={form[type === 'quote' ? 'issue_date' : 'invoice_date']} onChange={event => set(type === 'quote' ? 'issue_date' : 'invoice_date', event.target.value)} /></Field>
    <Field label={type === 'quote' ? 'Expiry date' : 'Due date'}><input required type="date" value={form[type === 'quote' ? 'expiry_date' : 'due_date']} onChange={event => set(type === 'quote' ? 'expiry_date' : 'due_date', event.target.value)} /></Field>
    <Field label="Description"><input required value={form.description} onChange={event => set('description', event.target.value)} /></Field>
    <Field label="Quantity"><input required min="0.01" step="0.01" type="number" value={form.quantity} onChange={event => set('quantity', event.target.value)} /></Field>
    <Field label={`Unit price (${currency})`}><input required min="0" step="0.01" type="number" value={form.unit_price} onChange={event => set('unit_price', event.target.value)} /></Field>
    <Field label="Tax rate (%)"><input min="0" max="100" step="0.01" type="number" value={form.tax_rate} onChange={event => set('tax_rate', event.target.value)} /></Field>
    <Field label="Currency"><input maxLength="3" value={form.currency || currency} onChange={event => set('currency', event.target.value.toUpperCase())} /></Field>
    <Field label="Terms"><input value={form.terms} onChange={event => set('terms', event.target.value)} /></Field>
    <div className="flex items-end"><button disabled={busy} className="crm-btn crm-btn-primary w-full">Create draft</button></div>
  </form>;
}

function PaymentForm({ form, setForm, invoices, onSubmit, busy }) {
  const set = (field, value) => setForm(previous => ({ ...previous, [field]: value }));
  return <form onSubmit={onSubmit} className="grid gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5 md:grid-cols-3">
    <Field label="Invoice"><select required value={form.invoice_id} onChange={event => set('invoice_id', event.target.value)}><option value="">Select invoice</option>{invoices.filter(invoice => Number(invoice.balance_due) > 0 && !['void', 'cancelled'].includes(invoice.status)).map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {invoice.balance_due} {invoice.currency}</option>)}</select></Field>
    <Field label="Amount"><input required type="number" min="0.01" step="0.01" value={form.amount} onChange={event => set('amount', event.target.value)} /></Field>
    <Field label="Payment date"><input required type="date" value={form.payment_date} onChange={event => set('payment_date', event.target.value)} /></Field>
    <Field label="Method"><input value={form.payment_method} onChange={event => set('payment_method', event.target.value)} /></Field>
    <Field label="Transaction reference"><input value={form.transaction_reference} onChange={event => set('transaction_reference', event.target.value)} /></Field>
    <div className="flex items-end"><button disabled={busy} className="crm-btn crm-btn-primary w-full">Record payment</button></div>
  </form>;
}

function DetailPanel({ document, type, formatMoney, busy, onClose, onDownload, onSend, onQuoteAction, onInvoiceAction, customers }) {
  const isQuote = type === 'quote';
  const [conversion, setConversion] = useState({ customer_id: '', due_date: inThirtyDays() });
  return <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{type} detail</p><h2 className="mt-1 text-2xl font-bold">{document.quote_number || document.invoice_number}</h2><Status value={document.status} /></div><button type="button" onClick={onClose} className="crm-btn crm-btn-secondary">Close</button></div>
    <div className="mt-6 grid gap-3 sm:grid-cols-4"><Metric label="Subtotal" value={formatMoney(document.subtotal, document.currency)} /><Metric label="Tax" value={formatMoney(document.tax_amount, document.currency)} /><Metric label="Total" value={formatMoney(document.total_amount, document.currency)} /><Metric label={isQuote ? 'Version' : 'Balance due'} value={isQuote ? `v${document.version}` : formatMoney(document.balance_due, document.currency)} /></div>
    <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={onDownload} className="crm-btn crm-btn-secondary"><Download className="h-4 w-4" /> PDF</button>
      {isQuote && document.status === 'draft' && <button disabled={busy} type="button" onClick={() => onQuoteAction('send')} className="crm-btn crm-btn-primary">Mark sent</button>}
      {isQuote && ['sent', 'viewed'].includes(document.status) && <><button disabled={busy} type="button" onClick={() => onQuoteAction('accept')} className="crm-btn crm-btn-primary">Accept</button><button disabled={busy} type="button" onClick={() => onQuoteAction('reject')} className="crm-btn crm-btn-secondary">Reject</button></>}
      {isQuote && document.status === 'accepted' && <div className="flex flex-wrap items-end gap-2 rounded-xl border border-indigo-100 bg-indigo-50 p-3"><Field label="Invoice customer"><select value={conversion.customer_id} onChange={event => setConversion(previous => ({ ...previous, customer_id: event.target.value }))}><option value="">Select customer</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field><Field label="Due date"><input type="date" value={conversion.due_date} onChange={event => setConversion(previous => ({ ...previous, due_date: event.target.value }))} /></Field><button disabled={busy || !conversion.customer_id || !conversion.due_date} type="button" onClick={() => onQuoteAction('convert_to_invoice', conversion)} className="crm-btn crm-btn-primary">Convert to invoice</button></div>}
      {isQuote && document.status !== 'draft' && <button disabled={busy} type="button" onClick={() => onQuoteAction('revise')} className="crm-btn crm-btn-secondary">Create revision</button>}
      {!isQuote && !['cancelled', 'void'].includes(document.status) && <button disabled={busy} type="button" onClick={onSend} className="crm-btn crm-btn-primary"><Send className="h-4 w-4" /> Send</button>}
      {!isQuote && document.status === 'draft' && <button disabled={busy} type="button" onClick={() => onInvoiceAction('cancel')} className="crm-btn crm-btn-secondary">Cancel</button>}
      {!isQuote && ['sent', 'overdue'].includes(document.status) && Number(document.amount_paid) === 0 && <button disabled={busy} type="button" onClick={() => onInvoiceAction('void')} className="crm-btn crm-btn-secondary">Void</button>}
      {!isQuote && ['paid', 'partial', 'sent', 'overdue'].includes(document.status) && <button disabled={busy} type="button" onClick={() => onInvoiceAction('credit_note')} className="crm-btn crm-btn-secondary">Credit note</button>}
    </div>
    {!isQuote && <div className="mt-6 grid gap-5 lg:grid-cols-2"><History title="Payments" rows={document.payments} empty="No payments recorded." render={row => `${row.payment_date} · ${formatMoney(row.amount, row.currency)} · ${row.status}`} /><History title="Delivery history" rows={document.deliveries} empty="No delivery attempts." render={row => `${row.recipient} · ${row.status}${row.failure_reason ? ` · ${row.failure_reason}` : ''}`} /></div>}
  </section>;
}

function SettingsPanel({ value, onChange, onSubmit, busy, canEdit }) {
  const set = (field, next) => onChange(previous => ({ ...previous, [field]: next }));
  return <div className="space-y-6"><header><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Quote to cash</p><h1 className="mt-2 text-3xl font-bold">Financial settings</h1><p className="mt-2 text-sm text-gray-600">These values drive document numbering, currency, PDF identity, and email content.</p></header><form onSubmit={onSubmit} className="grid gap-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:grid-cols-2">
    {[['legal_name','Legal company name'],['billing_email','Billing email'],['billing_phone','Billing phone'],['tax_registration_id','Tax registration ID'],['base_currency','Base currency'],['quote_prefix','Quote prefix'],['invoice_prefix','Invoice prefix'],['credit_note_prefix','Credit note prefix']].map(([field,label]) => <Field key={field} label={label}><input disabled={!canEdit} value={value[field] || ''} onChange={event => set(field, field === 'base_currency' ? event.target.value.toUpperCase() : event.target.value)} /></Field>)}
    <Field label="Billing address"><input disabled={!canEdit} value={typeof value.billing_address === 'string' ? value.billing_address : value.billing_address?.line1 || ''} onChange={event => set('billing_address', event.target.value)} /></Field>
    <Field label="Default quote terms"><textarea disabled={!canEdit} value={value.default_quote_terms || ''} onChange={event => set('default_quote_terms', event.target.value)} /></Field>
    <Field label="Default invoice terms"><textarea disabled={!canEdit} value={value.default_invoice_terms || ''} onChange={event => set('default_invoice_terms', event.target.value)} /></Field>
    <div className="md:col-span-2"><button disabled={busy || !canEdit} className="crm-btn crm-btn-primary">Save financial settings</button>{!canEdit && <p className="mt-2 text-sm text-amber-700">Only workspace owners and admins can change these settings.</p>}</div>
  </form></div>;
}

function Field({ label, children }) { return <label className="block text-sm font-semibold text-gray-700">{label}{React.cloneElement(children, { className: `${children.props.className || ''} mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-normal text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200` })}</label>; }
function Status({ value }) { return <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold capitalize text-gray-700">{String(value || 'unknown').replace('_', ' ')}</span>; }
function Metric({ label, value }) { return <div className="rounded-xl bg-gray-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 text-lg font-bold text-gray-950">{value}</p></div>; }
function History({ title, rows = [], empty, render }) { return <div><h3 className="font-bold text-gray-900">{title}</h3><div className="mt-2 space-y-2">{rows.length ? rows.map(row => <p key={row.id} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{render(row)}</p>) : <p className="text-sm text-gray-500">{empty}</p>}</div></div>; }
