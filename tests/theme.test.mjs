import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const css = await readFile('apps/web/src/ui/tokens.css', 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const value = name => tokens[name].startsWith('var(') ? value(tokens[name].slice(4, -1)) : tokens[name];
const luminance = hex => {
  const c = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
};
const contrast = (a, b) => { const x = luminance(value(a)), y = luminance(value(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
test('Theme: neutral surfaces and one action accent, distinct semantic states', () => {
  assert.equal(value('--canvas'), '#f5f6f8'); assert.equal(value('--surface'), '#ffffff'); assert.equal(value('--ink'), '#202124'); assert.equal(value('--muted'), '#62676f'); assert.equal(value('--accent'), '#2463d3');
  assert.equal(value('--green'), value('--accent')); assert.notEqual(value('--success'), value('--accent'));
  for (const text of ['--ink', '--muted', '--accent']) for (const bg of ['--surface', '--canvas']) assert.ok(contrast(text, bg) >= 4.5, `${text} on ${bg}`);
  for (const state of ['success', 'warning', 'danger']) assert.ok(contrast(`--${state}`, `--${state}-soft`) >= 4.5);
  assert.ok(contrast('--accent', '--accent-soft') >= 4.5); assert.ok(contrast('--control-line', '--surface') >= 3);
  assert.match(css, /color-scheme:\s*light/); assert.equal(value('--control'), '48px');
});
test('Theme: browser chrome matches canvas while launcher identity stays intact', async () => {
  const manifest = JSON.parse(await readFile('apps/web/public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.theme_color, value('--canvas')); assert.equal(manifest.background_color, value('--canvas'));
  assert.match(await readFile('apps/web/index.html', 'utf8'), /name="theme-color" content="#f5f6f8"/);
  assert.deepEqual(manifest.icons.map(x => x.src), ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon.svg']);
  assert.match(await readFile('apps/web/public/sw.js', 'utf8'), /familyhub-v2-shell-11/);
});

test('Theme: borderless search inputs retain a contrasting outer boundary', async () => {
  const styles = await readFile('apps/web/src/styles.css', 'utf8');
  assert.match(styles, /\.search-field \{[^}]*border: 1px solid var\(--control-line\)/);
});
