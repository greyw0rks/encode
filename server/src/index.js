import './config/env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import incidentsRouter from './routes/incidents.js';
import dashboardRouter from './dashboard/routes.js';
import { providerSummary } from './llm/provider.js';
import { paymentConfig } from './celo/paymentConfig.js';
import { rateLimit } from './middleware/rateLimit.js';
import { reconcileInterrupted } from './store/incidentStore.js';

// Resolved from this module's own location, not the process cwd: the image
// runs with cwd=/app but a local `node src/index.js` from anywhere else would
// otherwise mount a directory that isn't there.
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// An incident runs *after* its response is sent, so a restart mid-run leaves a
// paid job with no process advancing it. Anything still non-terminal in the
// store belongs to a process that no longer exists, so resolve that before
// serving — otherwise the ledger shows work in progress that nobody is doing.
reconcileInterrupted();

const app = express();

// Behind a platform proxy (Railway, Fly, Render), req.ip is the proxy
// without this. Rate limiting keyed on the wrong address is worse than none.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '2mb' }));

// The landing page is served from this same origin (see the static mount
// below), so this is no longer load-bearing for it. It stays because the read
// endpoints are public anyway and someone hosting the page elsewhere with
// `?api=` should still get a working ledger. A payment is signed in a script or
// server-side, never from a browser page, so this only ever covers reads.
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

// The marketing page, served from this origin so its ledger reads /v1/status
// and /v1/dashboard with no `?api=` override and no second host to keep alive.
// Mounted before the JSON 404 so a missing asset still returns the API's error
// shape rather than express's HTML default — a judge hitting a typo'd path
// should get an error that looks like this service, not like a misconfigured one.
app.use(express.static(publicDir));

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
  // Where the settlement record lives is now a deploy-correctness question:
  // on a container filesystem with no volume mounted this path is erased on
  // every redeploy, and the evidence that someone paid goes with it.
  console.log(`Store: ${process.env.ENCODE_DB_PATH || 'data/encode.db'}`);
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
