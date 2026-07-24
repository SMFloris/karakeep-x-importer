#!/usr/bin/env node

import { setTimeout as delay } from "node:timers/promises";

import { parseOptions, runDaemon } from "./cli.js";
import { loadDotEnv } from "./env.js";
import { runImport } from "./importer.js";

await loadDotEnv();

try {
  const options = parseOptions(process.argv.slice(2));

  if (!options.daemon) {
    const result = await runImport();
    if (result.failed > 0) process.exitCode = 1;
  } else {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    console.log(`Daemon mode enabled; polling every ${options.every}.`);
    await runDaemon({
      poll: () => runImport(),
      every: options.every,
      everyMs: options.everyMs,
      wait: async (milliseconds) => {
        try {
          await delay(milliseconds, undefined, { signal: controller.signal });
          return true;
        } catch (error) {
          if (error.name === "AbortError") return false;
          throw error;
        }
      },
    });
    console.log("Daemon stopped.");
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
