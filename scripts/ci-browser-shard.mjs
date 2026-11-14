import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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
    const result = spawnSync(process.execPath, command.split(' ').slice(1), { stdio: 'inherit', env: process.env, windowsHide: true });
    console.log(`Elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s\n::endgroup::`);
    if (result.error || result.signal || result.status !== 0) {
      console.error(result.error || result.signal || `Failed: ${command}`);
      process.exit(result.status || 1);
    }
  }
}
