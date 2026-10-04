// Runs the workspace and reports what the orchestrator actually did: did the
// independent task start while the batch was running, and did the dependent task
// wait for the whole batch or only for its own task?
//
// Usage: node scripts/repro.mjs [--expect overlap|blocked|early]
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const expect = process.argv[2] === '--expect' ? process.argv[3] : undefined;

// Run the workspace's own nx directly: one process less, and its output stays
// on the pipes this script reads.
const child = spawn(
  process.execPath,
  [
    join(root, 'node_modules', 'nx', 'dist', 'bin', 'nx.js'),
    'run-many',
    '-t',
    'build',
    '--skip-nx-cache',
    '--parallel=2',
    '--output-style=static',
  ],
  { cwd: root, env: { ...process.env, NX_VERBOSE_LOGGING: 'true' } }
);

// Task output can arrive on either stream, so both are scanned.
const events = {};
const seen = new Set();
const tails = { out: '', err: '' };
const consume = (stream, chunk) => {
  (stream === 'out' ? process.stdout : process.stderr).write(chunk);
  tails[stream] += chunk;
  const lines = tails[stream].split('\n');
  tails[stream] = lines.pop();
  for (const rawLine of lines) {
    // nx colorizes task output; the escapes would otherwise land in the key.
    const line = rawLine.replace(/\u001b\[[0-9;]*m/g, '');
    const m = line.match(
      /(BATCH_RUN_START|BATCH_RUN_END|BATCH_TASK_START|BATCH_TASK_END|INDEPENDENT_START|INDEPENDENT_END|DEPENDENT_START|DEPENDENT_END)([^\d]*?)(\d{13})/
    );
    if (!m) continue;
    const [, name, rest, ms] = m;
    const key = rest.trim() ? `${name} ${rest.trim()}` : name;
    if (seen.has(key)) continue;
    seen.add(key);
    events[key] = Number(ms);
  }
};
child.stdout.on('data', (chunk) => consume('out', chunk));
child.stderr.on('data', (chunk) => consume('err', chunk));

child.on('close', (code) => {
  const need = (key) => {
    if (events[key] === undefined) {
      console.error(
        `\nMissing measurement for "${key}" — did the run fail? Measured: ${JSON.stringify(
          events,
          null,
          2
        )}`
      );
      process.exit(2);
    }
    return events[key];
  };

  const batchStart = need('BATCH_RUN_START');
  const batchEnd = need('BATCH_RUN_END');
  const independentStart = need('INDEPENDENT_START');
  const independentEnd = need('INDEPENDENT_END');
  const dependentStart = need('DEPENDENT_START');
  const batchAEnd = need('BATCH_TASK_END batch-a:build');

  const rel = (ms) => `${ms - batchStart >= 0 ? '+' : ''}${ms - batchStart} ms`;
  const overlap = independentStart < batchEnd;
  const earlyDependent = dependentStart < batchEnd;

  console.log('\n=== timeline (relative to the batch starting) ===');
  console.log(`  batch                ${rel(batchStart)} → ${rel(batchEnd)}`);
  console.log(`  :batch-a:build ends  ${rel(batchAEnd)}`);
  console.log(
    `  independent starts   ${rel(independentStart)} (runs until ${rel(
      independentEnd
    )})`
  );
  console.log(`  dependent starts     ${rel(dependentStart)}`);

  console.log('\n=== verdicts ===');
  console.log(
    overlap
      ? '  independent overlapped the batch:        YES — discrete work ran while the batch was in flight'
      : `  independent overlapped the batch:        NO — it waited ${
          independentStart - batchEnd
        } ms for the batch to finish`
  );
  console.log(
    earlyDependent
      ? `  dependent started before the batch end:  YES — ${
          batchEnd - dependentStart
        } ms early (its own task had reported)`
      : `  dependent started before the batch end:  NO — it waited ${
          dependentStart - batchEnd
        } ms for the whole batch`
  );

  if (expect === 'overlap' && !overlap) process.exit(1);
  if (expect === 'blocked' && overlap) process.exit(1);
  if (expect === 'early' && !earlyDependent) process.exit(1);
  process.exit(code ?? 0);
});
