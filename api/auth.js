import { createClerkClient } from '@clerk/backend';

export async function verifyUser(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return null;
  }
  
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY is not set');
  }

  const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  
  try {
    const verified = await clerkClient.verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return verified.sub; // This is the user ID
  } catch (error) {
    console.error('Token verification failed', error);
    return null;
  }
}
