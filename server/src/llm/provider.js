/**
 * LLM provider resolution
 * -----------------------
 * Encode talks to Anthropic-shaped APIs. The PRIMARY endpoint can be either
 * Anthropic itself or Qwen's Anthropic-compatible endpoint. Both agents
 * resolve their client and model from here so the choice lives in one place
 * instead of being hardcoded twice with different defaults.
 *
 * The distinction matters beyond the base URL: the Coding Agent can only
 * use the Claude Agent SDK against real Anthropic (the SDK spawns the
 * Claude Code binary, which authenticates against Anthropic directly and
 * ignores ANTHROPIC_BASE_URL for tool orchestration). On Qwen it falls
 * back to Encode's own tool loop — see agents/codingAgentQwen.js.
 *
 * FALLBACK endpoint (optional): when the primary endpoint returns a
 * rate-limit / quota error, createMessage() transparently retries the same
 * request against a second Anthropic-shaped endpoint configured via the
 * FALLBACK_* env vars. This is per-call, not sticky — as soon as the primary
 * stops throwing limits, traffic goes back to it. Fallback only covers the
 * two messages.create call sites (diagnosis + the Qwen tool loop); the Agent
 * SDK path in codingAgent.js is not wrapped, but that path only runs when the
 * PRIMARY is real Anthropic, so it isn't in play for a Qwen-primary setup.
 */

import Anthropic from '@anthropic-ai/sdk';

/**
 * 'anthropic' | 'qwen'
 * Inferred rather than declared where possible: a base URL that isn't
 * Anthropic's means we're on a compatible third-party endpoint, and the
 * Agent SDK path isn't available. LLM_PROVIDER overrides the inference.
 */
export function resolveProvider() {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit === 'anthropic' || explicit === 'qwen') return explicit;

  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  if (!baseUrl) return 'anthropic';
  return baseUrl.includes('api.anthropic.com') ? 'anthropic' : 'qwen';
}

/** True only when the Claude Agent SDK's tool loop is actually usable. */
export function canUseAgentSdk() {
  return resolveProvider() === 'anthropic';
}

const DEFAULT_MODELS = {
  anthropic: {
    diagnosis: 'claude-haiku-4-5-20251001',
    coding: 'claude-sonnet-4-6',
  },
  // Confirmed available on the DashScope Anthropic-compatible endpoint as of
  // 2026-08-29. The plain `qwen-plus` / `qwen-max` aliases do NOT resolve
  // there — they return `400 Model not exist.` — so don't "restore" them.
  qwen: {
    diagnosis: 'qwen3.7-plus',
    coding: 'qwen3.7-max',
  },
};

/** @param {'diagnosis'|'coding'} role */
export function modelFor(role) {
  const override =
    role === 'coding' ? process.env.LLM_MODEL_CODING : process.env.LLM_MODEL_DIAGNOSIS;
  return override || DEFAULT_MODELS[resolveProvider()][role];
}

let client;

/**
 * Single shared primary client. Constructed lazily so `dotenv/config` has run
 * and scripts that never make an LLM call (dryRun.js) don't need a key at all.
 */
export function llmClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set — required for both the Anthropic and Qwen (Anthropic-compatible) paths.'
      );
    }
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
    });
  }
  return client;
}

// --- Fallback endpoint --------------------------------------------------

/**
 * The fallback is "configured" purely on its own API key being present. The
 * base URL is optional (blank → real Anthropic). We don't infer a provider
 * for it: the caller supplies its models explicitly, since a proxy/compatible
 * endpoint won't share Anthropic's model names.
 */
export function fallbackConfigured() {
  return Boolean(process.env.FALLBACK_ANTHROPIC_API_KEY);
}

/**
 * @param {'diagnosis'|'coding'} role
 * @returns {string|null} the model to use on the fallback, or null if the
 *   fallback key is set but no model was configured for this role.
 */
export function fallbackModelFor(role) {
  const roleOverride =
    role === 'coding' ? process.env.FALLBACK_LLM_MODEL_CODING : process.env.FALLBACK_LLM_MODEL_DIAGNOSIS;
  return roleOverride || process.env.FALLBACK_LLM_MODEL || null;
}

let fallbackClientInstance;

function fallbackClient() {
  if (!fallbackClientInstance) {
    fallbackClientInstance = new Anthropic({
      apiKey: process.env.FALLBACK_ANTHROPIC_API_KEY,
      ...(process.env.FALLBACK_ANTHROPIC_BASE_URL
        ? { baseURL: process.env.FALLBACK_ANTHROPIC_BASE_URL }
        : {}),
    });
  }
  return fallbackClientInstance;
}

/**
 * Whether an error from the primary endpoint should trigger the fallback.
 * 429 = rate limited, 529 = overloaded. Anthropic-compatible proxies and
 * DashScope don't always use 429 for quota exhaustion, so also match a
 * handful of unmistakable quota/limit phrases in the message as a backstop —
 * kept narrow to avoid falling back on unrelated 4xx errors.
 */
export function isLimitError(err) {
  const status = err?.status ?? err?.statusCode;
  if (status === 429 || status === 529) return true;

  const msg = `${err?.message ?? ''} ${err?.error?.message ?? ''}`.toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('insufficient_quota') ||
    msg.includes('too many requests') ||
    msg.includes('resource has been exhausted') ||
    msg.includes('exceeded your current')
  );
}

let warnedMissingFallbackModel = false;

/**
 * Run a messages.create against the primary endpoint, falling back to the
 * secondary endpoint on a rate-limit / quota error. `params` is everything
 * messages.create takes EXCEPT `model` — the model is injected per endpoint.
 *
 * @param {'diagnosis'|'coding'} role
 * @param {object} params  system / messages / tools / max_tokens, etc.
 */
export async function createMessage(role, params) {
  try {
    return await llmClient().messages.create({ model: modelFor(role), ...params });
  } catch (err) {
    if (!isLimitError(err) || !fallbackConfigured()) throw err;

    const fbModel = fallbackModelFor(role);
    if (!fbModel) {
      // Fallback key is set but no model configured for this role — surface it
      // once and let the original limit error propagate (behaviour = no fallback).
      if (!warnedMissingFallbackModel) {
        console.warn(
          `[llm] FALLBACK_ANTHROPIC_API_KEY is set but no fallback model for role="${role}" ` +
            `(set FALLBACK_LLM_MODEL or FALLBACK_LLM_MODEL_${role.toUpperCase()}). Not falling back.`
        );
        warnedMissingFallbackModel = true;
      }
      throw err;
    }

    console.warn(
      `[llm] primary (${resolveProvider()} / ${modelFor(role)}) hit a limit ` +
        `(${err?.status ?? err?.name ?? 'limit'}); falling back to ${fbModel} @ ` +
        `${process.env.FALLBACK_ANTHROPIC_BASE_URL || 'api.anthropic.com (default)'}`
    );
    return await fallbackClient().messages.create({ model: fbModel, ...params });
  }
}

/** Diagnostic line for startup logs and the live-run harness. */
export function providerSummary() {
  const provider = resolveProvider();
  return {
    provider,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com (default)',
    diagnosisModel: modelFor('diagnosis'),
    codingModel: modelFor('coding'),
    codingStrategy: canUseAgentSdk() ? 'claude-agent-sdk' : 'encode-tool-loop',
    fallback: fallbackConfigured()
      ? {
          baseUrl: process.env.FALLBACK_ANTHROPIC_BASE_URL || 'api.anthropic.com (default)',
          diagnosisModel: fallbackModelFor('diagnosis'),
          codingModel: fallbackModelFor('coding'),
        }
      : null,
  };
}
