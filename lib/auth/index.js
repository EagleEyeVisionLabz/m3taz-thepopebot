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
 *
 * The JWT role claim can be stale (a user demoted or deleted after sign-in keeps
 * their old token until expiry), so for this privileged gate we re-load the user
 * from the DB and check the LIVE role + existence rather than trusting the token.
 * The DB import is dynamic so this module stays importable before initDatabase()
 * and so no DB/native dependency leaks into edge contexts.
 *
 * @returns {Promise<{id: string, role: 'admin', ...}>}
 */
export async function requireAdmin() {
  const user = await requireAuth();

  const { getUserById } = await import('../db/users.js');
  const dbUser = getUserById(user.id);
  // User no longer exists (deleted) or has been demoted → deny, regardless of
  // what the token claims.
  if (!dbUser || dbUser.role !== 'admin') throw new Error('Forbidden');

  // Return the live role so callers don't act on the stale token claim.
  return { ...user, role: dbUser.role };
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
