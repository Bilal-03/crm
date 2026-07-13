import { getDb } from './db.js';
import { verifyUser } from './auth.js';

export default async function handler(req, res) {
  const userId = await verifyUser(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const sql = getDb();
  
  try {
    if (req.method === 'GET') {
      const meetings = await sql`SELECT * FROM meetings WHERE user_id = ${userId} ORDER BY created_at DESC`;
      return res.status(200).json(meetings);
    }
    
    if (req.method === 'POST') {
      const { lead_id, title, date_time, notes } = req.body;
      const result = await sql`
        INSERT INTO meetings (user_id, lead_id, title, date_time, notes)
        VALUES (${userId}, ${lead_id || null}, ${title}, ${date_time}, ${notes || null})
        RETURNING *
      `;
      return res.status(201).json(result[0]);
    }

    if (req.method === 'PUT') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      
      const { lead_id, title, date_time, notes } = req.body;
      const result = await sql`
        UPDATE meetings 
        SET 
          lead_id = COALESCE(${lead_id}, lead_id),
          title = COALESCE(${title}, title),
          date_time = COALESCE(${date_time}, date_time),
          notes = COALESCE(${notes}, notes)
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      `;
      return res.status(200).json(result[0]);
    }
    
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      await sql`DELETE FROM meetings WHERE id = ${id} AND user_id = ${userId}`;
      return res.status(204).end();
    }
    
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
