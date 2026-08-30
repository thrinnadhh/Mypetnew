import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = resolve(repoRoot, 'scripts/supabase/provision-storage.mjs');

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { text += chunk; });
    request.on('end', () => resolveBody(text ? JSON.parse(text) : null));
    request.on('error', reject);
  });
}

test('provisioner handles NoSuchBucket and uses raw Storage snake_case fields', async () => {
  const buckets = new Map();
  const writes = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const match = url.pathname.match(/^\/storage\/v1\/bucket\/([^/]+)$/);
    if (request.method === 'GET' && match) {
      const id = decodeURIComponent(match[1]);
      if (!buckets.has(id)) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ statusCode: '404', code: 'NoSuchBucket', message: 'Bucket not found' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(buckets.get(id)));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/storage/v1/bucket') {
      const body = await readJson(request);
      writes.push(body);
      buckets.set(body.id, body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ name: body.name }));
      return;
    }

    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'unexpected request' }));
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  try {
    const { stdout } = await execFileAsync('node', [script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SUPABASE_URL: `http://127.0.0.1:${port}`,
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      },
    });

    assert.match(stdout, /catalog-media/);
    assert.match(stdout, /provider-verification-private/);
    assert.equal(writes.length, 2);
    for (const body of writes) {
      assert.equal(typeof body.file_size_limit, 'number');
      assert.equal(Array.isArray(body.allowed_mime_types), true);
      assert.equal('fileSizeLimit' in body, false);
      assert.equal('allowedMimeTypes' in body, false);
    }
    assert.equal(buckets.get('catalog-media').file_size_limit, 5 * 1024 * 1024);
    assert.equal(buckets.get('provider-verification-private').file_size_limit, 10 * 1024 * 1024);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
