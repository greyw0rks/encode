/**
 * LLM provider resolution
 * -----------------------
 * Encode talks to exactly one Anthropic-shaped API, but that API can be
 * either Anthropic itself or Qwen's Anthropic-compatible endpoint. Both
 * agents resolve their client and model from here so the choice lives in
 * one place instead of being hardcoded twice with different defaults.
 *
 * The distinction matters beyond the base URL: the Coding Agent can only
 * use the Claude Agent SDK against real Anthropic (the SDK spawns the
 * Claude Code binary, which authenticates against Anthropic directly and
 * ignores ANTHROPIC_BASE_URL for tool orchestration). On Qwen it falls
 * back to Encode's own tool loop — see agents/codingAgentQwen.js.
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
 * Single shared client. Constructed lazily so `dotenv/config` has run and
 * scripts that never make an LLM call (dryRun.js) don't need a key at all.
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

/** Diagnostic line for startup logs and the live-run harness. */
export function providerSummary() {
  const provider = resolveProvider();
  return {
    provider,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com (default)',
    diagnosisModel: modelFor('diagnosis'),
    codingModel: modelFor('coding'),
    codingStrategy: canUseAgentSdk() ? 'claude-agent-sdk' : 'encode-tool-loop',
  };
}
