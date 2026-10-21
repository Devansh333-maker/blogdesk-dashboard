import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const blogDailySummaries = sqliteTable('blog_daily_summaries', {
  date: text('date').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const costDailySnapshots = sqliteTable('cost_daily_snapshots', {
  date: text('date').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const openAIAdminCredentials = sqliteTable('openai_admin_credentials', {
  id: integer('id').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  keyHint: text('key_hint').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const costAdminSessions = sqliteTable('cost_admin_sessions', {
  idHash: text('id_hash').primaryKey(),
  csrfHash: text('csrf_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [
  index('cost_admin_sessions_expiry').on(table.expiresAt),
]);

export const costAccessLimits = sqliteTable('cost_access_limits', {
  scopeKey: text('scope_key').primaryKey(),
  windowStart: integer('window_start').notNull(),
  attempts: integer('attempts').notNull(),
  blockedUntil: integer('blocked_until').notNull().default(0),
});
