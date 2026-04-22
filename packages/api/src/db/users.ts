/** User-related DB operations. */

import { sql, hashApiKey } from './client.js';

export interface DbUser {
  id: string;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
  tier: string;
  org_id: string | null;
  role: string;
  api_key: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  github_username: string | null;
  preferred_provider: string | null;
  created_at: Date;
  last_login_at: Date;
}

export async function dbGetUser(id: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] || null;
}

export async function dbGetUserByApiKey(apiKey: string): Promise<DbUser | null> {
  const keyHash = hashApiKey(apiKey);
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE api_key_hash = ${keyHash}`;
  return rows[0] || null;
}

export async function dbGetUserByStripeCustomer(customerId: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE stripe_customer_id = ${customerId}`;
  return rows[0] || null;
}

export async function dbGetUserByLogin(login: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE login = ${login}`;
  return rows[0] || null;
}

export async function dbGetUserByGithubUsername(username: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE github_username = ${username}`;
  return rows[0] || null;
}

export async function dbUpdateGithubUsername(userId: string, githubUsername: string): Promise<void> {
  await sql`UPDATE users SET github_username = ${githubUsername} WHERE id = ${userId}`;
}

export async function dbUpsertUser(user: {
  id: string; login: string; name: string; email: string;
  avatarUrl: string; apiKey: string;
  githubUsername?: string | null;
}): Promise<DbUser> {
  const keyHash = hashApiKey(user.apiKey);
  const rows = await sql<DbUser[]>`
    INSERT INTO users (id, login, name, email, avatar_url, api_key, api_key_hash, github_username)
    VALUES (${user.id}, ${user.login}, ${user.name}, ${user.email}, ${user.avatarUrl}, ${user.apiKey}, ${keyHash}, ${user.githubUsername || null})
    ON CONFLICT (id) DO UPDATE SET
      login = EXCLUDED.login,
      name = EXCLUDED.name,
      email = CASE WHEN EXCLUDED.email != '' THEN EXCLUDED.email ELSE users.email END,
      avatar_url = EXCLUDED.avatar_url,
      github_username = COALESCE(EXCLUDED.github_username, users.github_username),
      api_key_hash = COALESCE(EXCLUDED.api_key_hash, users.api_key_hash),
      api_key = NULL,
      last_login_at = NOW()
    RETURNING *
  `;
  return rows[0];
}

export async function dbUpdateUserTier(userId: string, tier: string): Promise<void> {
  await sql`UPDATE users SET tier = ${tier} WHERE id = ${userId}`;
}

export async function dbUpdateUserOrg(userId: string, orgId: string | null, role: string, tier: string): Promise<void> {
  await sql`UPDATE users SET org_id = ${orgId}, role = ${role}, tier = ${tier} WHERE id = ${userId}`;
}

export async function dbUpdateUserStripe(userId: string, customerId: string, subscriptionId: string | null): Promise<void> {
  await sql`UPDATE users SET stripe_customer_id = ${customerId}, stripe_subscription_id = ${subscriptionId} WHERE id = ${userId}`;
}

export async function dbRotateApiKey(userId: string, newApiKey: string): Promise<DbUser> {
  const keyHash = hashApiKey(newApiKey);
  const rows = await sql<DbUser[]>`UPDATE users SET api_key = NULL, api_key_hash = ${keyHash} WHERE id = ${userId} RETURNING *`;
  return rows[0];
}

export async function dbUpdatePreferredProvider(userId: string, provider: string): Promise<void> {
  await sql`UPDATE users SET preferred_provider = ${provider} WHERE id = ${userId}`;
}

/**
 * GDPR: Delete all user data atomically via stored procedure.
 * Anonymizes history/audit, removes memberships, drafts, settings,
 * and the user record in a single server-side transaction.
 */
export async function dbDeleteUser(userId: string): Promise<void> {
  if (!sql) return;
  await sql`SELECT delete_user_cascade(${userId})`;
}

/**
 * GDPR data export: returns all data the user owns or is associated with.
 */
export async function dbExportUserData(userId: string): Promise<Record<string, unknown>> {
  if (!sql) return { error: 'Database not configured' };
  const [user, generations, ownedOrgs, memberships, auditEvents, subscriptions, teamKeys] = await Promise.all([
    sql`SELECT id, email, name, login, tier, created_at FROM users WHERE id = ${userId}`,
    sql`SELECT id, project, version, format, created_at FROM generations WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 10000`,
    sql`SELECT id, name, slug, max_seats, created_at FROM orgs WHERE owner_id = ${userId}`,
    sql`SELECT om.org_id, om.role, om.joined_at, o.name AS org_name FROM org_members om JOIN orgs o ON o.id = om.org_id WHERE om.user_id = ${userId}`,
    sql`SELECT action, target, created_at FROM audit_events WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 10000`,
    sql`SELECT id, plan, status, current_period_start, current_period_end, cancel_at_period_end, created_at FROM subscriptions WHERE user_id = ${userId}`,
    sql`SELECT id, label, assigned_to_email, created_at, revoked_at FROM team_api_keys WHERE org_id IN (SELECT id FROM orgs WHERE owner_id = ${userId})`,
  ]);
  return {
    exportedAt: new Date().toISOString(),
    user: user[0] || null,
    generations,
    ownedOrgs,
    memberships,
    auditEvents,
    subscriptions,
    teamKeys,
  };
}
