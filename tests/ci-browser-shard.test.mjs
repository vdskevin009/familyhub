import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserCommands, browserSuites, shardCommands } from '../scripts/ci-browser-shard.mjs';
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
test('four shards cover every existing browser command exactly once', () => {
  const commands = browserCommands(scripts);
  const all = [1,2,3,4].flatMap(n => shardCommands(commands,n,4));
  assert.equal(new Set(all).size, commands.length);
  assert.deepEqual([...all].sort(), [...commands].sort());
  for (const suite of browserSuites) for (const command of scripts[suite].split(/\s*&&\s*/)) assert.ok(all.includes(command));
  assert.ok(all.includes('node apps/web/tests/theme-browser.mjs'));
  assert.ok(all.includes('node tests/bluecross-history-navigation-browser.mjs'));
});
test('future suite commands are included, while invalid or duplicate commands fail closed', () => {
  const next = {...scripts, 'test:claims:browser': scripts['test:claims:browser'] + ' && node tests/future-browser.mjs'};
  assert.ok(browserCommands(next).includes('node tests/future-browser.mjs'));
  for (const replacement of ['', 'echo skip', scripts['test:proactive:browser'], 'node tests/test.mjs; echo unsafe']) assert.throws(() => browserCommands({...scripts,'test:claims:browser':replacement}));
});
test('invalid shard parameters never silently select an empty test run', () => {
  for (const pair of [[0,4],[5,4],[1,0],[1,10000],[NaN,4],[1,2.5]]) assert.throws(() => shardCommands(browserCommands(scripts),...pair));
});

test('workflow keeps an always-evaluated aggregate gate and same-compile artifact references', () => {
  const workflow = readFileSync('.github/workflows/ci.yml','utf8');
  assert.match(workflow, /build:\s+if: always\(\)\s+needs: \[compile, unit, browser, domain, finance-recovery-windows\]/);
  for (const name of ['COMPILE','UNIT','BROWSER','DOMAIN','FINANCE_RECOVERY_WINDOWS']) assert.ok(workflow.includes(`test "$${name}" = success`));
  assert.match(workflow,/finance-recovery-windows:\s+runs-on: windows-latest/);
  assert.ok(workflow.includes('node --import tsx --test tests/finance-started-recovery.test.mjs'));
  assert.equal((workflow.match(/name: \$\{\{ needs\.compile\.outputs\.artifact_name \}\}/g) || []).length, 3);
  assert.equal((workflow.match(/sha256sum --check build\.sha256/g) || []).length, 4);
  assert.match(workflow,/fail-fast: false\s+matrix:\s+shard: \[1, 2, 3, 4\]/);
  assert.ok(workflow.includes('node scripts/ci-browser-shard.mjs ${{ matrix.shard }} 4'));
  assert.doesNotMatch(workflow,/continue-on-error|pull_request_target|workflow_run/);
  for (const suite of ['pwa','opportunities','savings','mortgage','finances','notifications','groceries','invoices','claims:readiness','claims']) assert.ok(workflow.includes(`npm run test:${suite}`));
  assert.ok(workflow.includes('dotnet run --project tests/Core.Tests -c Release'));
});

test('a failing browser process fails the shard and never advances to later commands', async () => {
  const { mkdtemp, mkdir, writeFile, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(),'familyhub-ci-contract-'));
  try {
    const fixtureScripts = Object.fromEntries(browserSuites.map((suite,index) => [suite, `node tests/suite-${index}.mjs`]));
    await writeFile(join(directory,'package.json'),JSON.stringify({scripts:fixtureScripts}));
    await mkdir(join(directory,'apps/web/tests'),{recursive:true});
    await mkdir(join(directory,'tests'));
    await writeFile(join(directory,'apps/web/tests/theme-browser.mjs'),'process.exit(7);');
    await writeFile(join(directory,'tests/bluecross-history-navigation-browser.mjs'),"import {writeFileSync} from 'node:fs';writeFileSync('must-not-run','unexpected');");
    const result = spawnSync(process.execPath,[resolve('scripts/ci-browser-shard.mjs'),'1','1'],{cwd:directory,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,7,result.stderr);
    await assert.rejects(access(join(directory,'must-not-run')));
  } finally { await rm(directory,{recursive:true,force:true}); }
});
