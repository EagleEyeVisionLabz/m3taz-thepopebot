'use server';

import { auth } from './index.js';
import {
  createFirstUser,
  createUser,
  getAllUsers,
  deleteUser,
  getUserByEmail,
  updateUserEmail,
  updateUserRole,
  updateUserPasswordById,
  updateUserProfile,
  verifyPassword,
} from '../db/users.js';

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  return session.user;
}

async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== 'admin') throw new Error('Forbidden');
  return user;
}

/**
 * Create the first admin user (setup action).
 * Uses atomic createFirstUser() to prevent race conditions.
 * No session/token is created — the admin must log in through the normal auth flow.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ success?: boolean, error?: string }>}
 */
export async function setupAdmin(email, password) {
  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const created = createFirstUser(email, password);
  if (!created) {
    return { error: 'Setup already completed.' };
  }

  return { success: true };
}

/**
 * Get all users.
 */
export async function getUsers() {
  await requireAdmin();
  return getAllUsers();
}

/**
 * Add a new user.
 */
export async function addUser(email, password, role) {
  await requireAdmin();

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Invalid email format.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  try {
    await createUser(email, password);
    if (role && role !== 'admin') {
      // createUser defaults to admin; update if different role requested
      const users = getAllUsers();
      const created = users.find((u) => u.email === email.toLowerCase());
      if (created) updateUserRole(created.id, role);
    }
    return { success: true };
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return { error: 'A user with this email already exists.' };
    }
    return { error: 'Failed to create user.' };
  }
}

/**
 * Edit a user's email and/or role.
 */
export async function editUser(id, { email, role }) {
  const user = await requireAdmin();

  if (role !== undefined && id === user.id) {
    return { error: 'Cannot change your own role.' };
  }

  try {
    if (email !== undefined) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: 'Invalid email format.' };
      }
      updateUserEmail(id, email);
    }
    if (role !== undefined) {
      updateUserRole(id, role);
    }
    return { success: true };
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return { error: 'A user with this email already exists.' };
    }
    return { error: 'Failed to update user.' };
  }
}

/**
 * Remove a user.
 */
export async function removeUser(id) {
  const user = await requireAdmin();

  if (id === user.id) {
    return { error: 'Cannot delete yourself.' };
  }

  const deleted = deleteUser(id);
  if (!deleted) {
    return { error: 'User not found.' };
  }
  return { success: true };
}

/**
 * Reset a user's password.
 */
export async function resetPassword(id, newPassword) {
  await requireAdmin();

  if (!newPassword || newPassword.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const updated = updateUserPasswordById(id, newPassword);
  if (!updated) {
    return { error: 'User not found.' };
  }
  return { success: true };
}

/**
 * Update the current user's own profile info (first/last name, nickname).
 * No password verification required — these are low-risk identity fields.
 */
export async function updateProfileInfo({ firstName, lastName, nickname }) {
  const sessionUser = await requireAuth();
  updateUserProfile(sessionUser.id, { firstName, lastName, nickname });
  return { success: true };
}

/**
 * Update the current user's email and/or password.
 * Requires current password for verification (account-takeover sensitive).
 */
export async function updateProfile({ email, currentPassword, newPassword }) {
  const sessionUser = await requireAuth();

  if (!currentPassword) {
    return { error: 'Current password is required.' };
  }

  const user = getUserByEmail(sessionUser.email);
  if (!user) {
    return { error: 'User not found.' };
  }

  const valid = await verifyPassword(user, currentPassword);
  if (!valid) {
    return { error: 'Current password is incorrect.' };
  }

  try {
    if (email !== undefined && email !== sessionUser.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: 'Invalid email format.' };
      }
      updateUserEmail(user.id, email);
    }

    if (newPassword) {
      if (newPassword.length < 8) {
        return { error: 'New password must be at least 8 characters.' };
      }
      updateUserPasswordById(user.id, newPassword);
    }

    return { success: true };
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return { error: 'A user with this email already exists.' };
    }
    return { error: 'Failed to update profile.' };
  }
}
