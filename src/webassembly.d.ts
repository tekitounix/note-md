// WebAssembly type declarations for Node.js environments.
// TypeScript's ES2022 lib does not include WebAssembly globals.
// Rather than adding "WebWorker" lib (which conflicts with Node.js Buffer/Blob),
// we declare just what we need.

declare namespace WebAssembly {
  class Module {
    constructor(bytes: BufferSource);
  }
  function compile(bytes: BufferSource): Promise<Module>;
}
