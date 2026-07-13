import { getDb } from './db.js';
import { verifyUser } from './auth.js';

export default async function handler(req, res) {
  const userId = await verifyUser(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const sql = getDb();
  
  try {
    if (req.method === 'GET') {
      const limit = req.query.limit ? parseInt(req.query.limit) : 50;
      const activities = await sql`SELECT * FROM activities WHERE user_id = ${userId} ORDER BY timestamp DESC LIMIT ${limit}`;
      return res.status(200).json(activities);
    }
    
    if (req.method === 'POST') {
      const { lead_id, type, message } = req.body;
      const result = await sql`
        INSERT INTO activities (user_id, lead_id, type, message)
        VALUES (${userId}, ${lead_id || null}, ${type}, ${message})
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
