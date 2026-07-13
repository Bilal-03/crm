import { verifyToken } from '@clerk/backend';

export async function verifyUser(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return null;
  }
  
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY is not set');
  }

  try {
    const verified = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return verified.sub; // This is the user ID
  } catch (error) {
    console.error('Token verification failed', error);
    return null;
  }
}
