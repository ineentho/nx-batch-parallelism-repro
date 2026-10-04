// Single-task implementation, used when the batch is off (`--batch=false`).
const SLEEP_MS = 5000;

module.exports = async function build(_options, context) {
  const id = `${context.projectName}:build`;
  console.log(`BATCH_TASK_START ${id} ${Date.now()}`);
  await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
  console.log(`BATCH_TASK_END ${id} ${Date.now()}`);
  return { success: true };
};
