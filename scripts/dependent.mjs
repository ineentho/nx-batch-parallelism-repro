// Depends on batch-a, a task inside the batch.
console.log('DEPENDENT_START', Date.now());
await new Promise((resolve) => setTimeout(resolve, 1000));
console.log('DEPENDENT_END', Date.now());
