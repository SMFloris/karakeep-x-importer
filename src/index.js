#!/usr/bin/env node

import { loadDotEnv } from "./env.js";
import { runImport } from "./importer.js";

await loadDotEnv();

try {
  const result = await runImport();
  if (result.failed > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
