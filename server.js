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

// Pre-loaded image store (in-memory). Lives only as long as the server process.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
const MAX_IMAGES = 20;
const images = new Map(); // name -> { buffer, mime, size }

function imageMetadata() {
  const out = {};
  for (const [name, info] of images.entries()) {
    out[name] = {
      url: `/image/${encodeURIComponent(name)}`,
      mime: info.mime,
      size: info.size,
    };
  }
  return out;
}

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

// ---------------------------- Image API ----------------------------
// List uploaded images (no buffer, just metadata).
app.get('/images', (req, res) => {
  res.json(imageMetadata());
});

// Serve an image by name. Used by the frontend img.src.
app.get('/image/:name', (req, res) => {
  const info = images.get(req.params.name);
  if (!info) return res.status(404).end();
  res.setHeader('Content-Type', info.mime);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(info.buffer);
});

// Upload raw bytes.  curl -X PUT host/images/foo.png -H "Content-Type: image/png" --data-binary @foo.png
app.put(
  '/images/:name',
  express.raw({ type: '*/*', limit: MAX_IMAGE_BYTES + 1024 }),
  (req, res) => {
    const name = req.params.name;
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ error: 'Empty body' });
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: `Image exceeds ${MAX_IMAGE_BYTES} bytes` });
    }
    if (!images.has(name) && images.size >= MAX_IMAGES) {
      return res.status(429).json({ error: `Already at the limit of ${MAX_IMAGES} images` });
    }
    const mime = (req.headers['content-type'] || '').split(';')[0].trim() || 'application/octet-stream';
    if (!mime.startsWith('image/')) {
      return res.status(415).json({ error: `Content-Type ${mime} is not image/*` });
    }
    images.set(name, { buffer, mime, size: buffer.length });
    res.json({ ok: true, name, size: buffer.length, mime });
  },
);

// Server-side fetch from a URL.  curl -X POST host/images/fetch -H "Content-Type: application/json" -d '{"name":"x.png","url":"https://..."}'
app.post('/images/fetch', async (req, res) => {
  const { name, url } = req.body || {};
  if (!name || typeof name !== 'string' || !url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Body must be { name: string, url: string }' });
  }
  if (!images.has(name) && images.size >= MAX_IMAGES) {
    return res.status(429).json({ error: `Already at the limit of ${MAX_IMAGES} images` });
  }
  try {
    const resp = await fetch(url);
    if (!resp.ok) return res.status(502).json({ error: `Upstream HTTP ${resp.status}` });
    const mime = (resp.headers.get('content-type') || '').split(';')[0].trim() || 'application/octet-stream';
    if (!mime.startsWith('image/')) {
      return res.status(415).json({ error: `Upstream Content-Type ${mime} is not image/*` });
    }
    const ab = await resp.arrayBuffer();
    if (ab.byteLength > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: `Upstream payload exceeds ${MAX_IMAGE_BYTES} bytes` });
    }
    images.set(name, { buffer: Buffer.from(ab), mime, size: ab.byteLength });
    res.json({ ok: true, name, size: ab.byteLength, mime });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Fetch failed' });
  }
});

app.delete('/images/:name', (req, res) => {
  if (images.delete(req.params.name)) res.json({ ok: true });
  else res.status(404).json({ error: 'Not found' });
});

if (isProduction) {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get('*path', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`learn-latex server running on port ${port}`);
});
