/**
 * Config target mapping — single source of truth for where each config key goes.
 *
 * `env: true` — written to .env
 * `db: true` — stored as plain config in DB
 * `dbSecret: true` — stored encrypted in DB
 * `secret: true` — GitHub secret name === env key name
 * `secret: 'NAME'` — GitHub secret uses a different name
 * `variable: true` — GitHub repository variable
 * `default` — default value for firstRunOnly variables
 * `firstRunOnly: true` — only set on GitHub during first-time setup
 *
 * Only keys present in `collected` are synced — absent keys are untouched.
 * Empty string values write to .env but do NOT set as GitHub secrets.
 */
export const CONFIG_TARGETS = {
  // Secrets → DB encrypted (never .env)
  GH_TOKEN:              { env: true, dbSecret: true },
  ANTHROPIC_API_KEY:     { dbSecret: true },
  OPENAI_API_KEY:        { dbSecret: true },
  GOOGLE_API_KEY:        { dbSecret: true },
  CUSTOM_API_KEY:        { dbSecret: true },
  MOONSHOT_API_KEY:      { dbSecret: true },
  CLAUDE_CODE_OAUTH_TOKEN: { dbSecret: true },
  GH_WEBHOOK_SECRET:     { dbSecret: true, secret: true },
  TELEGRAM_BOT_TOKEN:    { dbSecret: true },
  TELEGRAM_WEBHOOK_SECRET: { dbSecret: true },

  // Plain config → DB (not .env)
  LLM_PROVIDER:          { db: true },
  LLM_MODEL:             { db: true },
  CUSTOM_OPENAI_BASE_URL: { db: true },
  AGENT_BACKEND:         { db: true },

  // Infrastructure → .env only (needed before DB is available)
  GH_OWNER:              { env: true },
  GH_REPO:               { env: true },
  APP_URL:               { env: true, variable: true },
  APP_HOSTNAME:          { env: true },

  // GitHub variables consumed by scaffolded workflows
  AUTO_MERGE:            { variable: true, default: 'true', firstRunOnly: true },
  ALLOWED_PATHS:         { variable: true, default: '/', firstRunOnly: true },
  RUNS_ON:               { variable: true },
};
