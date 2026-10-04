# Nx: a batch executor blocks the parallel pool

A batch executor (`batchImplementation` + `preferBatch: true`) makes Nx's task
orchestrator dispatch nothing else while it runs, even when `--parallel` has
spare capacity. This workspace reproduces that in ~15 seconds, with no Gradle,
Maven or Java involved.

```bash
npm install
npm run repro
```

## The workspace

| project | target | what it does |
| --- | --- | --- |
| `batch-a` | `batch-executor:build` | sleeps 5 s, reported by the batch |
| `batch-b` | `batch-executor:build` | sleeps 5 s, depends on `batch-a` |
| `independent` | `nx:run-commands` | **no dependencies at all**, sleeps 5 s |
| `dependent` | `nx:run-commands` | depends on `batch-a` (a task inside the batch), sleeps 1 s |

`batch-executor` is a local plugin. Its batch implementation is an async
generator that reports each task as it finishes — the same shape as
`@nx/gradle`, `@nx/maven` and `@nx/oxlint:lint`, so a fix can complete a task
before the whole batch ends. `scripts/repro.mjs` runs
`nx run-many -t build --skip-nx-cache --parallel=2`, reads the timestamps the
tasks print, and reports what the orchestrator did.

## Baseline: nx 23.2.1

```text
=== timeline (relative to the batch starting) ===
  batch                +0 ms → +10005 ms
  :batch-a:build ends  +5002 ms
  independent starts   +10068 ms (runs until +15072 ms)
  dependent starts     +10069 ms

=== verdicts ===
  independent overlapped the batch:        NO — it waited 63 ms for the batch to finish
  dependent started before the batch end:  NO — it waited 64 ms for the whole batch
```

`independent` has no dependencies, and `--parallel=2` leaves a free slot the
whole time — it still cannot start until the batch process exits. This is a
regression from 22.6.0, where the orchestrator ran one loop per parallel slot
and whichever loop picked up the batch awaited it while the others kept
dispatching: the batch occupied one slot, not the whole pool.

## With the fix

Two shapes of fix were verified against this workspace by building the branch,
`npm pack`ing it, and installing the tarball over `nx`:

**A batch holds one slot of the budget** (the coordinator stops awaiting it):

```text
  batch                +0 ms → +10005 ms
  :batch-a:build ends  +5002 ms
  independent starts   -72 ms (runs until +4932 ms)
  dependent starts     +10064 ms

  independent overlapped the batch:        YES — discrete work ran while the batch was in flight
  dependent started before the batch end:  NO — it waited 59 ms for the whole batch
```

**…and a batch task completes as its executor reports it** (per-task
completion, which also needs `"batchParallelismCost": 1` in the executor
registration — the released Nx ignores that field, the fix honours it):

```text
  batch                +0 ms → +10005 ms
  :batch-a:build ends  +5002 ms
  independent starts   -72 ms (runs until +4931 ms)
  dependent starts     +5054 ms

  independent overlapped the batch:        YES — discrete work ran while the batch was in flight
  dependent started before the batch end:  YES — 4951 ms early (its own task had reported)
```

## Verifying a build of your own

```bash
# in the nx repo
pnpm nx run nx:build
npm pack ./packages/nx --pack-destination /tmp/nx-pack

# here
npm i /tmp/nx-pack/nx-0.0.1.tgz --no-save
npm run repro                       # or: node scripts/repro.mjs --expect overlap
```

`scripts/repro.mjs` takes `--expect overlap|blocked|early` and exits non-zero
when the run disagrees, which is handy in a loop.

## Notes

- The same effect was measured on a real Gradle workspace (`@nx/gradle`,
  `:lib:build`/`:tsgen:build`/`:app:build` batched): an independent node
  project started 42 ms *after* the batch on 23.2.1, and overlapped the whole
  batch once a batch holds one slot.
- The plugin declares `"batchParallelismCost": 1` in `executors.json`. Released
  Nx ignores unknown fields there; the opt-in fix reads it. Without it, the fix
  falls back to the batch holding the whole budget.
- Background: [discussion #36308 — Allow batch executors to share the parallel
  pool with discrete tasks](https://github.com/nrwl/nx/discussions/36308), and
  the 22.7.0 coordinator refactor (#35172) that introduced the regression.
