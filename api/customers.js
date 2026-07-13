import { getDb } from './db.js';
import { verifyUser } from './auth.js';

export default async function handler(req, res) {
  const userId = await verifyUser(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const sql = getDb();
  
  try {
    if (req.method === 'GET') {
      const customers = await sql`SELECT * FROM customers WHERE user_id = ${userId} ORDER BY created_at DESC`;
      return res.status(200).json(customers);
    }
    
    if (req.method === 'POST') {
      const { name, company, email, phone } = req.body;
      const result = await sql`
        INSERT INTO customers (user_id, name, company, email, phone)
        VALUES (${userId}, ${name}, ${company || null}, ${email}, ${phone || null})
        RETURNING *
      `;
      return res.status(201).json(result[0]);
    }
    
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
