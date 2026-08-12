import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTransaction, ValidationError, type AnalyzeInput } from './aegis';

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'aegis-api', network: 'Arbitrum Sepolia', ai: Boolean(process.env.OPENAI_API_KEY) });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const result = await analyzeTransaction(req.body as AnalyzeInput);
    res.json(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('AEGIS analysis failure:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const dist = join(__dirname, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(port, () => {
  console.log(`AEGIS API listening on http://localhost:${port}`);
});
