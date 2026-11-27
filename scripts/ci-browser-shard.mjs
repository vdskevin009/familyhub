import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const dossierTest = 'apps/web/tests/opportunity-dossier-browser.mjs';
const cardPaths = [
  'apps/web/src/views/PropertyProjectView.tsx',
  'apps/web/src/views/VehicleProjectView.tsx',
  'apps/web/src/property-project.css',
  'apps/web/src/ui/opportunity-dossier.css',
  'apps/web/src/ui/OpportunityDossier.tsx',
  'apps/web/src/ui/ComparableSales.tsx',
  'apps/web/src/ui/ListingPhoto.tsx',
  dossierTest,
];

// The PR checkout is the tested merge tree. Filtering in Git covers both sides
// of a rename and avoids API pagination or interpreting untrusted filenames.
export function cardRenderPlan(command, env, cwd = process.cwd()) {
  if (command !== 'node ' + dossierTest || env.GITHUB_EVENT_NAME !== 'pull_request') return null;
  const base = env.CARD_RENDER_BASE || '';
  const status = /^[a-f0-9]{40}$/.test(base) ? spawnSync('git',
    ['diff', '--quiet', '--no-ext-diff', '--no-renames', base, 'HEAD', '--', ...cardPaths],
    { cwd, timeout: 5000, windowsHide: true }).status : null;
  if (status === 0) return { check: false, reason: 'no card paths changed' };
  return { check: true, reason: status === 1 ? 'card paths changed' : 'comparison unavailable; checking render' };
}

// Keep package.json authoritative: additions to these suites join the shards automatically.
export const browserSuites = ['test:proactive:browser', 'test:savings:browser', 'test:mortgage:browser', 'test:finances:browser', 'test:notifications:browser', 'test:groceries:browser', 'test:claims:browser'];
export function browserCommands(scripts) {
  const commands = ['node apps/web/tests/theme-browser.mjs', 'node tests/bluecross-history-navigation-browser.mjs'];
  for (const suite of browserSuites) {
    if (!scripts[suite]) throw new Error(`Missing required browser suite: ${suite}`);
    commands.push(...scripts[suite].split(/\s*&&\s*/));
  }
  for (const command of commands) {
    if (!/^node(?: --import tsx)? (?:apps\/web\/tests|tests)\/[a-z0-9-]+\.mjs$/.test(command)) throw new Error(`Unsupported browser command: ${command}`);
  }
  if (new Set(commands).size !== commands.length) throw new Error('Duplicate browser command');
  return commands;
}
export function shardCommands(commands, shard, total) {
  if (!Number.isInteger(shard) || !Number.isInteger(total) || total < 1 || shard < 1 || shard > total || total > commands.length) throw new Error('Invalid browser shard');
  return commands.filter((_, index) => index % total === shard - 1);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const commands = browserCommands(JSON.parse(readFileSync('package.json', 'utf8')).scripts);
  const selected = shardCommands(commands, Number(process.argv[2]), Number(process.argv[3]));
  for (const command of selected) {
    console.log(`::group::${command}`);
    const started = Date.now();
    const args = command.split(' ').slice(1);
    const render = cardRenderPlan(command, process.env);
    if (render) console.log('Card render: ' + render.reason);
    if (render?.check) args.push('--check-render');
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env, windowsHide: true,
      timeout: render?.check ? 180_000 : undefined });
    console.log(`Elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s\n::endgroup::`);
    if (result.error || result.signal || result.status !== 0) {
      console.error(result.error || result.signal || `Failed: ${command}`);
      process.exit(result.status || 1);
    }
  }
}
