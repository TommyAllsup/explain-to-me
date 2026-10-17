#!/usr/bin/env node
// Run without a global package manager and preserve the caller's working directory.
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error("Node.js 24 or newer is required. Install Node.js 24 LTS, then rerun this command.");
  process.exitCode = 1;
} else {
  try {
    const { tsImport } = await import("tsx/esm/api");
    await tsImport("../apps/cli/src/index.ts", import.meta.url);
  } catch (error) {
    console.error(`Could not start Explain-to-Me: ${error.message}\nOn Windows, run node scripts/setup.mjs first.`);
    process.exitCode = 1;
  }
}
