import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { FinanceState } from './finance-model.js';
import { contributionProgress, type ContributionPlan } from './contribution-progress.js';
/** Append-only PRIVATE projection. Caller supplies existing private data directory.
 * No ledger writes, cursor advancement, scheduling, network or account actions.
 */
export class ContributionReportStore {
  constructor(private readonly directory: string) {}
  async save(state: FinanceState, plan: ContributionPlan, asOf: string) {
    const report = contributionProgress(state, plan, asOf);
    const text = JSON.stringify({ planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'), report });
    const id = createHash('sha256').update(text).digest('hex');
    const path = join(this.directory, id + '.json');
    await mkdir(this.directory, {recursive: true});
    const temporary = join(this.directory, '.' + randomUUID() + '.tmp');
    await writeFile(temporary, text, {flag: 'wx', mode: 0o600});
    let replayed = false;
    try {
      // Publish complete bytes atomically without replacing any prior immutable file.
      try { await link(temporary, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; replayed = true; }
      if (await readFile(path, 'utf8') !== text) throw new Error('Private contribution report readback mismatch.');
      return {id, report, replayed};
    } finally { await unlink(temporary); }
  }
}