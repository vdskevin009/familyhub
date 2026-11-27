import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserCommands, browserSuites, cardRenderPlan, shardCommands } from '../scripts/ci-browser-shard.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
test('card render uses the tested Git diff once across shards, including renames and an unavailable base', async () => {
  const root = 'output/playwright';
  await mkdir(root, {recursive:true});
  const cwd = await mkdtemp(join(root, 'render-contract-'));
  const git = (...args) => execFileSync('git', args, {cwd, encoding:'utf8', windowsHide:true}).trim();
  const commit = () => {
    git('add', '.');
    git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture');
    return git('rev-parse','HEAD');
  };
  const command = 'node apps/web/tests/opportunity-dossier-browser.mjs';
  const views = join(cwd, 'apps/web/src/views');
  const env = {GITHUB_EVENT_NAME:'pull_request'};
  const plan = () => cardRenderPlan(command, env, cwd);
  const commands = browserCommands(scripts);
  const runShard = () => spawnSync(process.execPath, [resolve('scripts/ci-browser-shard.mjs'),
    String(commands.indexOf(command)+1), String(commands.length)], {cwd,env:{...process.env,...env},encoding:'utf8',windowsHide:true});
  try {
    git('init','--quiet');
    await writeFile(join(cwd,'package.json'),JSON.stringify({scripts}));
    await mkdir(join(cwd,'apps/web/tests'),{recursive:true});
    await writeFile(join(cwd,command.slice(5)),
      "if (process.argv.includes('--check-render')) { console.log('render-fixture'); process.exit(7); }");
    await writeFile(join(cwd,'README.md'),'fixture');
    env.CARD_RENDER_BASE = commit();
    await writeFile(join(cwd,'unrelated.txt'),'no render change');
    commit();
    assert.equal(plan().check,false);
    const skipped = runShard();
    assert.equal(skipped.status,0,skipped.stderr);
    assert.doesNotMatch(skipped.stdout,/render-fixture/);
    await mkdir(views,{recursive:true});
    await writeFile(join(views,'VehicleProjectView.tsx'),'vehicle');
    await writeFile(join(views,'PropertyProjectView.tsx'),'property');
    const changed = commit();
    const runs = [1,2,3,4].flatMap(n => shardCommands(browserCommands(scripts),n,4))
      .filter(cmd => cardRenderPlan(cmd,env,cwd)?.check);
    assert.deepEqual(runs,[command]);
    const failed = runShard();
    assert.equal(failed.status,7,failed.stderr);
    assert.equal(failed.stdout.split('render-fixture').length-1,1);
    assert.equal(cardRenderPlan(command,{...env,GITHUB_EVENT_NAME:'push'},cwd),null);
    env.CARD_RENDER_BASE = changed;
    await rename(join(views,'PropertyProjectView.tsx'),join(cwd,'moved.txt'));
    commit();
    assert.equal(plan().reason,'card paths changed');
    for (const base of ['', 'a'.repeat(40)]) {
      env.CARD_RENDER_BASE = base;
      assert.deepEqual(plan(),{check:true,reason:'comparison unavailable; checking render'});
    }
  } finally { await rm(cwd,{recursive:true,force:true}); }
});
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
  assert.match(workflow, /build:\s+if: always\(\)\s+needs: \[compile, unit, browser, domain\]/);
  for (const name of ['COMPILE','UNIT','BROWSER','DOMAIN']) assert.ok(workflow.includes(`test "$${name}" = success`));
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
