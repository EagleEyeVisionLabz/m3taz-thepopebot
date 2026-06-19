/**
 * Helper LLM — small one-shot completions used by the event handler itself
 * (chat titles, agent-job summaries, agent-job titles). Independent of the
 * coding agent and the streaming chat path.
 *
 * Provider/model is set at /admin/event-handler/helper-llm and stored as
 * LLM_PROVIDER / LLM_MODEL config keys. Credentials live in the same settings
 * DB used by /admin/event-handler/llms.
 */

import { generateText, generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getConfig } from '../config.js';
import { getCustomProvider } from '../db/config.js';
import { BUILTIN_PROVIDERS } from '../llm-providers.js';

/**
 * Validate a provider baseURL before using it as a server-side HTTP endpoint.
 * Rejects non-https schemes, embedded credentials, and private/loopback/
 * link-local/metadata hosts to prevent SSRF to internal services.
 *
 * @param {string} rawUrl
 * @param {string} slug - provider slug, for error messages
 * @returns {string} the validated URL
 */
function validateBaseUrl(rawUrl, slug) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Provider ${slug} has an invalid baseUrl`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Provider ${slug} baseUrl must use https`);
  }
  if (url.username || url.password) {
    throw new Error(`Provider ${slug} baseUrl must not contain credentials`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // Block loopback, link-local, and cloud-metadata hostnames/IP literals.
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host === 'metadata.google.internal' ||
    host === '169.254.169.254' ||
    host === 'fd00:ec2::254' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^(fc|fd)[0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host);
  if (blocked) {
    throw new Error(`Provider ${slug} baseUrl points at a disallowed host`);
  }
  return url.toString();
}

/**
 * Build the active LanguageModelV2 instance for helper LLM calls.
 * Reads LLM_PROVIDER + LLM_MODEL from config and selects the right adapter.
 *
 * @returns {import('ai').LanguageModelV2}
 */
function resolveModel() {
  const slug = getConfig('LLM_PROVIDER');
  const modelName = getConfig('LLM_MODEL');
  if (!slug) throw new Error('LLM_PROVIDER not configured');
  if (!modelName) throw new Error('LLM_MODEL not configured');

  if (slug === 'anthropic') {
    return createAnthropic({ apiKey: getConfig('ANTHROPIC_API_KEY') })(modelName);
  }
  if (slug === 'google') {
    return createGoogleGenerativeAI({ apiKey: getConfig('GOOGLE_API_KEY') })(modelName);
  }
  if (slug === 'openai') {
    return createOpenAI({ apiKey: getConfig('OPENAI_API_KEY') })(modelName);
  }

  // Built-in OpenAI-compatible providers (deepseek, mistral, xai, kimi, openrouter, nvidia)
  const builtin = BUILTIN_PROVIDERS[slug];
  if (builtin) {
    if (!builtin.baseUrl) throw new Error(`Provider ${slug} has no baseUrl`);
    return createOpenAICompatible({
      name: slug,
      baseURL: validateBaseUrl(builtin.baseUrl, slug),
      apiKey: getConfig(builtin.credentials[0].key),
    })(modelName);
  }

  // Custom user-added OpenAI-compatible provider
  const custom = getCustomProvider(slug);
  if (custom) {
    return createOpenAICompatible({
      name: slug,
      baseURL: validateBaseUrl(custom.baseUrl, slug),
      apiKey: custom.apiKey || 'not-needed',
    })(modelName);
  }

  throw new Error(`Unknown LLM provider: ${slug}`);
}

/**
 * Plain-text helper LLM call. Returns the trimmed text.
 *
 * @param {object} args
 * @param {string} args.system - System prompt
 * @param {string} args.user - User prompt
 * @param {number} args.maxTokens - Max output tokens
 * @returns {Promise<string>}
 */
export async function callHelperLlm({ system, user, maxTokens }) {
  const model = resolveModel();
  const { text } = await generateText({
    model,
    system,
    prompt: user,
    maxOutputTokens: maxTokens ?? (Number(getConfig('LLM_MAX_TOKENS')) || 4096),
  });
  return (text || '').trim();
}

/**
 * Structured helper LLM call. Returns the parsed object matching the schema.
 * Throws if the response can't be parsed or fails schema validation —
 * callers catch and fall back as appropriate.
 *
 * @param {object} args
 * @param {string} args.system - System prompt
 * @param {string} args.user - User prompt
 * @param {import('zod').ZodTypeAny} args.schema - Zod schema for the output
 * @param {number} args.maxTokens - Max output tokens
 * @returns {Promise<unknown>}
 */
export async function callHelperLlmStructured({ system, user, schema, maxTokens }) {
  const model = resolveModel();
  const { object } = await generateObject({
    model,
    system,
    prompt: user,
    schema,
    maxOutputTokens: maxTokens ?? (Number(getConfig('LLM_MAX_TOKENS')) || 4096),
  });
  return object;
}
