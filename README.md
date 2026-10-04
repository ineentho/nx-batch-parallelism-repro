# Nx: a batch executor blocks the parallel pool

A batch executor (`batchImplementation` + `preferBatch: true`) makes Nx's task
orchestrator dispatch nothing else while it runs, even when `--parallel` has
spare capacity. This workspace reproduces that in ~15 seconds, with no Gradle,
Maven or Java involved.

```bash
npm install
npm run repro     # nx run-many -t build --skip-nx-cache --parallel=2 --output-style=static
```

## The workspace

| project | target | what it does |
| --- | --- | --- |
| `batch-a` | `batch-executor:build` | sleeps 5 s, reported by the batch |
| `batch-b` | `batch-executor:build` | sleeps 5 s, depends on `batch-a` |
| `independent` | `nx:run-commands` | **no dependencies at all**, sleeps 5 s |
| `dependent` | `nx:run-commands` | depends on `batch-a` (a task inside the batch), sleeps 1 s |

`batch-executor` is a local plugin whose batch implementation is an async
generator that reports each task as it finishes — the same shape as
`@nx/gradle`, `@nx/maven` and `@nx/oxlint:lint`, so a fix can complete a task
before the whole batch ends. Every task prints epoch milliseconds as it starts
and ends, and the batch prints its own window, so the output is the
measurement.

## Baseline: nx 23.2.1

```text
BATCH_RUN_START 1791133044336
BATCH_TASK_START batch-a:build 1791133044336
BATCH_TASK_END batch-a:build 1791133049337
BATCH_TASK_START batch-b:build 1791133049337
BATCH_TASK_END batch-b:build 1791133054339
BATCH_RUN_END 1791133054339
...
DEPENDENT_START 1791133054390
DEPENDENT_END 1791133055394
INDEPENDENT_START 1791133054390
INDEPENDENT_END 1791133059394
```

The batch runs 1791133044336 → 1791133054339. `independent` has no
dependencies and `--parallel=2` leaves a free slot the whole time, yet it
starts at 1791133054390 — **51 ms after the batch exited**, in the same
millisecond as `dependent`, which genuinely had to wait for `batch-a`.

This is a regression from 22.6.0, where the orchestrator ran one loop per
parallel slot and whichever loop picked up the batch awaited it while the
others kept dispatching: the batch occupied one slot, not the whole pool.

## With the fix

Two shapes of fix were verified here by building the branch, `npm pack`ing it
and installing the tarball over `nx`. Both print `INDEPENDENT_START` **before**
`BATCH_RUN_END`, i.e. while the batch is still running.

**A batch holds one slot of the budget** (the coordinator stops awaiting it):

```text
BATCH_RUN_START 1791130924749
BATCH_TASK_END batch-a:build 1791130929751
BATCH_TASK_END batch-b:build 1791130934754
BATCH_RUN_END 1791130934754
INDEPENDENT_START 1791130924681   <- 68 ms before the batch even started
DEPENDENT_START 1791130934816     <- still waits for the whole batch
```

**…and a batch task completes as its executor reports it** (per-task
completion, which also needs `"batchParallelismCost": 1` in the executor
registration — released Nx ignores that field, the fix honours it):

```text
BATCH_RUN_START 1791131027362
BATCH_TASK_END batch-a:build 1791131032363
INDEPENDENT_START 1791131027290   <- overlaps the batch
DEPENDENT_START 1791131032416     <- 4,951 ms before BATCH_RUN_END 1791131037365
```

## Verifying a build of your own

```bash
# in the nx repo
pnpm nx run nx:build
npm pack ./packages/nx --pack-destination /tmp/nx-pack

# here
npm i /tmp/nx-pack/nx-0.0.1.tgz --no-save
npm run repro
```

## Notes

- The same effect was measured on a real Gradle workspace (`@nx/gradle`,
  `:lib:build`/`:tsgen:build`/`:app:build` batched): an independent node
  project started 42 ms *after* the batch on 23.2.1, and overlapped the whole
  batch once a batch holds one slot.
- The plugin declares `"batchParallelismCost": 1` in `executors.json`. Released
  Nx ignores unknown fields there; the opt-in fix reads it. Without it, the fix
  falls back to the batch holding the whole budget.
- `--output-style=static` is what makes every task's output visible; nx prints
  each batch task's block twice (once streamed, once as its own block).
- Background: [discussion #36308 — Allow batch executors to share the parallel
  pool with discrete tasks](https://github.com/nrwl/nx/discussions/36308), and
  the 22.7.0 coordinator refactor (#35172) that introduced the regression.
