import { getDb } from './db.js';
import { verifyUser } from './auth.js';

export default async function handler(req, res) {
  const userId = await verifyUser(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const sql = getDb();
  
  try {
    if (req.method === 'GET') {
      const leads = await sql`SELECT * FROM leads WHERE user_id = ${userId} ORDER BY created_at DESC`;
      return res.status(200).json(leads);
    }
    
    if (req.method === 'POST') {
      const { name, company, email, phone, source, stage, notes, reminders, quote_items } = req.body;
      const result = await sql`
        INSERT INTO leads (user_id, name, company, email, phone, source, stage, notes, reminders, quote_items)
        VALUES (${userId}, ${name}, ${company || null}, ${email}, ${phone || null}, ${source || null}, ${stage || 'new'}, ${JSON.stringify(notes || [])}, ${JSON.stringify(reminders || [])}, ${JSON.stringify(quote_items || [])})
        RETURNING *
      `;
      return res.status(201).json(result[0]);
    }

    if (req.method === 'PUT') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      
      const { name, company, email, phone, source, stage, notes, reminders, quote_items } = req.body;
      
      // Basic approach: update all provided fields or keep existing if not provided in body (or handle full replace).
      // Since fetch usually sends the full object, we update everything.
      const result = await sql`
        UPDATE leads 
        SET 
          name = COALESCE(${name}, name),
          company = COALESCE(${company}, company),
          email = COALESCE(${email}, email),
          phone = COALESCE(${phone}, phone),
          source = COALESCE(${source}, source),
          stage = COALESCE(${stage}, stage),
          notes = COALESCE(${notes ? JSON.stringify(notes) : null}, notes),
          reminders = COALESCE(${reminders ? JSON.stringify(reminders) : null}, reminders),
          quote_items = COALESCE(${quote_items ? JSON.stringify(quote_items) : null}, quote_items)
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      `;
      return res.status(200).json(result[0]);
    }
    
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      await sql`DELETE FROM leads WHERE id = ${id} AND user_id = ${userId}`;
      return res.status(204).end();
    }
    
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
