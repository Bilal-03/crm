import { BRAND_RGB, PRODUCT_BRAND } from '../../../brand.js';

export async function createFinancialPdf(document, settings, kind = 'invoice') {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const pdf = new jsPDF();
  const title = kind === 'quote' ? 'QUOTE' : 'INVOICE';
  const number = kind === 'quote' ? document.quote_number : document.invoice_number;
  const items = document.items || [];
  const currency = document.currency || settings?.base_currency || 'USD';
  const money = value => {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency }).format(Number(value || 0));
    } catch {
      return `${currency} ${Number(value || 0).toFixed(2)}`;
    }
  };

  pdf.setFontSize(20);
  pdf.setTextColor(...BRAND_RGB.primary);
  pdf.text(settings?.legal_name || settings?.name || PRODUCT_BRAND.name, 14, 18);
  pdf.setFontSize(9);
  pdf.setTextColor(...BRAND_RGB.muted);
  pdf.text(PRODUCT_BRAND.tagline, 14, 24);
  pdf.setFontSize(11);
  pdf.setTextColor(...BRAND_RGB.text);
  const address = settings?.billing_address || {};
  const addressText = [address.line1, address.line2, address.city, address.region, address.postal_code, address.country].filter(Boolean).join(', ');
  if (addressText) pdf.text(addressText, 14, 31, { maxWidth: 110 });
  if (settings?.tax_registration_id) pdf.text(`Tax ID: ${settings.tax_registration_id}`, 14, 38);
  pdf.setFontSize(18);
  pdf.text(title, 196, 18, { align: 'right' });
  pdf.setFontSize(10);
  pdf.text(String(number || ''), 196, 25, { align: 'right' });
  const issueDate = kind === 'quote' ? document.issue_date : document.invoice_date;
  const endDate = kind === 'quote' ? document.expiry_date : document.due_date;
  pdf.text(`Issue: ${issueDate || '—'}`, 196, 32, { align: 'right' });
  pdf.text(`${kind === 'quote' ? 'Expires' : 'Due'}: ${endDate || '—'}`, 196, 38, { align: 'right' });

  const recipient = document.customer_name || document.account_name || document.contact_name || 'Customer';
  pdf.setFontSize(10);
  pdf.text(`Bill to: ${recipient}`, 14, 48);
  autoTable(pdf, {
    startY: 56,
    head: [['Description', 'Quantity', 'Unit price', 'Amount']],
    body: items.map(item => [
      item.description,
      String(item.quantity),
      money(item.unit_price ?? item.rate),
      money(item.amount ?? Number(item.quantity) * Number(item.unit_price ?? item.rate)),
    ]),
    foot: [
      ['Subtotal', '', '', money(document.subtotal)],
      ['Discount', '', '', `-${money(document.discount_amount)}`],
      ['Tax', '', '', money(document.tax_amount)],
      ['Total', '', '', money(document.total_amount)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: BRAND_RGB.primary },
  });
  const finalY = pdf.lastAutoTable?.finalY || 120;
  if (document.terms) pdf.text(`Terms: ${document.terms}`, 14, finalY + 12, { maxWidth: 180 });
  if (document.notes) pdf.text(`Notes: ${document.notes}`, 14, finalY + 24, { maxWidth: 180 });
  return pdf;
}

export function pdfBase64(pdf) {
  return pdf.output('datauristring').split(',')[1];
}
