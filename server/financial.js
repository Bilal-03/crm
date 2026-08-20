import { HttpError } from './http.js';

const MAX_MONEY_CENTS = 10_000_000_000_000;

export function toMoneyCents(value, field = 'amount') {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new HttpError(400, 'validation_error', 'Request validation failed.', [
      { field, message: 'must be a non-negative number' },
    ]);
  }
  const cents = Math.round(number * 100);
  if (cents > MAX_MONEY_CENTS) {
    throw new HttpError(400, 'validation_error', 'Request validation failed.', [
      { field, message: 'is larger than the supported financial limit' },
    ]);
  }
  return cents;
}

export function fromMoneyCents(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

export function calculateDocumentTotals({
  items,
  discountType = 'fixed',
  discountValue = 0,
  taxComponents = [],
}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'validation_error', 'Request validation failed.', [
      { field: 'items', message: 'must contain at least one item' },
    ]);
  }

  const normalizedItems = items.map((item, index) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price ?? item.rate ?? item.price);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw financialValidation(`items[${index}].quantity`, 'must be greater than zero');
    }
    const unitPriceCents = toMoneyCents(unitPrice, `items[${index}].unit_price`);
    const lineTotalCents = Math.round(quantity * unitPriceCents);
    return {
      description: String(item.description || '').trim(),
      quantity,
      unit_price: fromMoneyCents(unitPriceCents),
      amount: fromMoneyCents(lineTotalCents),
      _amountCents: lineTotalCents,
    };
  });
  if (normalizedItems.some(item => !item.description)) {
    throw financialValidation('items.description', 'is required');
  }

  const subtotalCents = normalizedItems.reduce((sum, item) => sum + item._amountCents, 0);
  const normalizedDiscountType = discountType === 'percent' ? 'percent' : 'fixed';
  const rawDiscount = Number(discountValue || 0);
  if (!Number.isFinite(rawDiscount) || rawDiscount < 0 || (normalizedDiscountType === 'percent' && rawDiscount > 100)) {
    throw financialValidation('discount_value', normalizedDiscountType === 'percent'
      ? 'must be between 0 and 100'
      : 'must be a non-negative number');
  }
  const discountCents = Math.min(
    normalizedDiscountType === 'percent'
      ? Math.round(subtotalCents * rawDiscount / 100)
      : toMoneyCents(rawDiscount, 'discount_value'),
    subtotalCents,
  );
  const discountedCents = subtotalCents - discountCents;

  const normalizedTaxes = taxComponents.map((component, index) => {
    const rate = Number(component.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw financialValidation(`tax_components[${index}].rate`, 'must be between 0 and 100');
    }
    const name = String(component.name || '').trim();
    if (!name) throw financialValidation(`tax_components[${index}].name`, 'is required');
    return { name, rate, inclusive: component.inclusive === true };
  });
  const inclusiveRate = normalizedTaxes
    .filter(component => component.inclusive)
    .reduce((sum, component) => sum + component.rate, 0);
  const netTaxableCents = inclusiveRate > 0
    ? Math.round(discountedCents * 100 / (100 + inclusiveRate))
    : discountedCents;
  const taxes = normalizedTaxes.map(component => ({
    ...component,
    amount: fromMoneyCents(Math.round(netTaxableCents * component.rate / 100)),
  }));
  const inclusiveTaxCents = taxes
    .filter(component => component.inclusive)
    .reduce((sum, component) => sum + toMoneyCents(component.amount), 0);
  const exclusiveTaxCents = taxes
    .filter(component => !component.inclusive)
    .reduce((sum, component) => sum + toMoneyCents(component.amount), 0);
  const totalCents = discountedCents + exclusiveTaxCents;

  return {
    items: normalizedItems.map(({ _amountCents, ...item }) => item),
    subtotal: fromMoneyCents(subtotalCents),
    discount_type: normalizedDiscountType,
    discount_value: rawDiscount,
    discount_amount: fromMoneyCents(discountCents),
    tax_amount: fromMoneyCents(inclusiveTaxCents + exclusiveTaxCents),
    total_amount: fromMoneyCents(totalCents),
    tax_components: taxes,
  };
}

export function deriveInvoiceFinancials({
  totalAmount,
  payments = [],
  creditNotes = [],
  lifecycleStatus = 'draft',
  sentAt = null,
  dueDate = null,
  today = new Date().toISOString().slice(0, 10),
}) {
  const totalCents = toMoneyCents(totalAmount, 'total_amount');
  const paidCents = payments
    .filter(payment => payment.status !== 'void')
    .reduce((sum, payment) => sum + toMoneyCents(payment.amount, 'payment.amount'), 0);
  const creditedCents = creditNotes
    .filter(credit => credit.status !== 'void')
    .reduce((sum, credit) => sum + toMoneyCents(credit.amount, 'credit_note.amount'), 0);
  const appliedPaidCents = Math.min(paidCents, totalCents);
  const appliedCreditCents = Math.min(creditedCents, Math.max(totalCents - appliedPaidCents, 0));
  const balanceCents = Math.max(totalCents - appliedPaidCents - appliedCreditCents, 0);

  let status = 'draft';
  if (lifecycleStatus === 'void') status = 'void';
  else if (lifecycleStatus === 'cancelled') status = 'cancelled';
  else if (balanceCents === 0 && totalCents > 0) status = 'paid';
  else if (appliedPaidCents > 0 || appliedCreditCents > 0) status = 'partial';
  else if (dueDate && dueDate < today && sentAt) status = 'overdue';
  else if (sentAt) status = 'sent';

  return {
    amount_paid: fromMoneyCents(appliedPaidCents),
    credited_amount: fromMoneyCents(appliedCreditCents),
    balance_due: status === 'void' || status === 'cancelled' ? 0 : fromMoneyCents(balanceCents),
    status,
  };
}

export function assertCurrencyMatch(expected, actual, field = 'currency') {
  if (String(expected || '').toUpperCase() !== String(actual || '').toUpperCase()) {
    throw new HttpError(409, 'currency_mismatch', `${field} must match the document currency.`);
  }
}

export function isFinancialDocumentEditable(document, { paymentCount = 0, deliveryCount = 0 } = {}) {
  return document?.status === 'draft'
    && !document?.sent_at
    && Number(paymentCount) === 0
    && Number(deliveryCount) === 0;
}

function financialValidation(field, message) {
  return new HttpError(400, 'validation_error', 'Request validation failed.', [{ field, message }]);
}
