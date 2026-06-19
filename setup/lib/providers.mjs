/**
 * Retired: the setup-time PROVIDERS registry has been removed.
 *
 * LLM provider/model/API-key configuration is now owned by the Admin UI and
 * stored in the settings DB (see setup/CLAUDE.md). The hardcoded provider/model
 * table that previously lived here had no remaining consumers in the CLI.
 */
export {};
