/**
 * Agent authentication.
 *
 * Kept separate from x402 payment verification on purpose: payment proves
 * "this wallet paid," auth proves "this is a registered caller we can send
 * a job-status webhook to." A one-off human hitting curl doesn't need an
 * account; a monitoring agent that wants callbacks/rate-limit headroom
 * registers once and gets a token.
 *
 * Unauthenticated requests are allowed through — they just fall back to
 * anonymous, poll-only status (no webhook, tighter rate limit).
 */

import { randomUUID } from 'crypto';

const registeredAgents = new Map(); // token -> { agentId, erc8004Id, wallet }

export function registerAgent({ agentId, erc8004Id, wallet }) {
  const token = randomUUID();
  registeredAgents.set(token, { agentId, erc8004Id, wallet, registeredAt: Date.now() });
  return token;
}

export function identifyAgent(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    req.agent = { anonymous: true };
    return next();
  }

  const token = authHeader.slice(7);
  const agent = registeredAgents.get(token);

  if (!agent) {
    return res.status(401).json({ error: 'unknown_agent_token' });
  }

  req.agent = agent;
  next();
}
