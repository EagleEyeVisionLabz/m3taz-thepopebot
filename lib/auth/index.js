import { handlers, auth } from './config.js';

// Re-export Auth.js route handlers (GET + POST for [...nextauth])
export const { GET, POST } = handlers;

// Re-export auth for session checking
export { auth };

/**
 * Require an authenticated session. Throws 'Unauthorized' otherwise.
 * @returns {Promise<{id: string, role: string, email?: string, ...}>}
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  return session.user;
}

/**
 * Require an admin session. Throws 'Forbidden' for non-admins.
 * @returns {Promise<{id: string, role: 'admin', ...}>}
 */
export async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== 'admin') throw new Error('Forbidden');
  return user;
}

/**
 * Get the auth state for the main page (server component).
 * Returns both the session and whether setup is needed, in one call.
 * DB import is dynamic so it doesn't get pulled in at module level.
 *
 * @returns {Promise<{ session: object|null, needsSetup: boolean }>}
 */
export async function getPageAuthState() {
  const { getUserCount } = await import('../db/users.js');
  const [session, userCount] = await Promise.all([
    auth(),
    Promise.resolve(getUserCount()),
  ]);

  return {
    session,
    needsSetup: userCount === 0,
  };
}
