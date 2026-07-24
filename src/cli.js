const DURATION_UNITS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

export function parseDuration(value) {
  const input = String(value).trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(input);
  if (!match) {
    throw new Error(
      `Invalid polling interval "${value}". Use a duration such as 30s, 15m, or 1h.`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const milliseconds = amount * DURATION_UNITS[unit];
  if (!Number.isFinite(milliseconds) || milliseconds < 1) {
    throw new Error("Polling interval must be greater than zero");
  }
  return Math.round(milliseconds);
}

export function parseOptions(argv) {
  let daemon = false;
  let every = "1h";

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--daemon") {
      daemon = true;
    } else if (argument === "--every") {
      index += 1;
      if (!argv[index]) throw new Error("--every requires a duration");
      every = argv[index];
    } else if (argument.startsWith("--every=")) {
      every = argument.slice("--every=".length);
      if (!every) throw new Error("--every requires a duration");
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!daemon && argv.some((argument) => argument.startsWith("--every"))) {
    throw new Error("--every can only be used with --daemon");
  }

  return { daemon, every, everyMs: parseDuration(every) };
}

export async function runDaemon({
  poll,
  every,
  everyMs,
  log = console,
  wait,
}) {
  while (true) {
    try {
      const result = await poll();
      if (result.failed > 0) {
        log.error(`Poll completed with ${result.failed} failed import(s).`);
      }
    } catch (error) {
      log.error(`Poll failed: ${error.message}`);
    }

    log.log(`Next poll in ${every}.`);
    if (!(await wait(everyMs))) return;
  }
}
