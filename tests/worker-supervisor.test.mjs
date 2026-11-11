import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('Windows supervisor preserves active workers and rejects unsafe startup conditions', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'familyhub-supervisor-test-'));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const script = join(directory, 'verify.ps1');
  await writeFile(join(directory, 'pairing-key.txt'), 'synthetic-supervisor-key');
  await writeFile(script, `
$ErrorActionPreference='Stop'
$global:entry=${quote(resolve('apps/worker/dist/index.js'))}
$global:node=${quote(process.execPath)}
$global:scenario=''
$global:launches=0
function global:Get-NetTCPConnection {
  if($global:scenario -ne 'missing') { [pscustomobject]@{LocalAddress=$(if($global:scenario -eq 'public'){'0.0.0.0'}else{'127.0.0.1'});OwningProcess=$(if($global:scenario -eq 'foreign'){999}else{123})} }
}
function global:Get-CimInstance {
  if($global:scenario -ne 'missing') { [pscustomobject]@{ExecutablePath=$global:node;CommandLine=('"'+$global:entry+'"');ProcessId=123} }
  if($global:scenario -eq 'duplicate') { [pscustomobject]@{ExecutablePath=$global:node;CommandLine=('"'+$global:entry+'"');ProcessId=124} }
}
function global:Start-Process { $global:launches++ }
function global:Start-Sleep { throw 'SYNTHETIC_STOP' }
function global:Invoke-WebRequest { [pscustomobject]@{Content='{"status":"ok","version":"2.30.1"}';Headers=@{'X-Content-Type-Options'='nosniff'}} }
foreach($case in @('healthy','missing','public','foreign','duplicate')) {
  $global:scenario=$case; $global:launches=0; $message=''
  try { & ${quote(resolve('scripts/Run-WorkerSupervisor.ps1'))} -DataDirectory ${quote(directory)} -NodePath $global:node -Port 47130 }
  catch { $message=$_.Exception.Message }
  if($case -in @('healthy','missing')) {
    if($message -ne 'SYNTHETIC_STOP') { throw "Expected bounded simulation stop for $case" }
    $expected=$(if($case -eq 'missing'){1}else{0})
    if($global:launches -ne $expected) { throw "Incorrect launch count for $case" }
  } else {
    if($message -eq 'SYNTHETIC_STOP' -or !$message -or $global:launches -ne 0) { throw "Unsafe scenario did not fail closed: $case" }
  }
}
Write-Output 'Supervisor safety scenarios passed.'
`);
  try {
    const { stdout } = await promisify(execFile)(process.env.FAMILYHUB_TEST_POWERSHELL || 'powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], { timeout: 30000 });
    assert.match(stdout, /Supervisor safety scenarios passed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
