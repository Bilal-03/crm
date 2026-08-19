import { HttpError } from './http.js';

export const LEAD_STAGES = ['new', 'qualified', 'follow-up', 'proposal', 'closed-won', 'closed-lost'];
export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'partial', 'cancelled'];

export function validateLead(body, { partial = false } = {}) {
  const input = object(body);
  const result = {};

  assign(result, 'name', string(input, 'name', { required: !partial, min: 1, max: 160, trim: true }));
  assign(result, 'company', nullableString(input, 'company', 160));
  assign(result, 'email', email(input, 'email', { required: !partial }));
  assign(result, 'phone', nullableString(input, 'phone', 40));
  assign(result, 'source', nullableString(input, 'source', 80));
  assign(result, 'stage', enumeration(input, 'stage', LEAD_STAGES, { defaultValue: partial ? undefined : 'new' }));
  assign(result, 'notes', notes(input.notes));
  assign(result, 'reminders', reminders(input.reminders));
  assign(result, 'quote_items', quoteItems(input.quote_items));

  requireFieldsForUpdate(result, partial);
  return result;
}

export function validateMeeting(body, { partial = false } = {}) {
  const input = object(body);
  const result = {};

  assign(result, 'lead_id', uuid(input, 'lead_id', { required: !partial, nullable: true }));
  assign(result, 'title', string(input, 'title', { required: !partial, min: 1, max: 200, trim: true }));
  assign(result, 'date_time', dateTime(input, 'date_time', { required: !partial }));
  assign(result, 'notes', nullableString(input, 'notes', 10_000));

  requireFieldsForUpdate(result, partial);
  return result;
}

export function validateActivity(body) {
  const input = object(body);
  return {
    lead_id: uuid(input, 'lead_id', { nullable: true }) ?? null,
    type: string(input, 'type', { required: true, min: 1, max: 80, trim: true }),
    message: string(input, 'message', { required: true, min: 1, max: 2_000, trim: true }),
  };
}

export function validateCustomer(body) {
  const input = object(body);
  return {
    name: string(input, 'name', { required: true, min: 1, max: 160, trim: true }),
    company: nullableString(input, 'company', 160) ?? null,
    email: email(input, 'email', { required: true }),
    phone: nullableString(input, 'phone', 40) ?? null,
  };
}

export function validateInvoice(body, { partial = false, allowAmountPaid = true } = {}) {
  const input = object(body);
  const result = {};

  assign(result, 'customer_id', uuid(input, 'customer_id', { required: !partial }));
  assign(result, 'invoice_number', string(input, 'invoice_number', { min: 1, max: 64, trim: true }));
  assign(result, 'invoice_date', date(input, 'invoice_date', { required: !partial }));
  assign(result, 'due_date', date(input, 'due_date', { required: !partial }));
  assign(result, 'status', enumeration(input, 'status', INVOICE_STATUSES, { defaultValue: partial ? undefined : 'draft' }));
  assign(result, 'items', invoiceItems(input.items, { required: !partial }));
  assign(result, 'tax_rate', number(input, 'tax_rate', { min: 0, max: 100, defaultValue: partial ? undefined : 0 }));
  assign(result, 'discount_amount', number(input, 'discount_amount', { min: 0, max: 1_000_000_000, defaultValue: partial ? undefined : 0 }));
  if (allowAmountPaid) {
    assign(result, 'amount_paid', number(input, 'amount_paid', { min: 0, max: 1_000_000_000, defaultValue: partial ? undefined : 0 }));
  } else if (Object.prototype.hasOwnProperty.call(input, 'amount_paid')) {
    invalid('amount_paid', 'cannot be changed while editing an invoice; record a payment instead');
  }
  assign(result, 'notes', nullableString(input, 'notes', 10_000));
  assign(result, 'terms', nullableString(input, 'terms', 10_000));

  requireFieldsForUpdate(result, partial);
  return result;
}

export function validateBulkLeadOperation(body) {
  const input = object(body);
  const action = enumeration(input, 'action', ['update', 'delete'], { defaultValue: 'update' });
  if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 100) {
    invalid('ids', 'must contain between 1 and 100 lead IDs');
  }
  const ids = [...new Set(input.ids)];
  if (ids.length !== input.ids.length) invalid('ids', 'must not contain duplicate IDs');
  ids.forEach((id, index) => {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      invalid(`ids[${index}]`, 'must be a valid UUID');
    }
  });
  const updateInput = action === 'update' ? object(input.updates || {}) : {};
  const stage = action === 'update'
    ? enumeration(updateInput, 'stage', LEAD_STAGES)
    : undefined;
  if (action === 'update' && stage === undefined) invalid('updates.stage', 'is required');
  return { action, ids, stage };
}

export function calculateInvoiceTotals(items, taxRate = 0, discountAmount = 0, amountPaid = 0) {
  const subtotalCents = items.reduce((sum, item) => {
    return sum + Math.round(item.quantity * item.rate * 100);
  }, 0);
  const taxCents = Math.round(subtotalCents * taxRate / 100);
  const discountCents = Math.round(discountAmount * 100);
  const totalCents = Math.max(0, subtotalCents + taxCents - discountCents);
  const paidCents = Math.min(Math.round(amountPaid * 100), totalCents);

  return {
    subtotal: subtotalCents / 100,
    tax_amount: taxCents / 100,
    total_amount: totalCents / 100,
    amount_paid: paidCents / 100,
    balance_due: (totalCents - paidCents) / 100,
  };
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('body', 'must be a JSON object');
  }
  return value;
}

