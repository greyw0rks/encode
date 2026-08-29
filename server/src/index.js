import './config/env.js';
import express from 'express';
import incidentsRouter from './routes/incidents.js';
import dashboardRouter from './dashboard/routes.js';
import { providerSummary } from './llm/provider.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'encode-api' }));

app.use(incidentsRouter);
app.use(dashboardRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  const llm = providerSummary();
  console.log(`Encode API listening on :${port}`);
  console.log(`LLM: ${llm.provider} (${llm.codingStrategy}) — ${llm.diagnosisModel} / ${llm.codingModel}`);
  console.log(`Attribution tag: ${process.env.ERC8021_ATTRIBUTION_TAG || '(not registered yet — settlements will NOT count on the leaderboard)'}`);
  if (!process.env.ENCODE_WALLET_ADDRESS) {
    console.warn('⚠️  ENCODE_WALLET_ADDRESS is unset — 402 quotes will have no payTo address.');
  }
});
