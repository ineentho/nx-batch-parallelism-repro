// Batch implementation: one process for every task of this executor in the run,
// reporting each task as it finishes (an async generator, like @nx/gradle and
// @nx/maven). Each task sleeps 5s, so the batch lasts 5s per task.
const SLEEP_MS = 5000;

module.exports = async function* batchBuild(taskGraph) {
  console.log(`BATCH_RUN_START ${Date.now()}`);

  // A real batch executor runs the tasks in dependency order; ordering by the
  // number of dependencies is enough for this two-task graph.
  const tasks = Object.values(taskGraph.tasks).sort(
    (a, b) =>
      (taskGraph.dependencies[a.id] ?? []).length -
      (taskGraph.dependencies[b.id] ?? []).length
  );

  for (const task of tasks) {
    const lines = [`BATCH_TASK_START ${task.id} ${Date.now()}`];
    console.log(lines[0]);
    await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
    lines.push(`BATCH_TASK_END ${task.id} ${Date.now()}`);
    console.log(lines[1]);
    yield {
      task: task.id,
      result: {
        success: true,
        status: 'success',
        terminalOutput: lines.join('\n') + '\n',
      },
    };
  }

  console.log(`BATCH_RUN_END ${Date.now()}`);
};
