import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.IS_PRODUCTION === 'true';
const configPath = path.join(__dirname, 'config.json');

let snapshot = null;

function normalizeRenderResult(status) {
  if (!status || typeof status !== 'object') return null;
  const ok = Boolean(status.ok);
  return {
    ok,
    error: ok ? null : (typeof status.error === 'string' ? status.error : null),
    file: typeof status.file === 'string' ? status.file : '',
    timestamp: typeof status.timestamp === 'string' ? status.timestamp : null,
  };
}

app.use(express.json({ limit: '2mb' }));

async function readConfig() {
  const raw = await fs.readFile(configPath, 'utf-8');
  return JSON.parse(raw);
}

app.get('/config', async (req, res) => {
  try {
    const config = await readConfig();
    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read config' });
  }
});

app.post('/snapshot', (req, res) => {
  const { files, activeFile, lastRenderResult } = req.body || {};
  if (!files || typeof files !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  snapshot = {
    files,
    activeFile: activeFile ?? '',
    lastRenderResult: normalizeRenderResult(lastRenderResult),
  };
  res.json({ status: 'ok' });
});

app.get('/snapshot', (req, res) => {
  res.json(snapshot ?? { files: {}, activeFile: '', lastRenderResult: null });
});

app.get('/content', (req, res) => {
  res.json(snapshot ?? { files: {}, activeFile: '', lastRenderResult: null });
});

if (isProduction) {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`learn-latex server running on port ${port}`);
});
