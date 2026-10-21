declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    COST_ADMIN_PASSWORD_HASH: string;
    COST_ADMIN_PASSWORD_SALT: string;
    COST_ADMIN_PASSWORD_ITERATIONS?: string;
    COST_AUTH_SESSION_SECRET: string;
    COST_IP_HASH_SECRET: string;
    OPENAI_KEY_ENCRYPTION_KEY: string;
  }
}

