// No dependencies at all: nothing should stop this from starting immediately.
console.log('INDEPENDENT_START', Date.now());
await new Promise((resolve) => setTimeout(resolve, 5000));
console.log('INDEPENDENT_END', Date.now());
