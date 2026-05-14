import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, 'src');
const configPath = path.resolve(__dirname, 'config.json');
const latexModuleDir = path.resolve(__dirname, 'node_modules/latex.js');

function keepFilePlugin() {
  return {
    name: 'learn-latex-keep-file',
    load(id) {
      if (id.endsWith('.keep')) {
        return 'export default {}';
      }
      return null;
    },
  };
}

function keepFileEsbuildPlugin() {
  return {
    name: 'learn-latex-keep-file-esbuild',
    setup(build) {
      build.onLoad({ filter: /\.keep$/ }, () => ({
        contents: 'export default {}',
        loader: 'js',
      }));
    },
  };
}

function devApiPlugin() {
  let snapshot = null;
  let snapshotEpoch = 0;
  let snapshotRevision = 0;

  async function readConfig() {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  }

  async function parseBody(req) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    return raw ? JSON.parse(raw) : {};
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

  function normalizeSnapshotVersion(epoch, revision) {
    const nextEpoch = Number(epoch);
    const nextRevision = Number(revision);
    if (!Number.isFinite(nextEpoch) || !Number.isSafeInteger(nextRevision) || nextRevision < 1) {
      return null;
    }
    return { epoch: nextEpoch, revision: nextRevision };
  }

  function isStaleSnapshotVersion({ epoch, revision }) {
    return epoch < snapshotEpoch || (epoch === snapshotEpoch && revision < snapshotRevision);
  }

  return {
    name: 'learn-latex-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        if (req.method === 'GET' && req.url.startsWith('/config')) {
          try {
            const data = await readConfig();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Failed to read config' }));
          }
          return;
        }
        if (req.method === 'POST' && req.url.startsWith('/snapshot')) {
          try {
            const body = await parseBody(req);
            if (!body.files || typeof body.files !== 'object') {
              throw new Error('Invalid payload');
            }
            const version = normalizeSnapshotVersion(body.snapshotEpoch, body.snapshotRevision);
            if (!version) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid snapshot version' }));
              return;
            }
            if (isStaleSnapshotVersion(version)) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ status: 'stale' }));
              return;
            }
            snapshotEpoch = version.epoch;
            snapshotRevision = version.revision;
            snapshot = {
              files: body.files,
              activeFile: body.activeFile ?? '',
              lastRenderResult: normalizeRenderResult(body.lastRenderResult),
            };
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid snapshot payload' }));
          }
          return;
        }
        if (req.method === 'GET' && (req.url.startsWith('/snapshot') || req.url.startsWith('/content'))) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(snapshot ?? { files: {}, activeFile: '', lastRenderResult: null }));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: rootDir,
  plugins: [devApiPlugin(), keepFilePlugin()],
  resolve: {
    alias: {
      'latex.js/dist/css/katex.css': path.join(latexModuleDir, 'dist/css/katex.css'),
      'latex.js/dist/css/base.css': path.join(latexModuleDir, 'dist/css/base.css'),
      'latex.js/dist/css/article.css': path.join(latexModuleDir, 'dist/css/article.css'),
    },
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [keepFileEsbuildPlugin()],
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(rootDir, 'index.html'),
    },
  },
});
