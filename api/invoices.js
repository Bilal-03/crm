import { getDb } from './db.js';
import { verifyUser } from './auth.js';

export default async function handler(req, res) {
  const userId = await verifyUser(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const sql = getDb();
  
  try {
    if (req.method === 'GET') {
      const invoices = await sql`SELECT * FROM invoices WHERE user_id = ${userId} ORDER BY created_at DESC`;
      return res.status(200).json(invoices);
    }
    
    if (req.method === 'POST') {
      const { customer_id, invoice_number, issue_date, due_date, status, items, notes, terms, amount, subtotal, tax_rate, tax_amount } = req.body;
      const result = await sql`
        INSERT INTO invoices (user_id, customer_id, invoice_number, issue_date, due_date, status, items, notes, terms, amount, subtotal, tax_rate, tax_amount)
        VALUES (${userId}, ${customer_id}, ${invoice_number}, ${issue_date || null}, ${due_date || null}, ${status || 'draft'}, ${items ? JSON.stringify(items) : '[]'}, ${notes || null}, ${terms || null}, ${amount || 0}, ${subtotal || 0}, ${tax_rate || 0}, ${tax_amount || 0})
        RETURNING *
      `;
      return res.status(201).json(result[0]);
    }

    if (req.method === 'PUT') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      
      const { status, issue_date, due_date, items, notes, terms, amount, subtotal, tax_rate, tax_amount } = req.body;
      const result = await sql`
        UPDATE invoices 
        SET 
          status = COALESCE(${status}, status),
          issue_date = COALESCE(${issue_date}, issue_date),
          due_date = COALESCE(${due_date}, due_date),
          items = COALESCE(${items ? JSON.stringify(items) : null}, items),
          notes = COALESCE(${notes}, notes),
          terms = COALESCE(${terms}, terms),
          amount = COALESCE(${amount}, amount),
          subtotal = COALESCE(${subtotal}, subtotal),
          tax_rate = COALESCE(${tax_rate}, tax_rate),
          tax_amount = COALESCE(${tax_amount}, tax_amount)
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      `;
      return res.status(200).json(result[0]);
    }
    
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      await sql`DELETE FROM invoices WHERE id = ${id} AND user_id = ${userId}`;
      return res.status(204).end();
    }
    
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
