// Minimal ambient declaration to allow use of `process` in files compiled
// under the app tsconfig. Prefer installing `@types/node` and adding
// `node` to tsconfig types for a permanent solution.
declare const process: any;