function string(input, field, { required = false, min = 0, max, trim = false } = {}) {
  if (!(field in input) || input[field] === undefined) {
    if (required) invalid(field, 'is required');
    return undefined;
  }
  if (typeof input[field] !== 'string') invalid(field, 'must be a string');
  const value = trim ? input[field].trim() : input[field];
  if (value.length < min) invalid(field, `must contain at least ${min} character(s)`);
  if (max && value.length > max) invalid(field, `must contain at most ${max} characters`);
  return value;
}

function nullableString(input, field, max) {
  if (!(field in input) || input[field] === undefined) return undefined;
  if (input[field] === null || input[field] === '') return null;
  return string(input, field, { max, trim: true });
}

function email(input, field, { required = false } = {}) {
  const value = string(input, field, { required, min: required ? 3 : 0, max: 320, trim: true });
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) invalid(field, 'must be a valid email address');
  return normalized;
}

function uuid(input, field, { required = false, nullable = false } = {}) {
  if (!(field in input) || input[field] === undefined) {
    if (required) invalid(field, 'is required');
    return undefined;
  }
  if (nullable && (input[field] === null || input[field] === '')) return null;
  const value = input[field];
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    invalid(field, 'must be a valid UUID');
  }
  return value;
}

function enumeration(input, field, allowed, { defaultValue } = {}) {
  if (!(field in input) || input[field] === undefined) return defaultValue;
  if (!allowed.includes(input[field])) invalid(field, `must be one of: ${allowed.join(', ')}`);
  return input[field];
}

function date(input, field, { required = false } = {}) {
  const value = string(input, field, { required });
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    invalid(field, 'must be a valid date in YYYY-MM-DD format');
  }
  return value;
}

function dateTime(input, field, { required = false } = {}) {
  const value = string(input, field, { required, max: 64 });
  if (value === undefined) return undefined;
  if (Number.isNaN(Date.parse(value))) invalid(field, 'must be a valid ISO-8601 date-time');
  return new Date(value).toISOString();
}

function number(input, field, { min, max, defaultValue } = {}) {
  if (!(field in input) || input[field] === undefined) return defaultValue;
  const value = Number(input[field]);
  if (!Number.isFinite(value)) invalid(field, 'must be a finite number');
  if (min !== undefined && value < min) invalid(field, `must be at least ${min}`);
  if (max !== undefined && value > max) invalid(field, `must be at most ${max}`);
  return value;
}

function notes(value) {
  if (value === undefined) return undefined;
  const entries = boundedArray(value, 'notes', 100);
  return entries.map(entry => {
    const input = object(entry);
    return {
      id: uuid(input, 'id', { required: true }),
      text: string(input, 'text', { required: true, min: 1, max: 4_000, trim: true }),
      timestamp: dateTime(input, 'timestamp', { required: true }),
    };
  });
}

function reminders(value) {
  if (value === undefined) return undefined;
  return boundedArray(value, 'reminders', 100).map(entry => {
    const input = object(entry);
    return {
      id: uuid(input, 'id', { required: true }),
      date: date(input, 'date', { required: true }),
      note: string(input, 'note', { required: true, min: 1, max: 1_000, trim: true }),
      createdAt: dateTime(input, 'createdAt', { required: true }),
      completed: input.completed === true,
    };
  });
}

function quoteItems(value) {
  if (value === undefined) return undefined;
  return boundedArray(value, 'quote_items', 100).map(entry => {
    const input = object(entry);
    const quantity = number(input, 'quantity', { min: 0, max: 1_000_000 });
    const price = number(input, 'price', { min: 0, max: 1_000_000_000 });
    if (quantity === undefined) invalid('quote_items.quantity', 'is required');
    if (price === undefined) invalid('quote_items.price', 'is required');
    return {
      description: string(input, 'description', { required: true, min: 1, max: 500, trim: true }),
      quantity,
      price,
    };
  });
}

function invoiceItems(value, { required = false } = {}) {
  if (value === undefined) {
    if (required) invalid('items', 'is required');
    return undefined;
  }
  const items = boundedArray(value, 'items', 100);
  if (items.length === 0) invalid('items', 'must contain at least one item');
  return items.map(entry => {
    const input = object(entry);
    const quantity = number(input, 'quantity', { min: 0.0001, max: 1_000_000 });
    const rate = number(input, 'rate', { min: 0, max: 1_000_000_000 });
    if (quantity === undefined) invalid('items.quantity', 'is required');
    if (rate === undefined) invalid('items.rate', 'is required');
    return {
      description: string(input, 'description', { required: true, min: 1, max: 500, trim: true }),
      quantity,
      rate,
      amount: Math.round(quantity * rate * 100) / 100,
    };
  });
}

function boundedArray(value, field, max) {
  if (!Array.isArray(value)) invalid(field, 'must be an array');
  if (value.length > max) invalid(field, `must contain at most ${max} items`);
  return value;
}

function assign(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function requireFieldsForUpdate(result, partial) {
  if (partial && Object.keys(result).length === 0) invalid('body', 'must include at least one supported field');
}

function invalid(field, message) {
  throw new HttpError(400, 'validation_error', 'Request validation failed.', [{ field, message }]);
}
