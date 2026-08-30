import './config/env.js';
import express from 'express';
import incidentsRouter from './routes/incidents.js';
import dashboardRouter from './dashboard/routes.js';
import { providerSummary } from './llm/provider.js';
import { paymentConfig } from './celo/paymentConfig.js';
import { rateLimit } from './middleware/rateLimit.js';

const app = express();

// Behind a platform proxy (Railway, Fly, Render), req.ip is the proxy
// without this. Rate limiting keyed on the wrong address is worse than none.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '2mb' }));

// The landing page is served from a different origin than the API, and its
// ledger reads /v1/dashboard. A payment is signed in a script or server-side,
// never from a browser page, so this only exists for the read endpoints.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-PAYMENT, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'encode-api' }));

// /v1/status fans out to the facilitator twice per call, so it gets the
// tightest limit — unthrottled it burns Encode's facilitator quota on
// someone else's curl loop. The rest is a ceiling only a script would hit.
app.use('/v1/status', rateLimit({ max: 10, name: 'status' }));
app.use('/v1/dashboard', rateLimit({ max: 60, name: 'dashboard' }));
app.use('/v1', rateLimit({ max: 120, name: 'v1' }));

app.use(incidentsRouter);
app.use(dashboardRouter);

app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

app.use((err, req, res, next) => {
  // Log the real error, return a generic one — stack traces and internal
  // paths aren't the caller's business.
  console.error('[error]', err);
  res.status(500).json({ error: 'internal_error' });
});

const port = process.env.PORT || 8787;
const server = app.listen(port, '0.0.0.0', () => {
  const llm = providerSummary();
  const payment = paymentConfig();

  console.log(`Encode API listening on :${port}`);
  console.log(`LLM: ${llm.provider} (${llm.codingStrategy}) — ${llm.diagnosisModel} / ${llm.codingModel}`);
  console.log(
    `Payment: ${
      payment.ready ? `ready → ${payment.payTo} on ${payment.network}` : `NOT READY (missing: ${payment.missing.join(', ')})`
    }`
  );
  console.log(
    `Attribution tag: ${process.env.ERC8021_ATTRIBUTION_TAG || '(unregistered — settlements will NOT count on the leaderboard)'}`
  );
});

// Platforms send SIGTERM then kill. Finish in-flight requests rather than
// dropping one mid-response.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`\n${signal} received — closing server.`);
    server.close(() => process.exit(0));
    // An incident keeps running after its response is sent, so don't wait
    // on it forever.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
