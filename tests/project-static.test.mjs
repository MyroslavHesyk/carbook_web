import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

 test('HTML references the app stylesheet and required local scripts', async () => {
  const html = await read('../index.html');
  for (const fragment of [
    './styles.css', './config.js', './app.js', './manifest.webmanifest',
    'id="auth-view"', 'id="app"', 'id="view-content"', 'id="modal-root"'
  ]) assert.ok(html.includes(fragment), `Expected index.html to include ${fragment}`);
});

test('config file contains placeholders only and no privileged Supabase key', async () => {
  const config = await read('../config.js');
  assert.match(config, /supabaseUrl:\s*""/);
  assert.match(config, /publishableKey:\s*""/);
  const executableConfig = config.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(executableConfig, /sb_secret_|service_role|eyJ[A-Za-z0-9_-]{30,}/i);
});

test('all client data tables exist in the initial SQL schema and RLS is enabled', async () => {
  const app = await read('../app.js');
  const schema = await read('../supabase-schema.sql');
  const tables = [...app.matchAll(/table:\s*'([a-z_]+)'/g)].map((match) => match[1]);
  assert.equal(new Set(tables).size, 5);
  for (const table of tables) {
    assert.ok(schema.includes(`public.${table} (`), `Missing table ${table}`);
    assert.ok(schema.includes(`public.${table} enable row level security`), `RLS not enabled for ${table}`);
  }
  assert.ok(schema.includes('public.cars enable row level security'));
  assert.ok(schema.includes('default auth.uid()'));
});

test('service worker only handles same-origin static GET requests', async () => {
  const worker = await read('../sw.js');
  assert.match(worker, /request\.method !== 'GET' \|\| url\.origin !== self\.location\.origin/);
  assert.match(worker, /'\.\/core\.mjs'/);
  assert.match(worker, /'\.\/assets\/icon-512\.png'/);
});
