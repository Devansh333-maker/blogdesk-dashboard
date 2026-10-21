import { env } from 'cloudflare:workers';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 as sha256Hash } from '@noble/hashes/sha256';

const SESSION_COOKIE = '__Host-blogdesk-cost-session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const RECENT_AUTH_SECONDS = 15 * 60;
const KEY_AAD = 'blogdesk:openai-admin-key:v1:credential:1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

type SessionRow = {
  id_hash: string;
  csrf_hash: string;
  created_at: number;
  expires_at: number;
};

export type AdminSession = {
  idHash: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
};

export class SecureServiceUnavailableError extends Error {}

function runtimeBindings() {
  return env as unknown as Record<string, unknown>;
}

function getDatabase() {
  const database = runtimeBindings().DB as D1Database | undefined;
  if (!database) throw new SecureServiceUnavailableError('Secure storage is unavailable.');
  return database;
}

function getSecret(name: keyof Cloudflare.Env) {
  const value = runtimeBindings()[name];
  if (typeof value !== 'string' || value.length < 1) {
    throw new SecureServiceUnavailableError('Secure configuration is unavailable.');
  }
  return value;
}

export async function ensureCostSchema() {
  getDatabase();
}

export async function readSmallJson(request: Request, maximumBytes = 2048): Promise<Record<string, unknown> | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = JSON.parse(decoder.decode(bytes)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(length = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

async function sha256(value: string) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function parseCookies(request: Request) {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

function sessionCookie(value: string, maxAge: number) {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return sessionCookie('', 0);
}

export function jsonPrivate(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(privateHeaders);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return Response.json(body, {
    ...init,
    headers,
  });
}

export function acceptsSameOriginJson(request: Request) {
  const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? '';
  const origin = request.headers.get('Origin');
  const expectedOrigin = new URL(request.url).origin;
  return contentType.startsWith('application/json') && origin === expectedOrigin;
}

export async function verifyAdminPassword(password: string) {
  if (password.length < 12 || password.length > 512) return false;
  const salt = base64UrlToBytes(getSecret('COST_ADMIN_PASSWORD_SALT'));
  const expected = getSecret('COST_ADMIN_PASSWORD_HASH');
  const configuredIterations = Number(runtimeBindings().COST_ADMIN_PASSWORD_ITERATIONS ?? '600000');
  const iterations = Number.isSafeInteger(configuredIterations) && configuredIterations >= 600_000
    ? configuredIterations
    : 600_000;
  const derived = await pbkdf2Async(sha256Hash, encoder.encode(password), salt, {
    c: iterations, dkLen: 32, asyncTick: 10,
  });
  return timingSafeEqual(bytesToBase64Url(derived), expected);
}

export async function createAdminSession() {
  await ensureCostSchema();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;
  const sessionId = randomToken();
  const csrfToken = randomToken(24);
  const idHash = await sha256(sessionId);
  const csrfHash = await sha256(csrfToken);
  await getDatabase().batch([
    getDatabase().prepare('DELETE FROM cost_admin_sessions WHERE expires_at <= ?').bind(now),
    getDatabase().prepare(
      'DELETE FROM cost_access_limits WHERE window_start < ? AND blocked_until <= ?',
    ).bind(now - 86_400, now),
  ]);
  await getDatabase().prepare(
    'INSERT INTO cost_admin_sessions (id_hash, csrf_hash, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).bind(idHash, csrfHash, now, expiresAt).run();
  const unsigned = `v1.${sessionId}.${expiresAt}.${csrfToken}`;
  const signature = await hmac(getSecret('COST_AUTH_SESSION_SECRET'), unsigned);
  return {
    csrfToken,
    cookie: sessionCookie(`${unsigned}.${signature}`, SESSION_TTL_SECONDS),
  };
}

export async function getAdminSession(request: Request): Promise<AdminSession | null> {
  await ensureCostSchema();
  const value = parseCookies(request).get(SESSION_COOKIE);
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const [version, sessionId, expiresText, csrfToken, signature] = parts;
  const expiresAt = Number(expiresText);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + SESSION_TTL_SECONDS) return null;
  const unsigned = `${version}.${sessionId}.${expiresText}.${csrfToken}`;
  const expectedSignature = await hmac(getSecret('COST_AUTH_SESSION_SECRET'), unsigned);
  if (!timingSafeEqual(signature, expectedSignature)) return null;
  const idHash = await sha256(sessionId);
  const row = await getDatabase().prepare(
    'SELECT id_hash, csrf_hash, created_at, expires_at FROM cost_admin_sessions WHERE id_hash = ?',
  ).bind(idHash).first<SessionRow>();
  if (!row || row.expires_at !== expiresAt || row.expires_at <= now) return null;
  if (!timingSafeEqual(row.csrf_hash, await sha256(csrfToken))) return null;
  return { idHash, csrfToken, createdAt: row.created_at, expiresAt: row.expires_at };
}

export async function deleteAdminSession(session: AdminSession) {
  await getDatabase().prepare('DELETE FROM cost_admin_sessions WHERE id_hash = ?').bind(session.idHash).run();
}

export function hasValidCsrf(request: Request, session: AdminSession) {
  const supplied = request.headers.get('X-BlogDesk-CSRF') ?? '';
  return supplied.length > 0 && timingSafeEqual(supplied, session.csrfToken);
}

export function wasRecentlyAuthenticated(session: AdminSession) {
  return Math.floor(Date.now() / 1000) - session.createdAt <= RECENT_AUTH_SECONDS;
}

async function consumeRateLimit(scopeKey: string, maximum: number, windowSeconds: number, blockSeconds: number) {
  await ensureCostSchema();
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowSeconds;
  await getDatabase().prepare(`
    INSERT INTO cost_access_limits (scope_key, window_start, attempts, blocked_until)
    VALUES (?, ?, 1, 0)
    ON CONFLICT(scope_key) DO UPDATE SET
      attempts = CASE WHEN window_start < ? THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END,
      blocked_until = CASE
        WHEN blocked_until > ? THEN blocked_until
        WHEN window_start >= ? AND attempts + 1 >= ? THEN ?
        ELSE 0
      END
  `).bind(scopeKey, now, cutoff, cutoff, now, now, cutoff, maximum, now + blockSeconds).run();
  const row = await getDatabase().prepare(
    'SELECT attempts, blocked_until FROM cost_access_limits WHERE scope_key = ?',
  ).bind(scopeKey).first<{ attempts: number; blocked_until: number }>();
  return Boolean(row && row.blocked_until <= now && row.attempts < maximum);
}

export async function allowLoginAttempt(request: Request) {
  const forwarded = request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? 'unknown';
  const ipHash = await hmac(getSecret('COST_IP_HASH_SECRET'), forwarded);
  const globalAllowed = await consumeRateLimit('login:global', 61, 15 * 60, 30 * 60);
  if (!globalAllowed) return false;
  return consumeRateLimit(`login:ip:${ipHash}`, 6, 15 * 60, 30 * 60);
}

export async function allowSensitiveAttempt(session: AdminSession, action: 'setup' | 'analysis') {
  const maximum = action === 'setup' ? 11 : 31;
  const window = action === 'setup' ? 15 * 60 : 60;
  return consumeRateLimit(`${action}:session:${session.idHash}`, maximum, window, window);
}

export async function allowPublicReportAttempt(request: Request) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await hmac(getSecret('COST_IP_HASH_SECRET'), ip);
  if (!await consumeRateLimit('report:global', 121, 60, 60)) return false;
  return consumeRateLimit(`report:ip:${ipHash}`, 31, 60, 60);
}

function encryptionKeyBytes() {
  const bytes = base64UrlToBytes(getSecret('OPENAI_KEY_ENCRYPTION_KEY'));
  if (bytes.length !== 32) throw new SecureServiceUnavailableError('Secure configuration is unavailable.');
  return bytes;
}

async function aesKey() {
  return crypto.subtle.importKey('raw', encryptionKeyBytes(), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function validateAdminKey(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.startsWith('sk-')
    && value.length >= 24
    && value.length <= 512
    && !/\s/u.test(value);
}

export async function saveEncryptedAdminKey(adminKey: string) {
  await ensureCostSchema();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(KEY_AAD), tagLength: 128 },
    await aesKey(),
    encoder.encode(adminKey),
  ));
  const now = Math.floor(Date.now() / 1000);
  const keyHint = `••••${adminKey.slice(-4)}`;
  await getDatabase().prepare(`
    INSERT INTO openai_admin_credentials
      (id, ciphertext, iv, key_version, key_hint, created_at, updated_at)
    VALUES (1, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      key_version = excluded.key_version,
      key_hint = excluded.key_hint,
      updated_at = excluded.updated_at
  `).bind(bytesToBase64Url(encrypted), bytesToBase64Url(iv), keyHint, now, now).run();
  return { keyHint, updatedAt: new Date(now * 1000).toISOString() };
}

export async function getCredentialStatus() {
  await ensureCostSchema();
  const row = await getDatabase().prepare(
    'SELECT key_hint, updated_at FROM openai_admin_credentials WHERE id = 1',
  ).first<{ key_hint: string; updated_at: number }>();
  return row
    ? { configured: true, keyHint: row.key_hint, updatedAt: new Date(row.updated_at * 1000).toISOString() }
    : { configured: false, keyHint: null, updatedAt: null };
}

export async function decryptAdminKey() {
  await ensureCostSchema();
  const row = await getDatabase().prepare(
    'SELECT ciphertext, iv, key_version FROM openai_admin_credentials WHERE id = 1',
  ).first<{ ciphertext: string; iv: string; key_version: number }>();
  if (!row) return null;
  if (row.key_version !== 1) throw new SecureServiceUnavailableError('Saved credential version is unavailable.');
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlToBytes(row.iv),
        additionalData: encoder.encode(KEY_AAD),
        tagLength: 128,
      },
      await aesKey(),
      base64UrlToBytes(row.ciphertext),
    );
    return decoder.decode(decrypted);
  } catch {
    throw new SecureServiceUnavailableError('Saved credential cannot be read.');
  }
}
