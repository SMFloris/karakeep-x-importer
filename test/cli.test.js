import assert from "node:assert/strict";
import test from "node:test";

import { parseDuration, parseOptions, runDaemon } from "../src/cli.js";

test("parses polling durations", () => {
  assert.equal(parseDuration("1h"), 3_600_000);
  assert.equal(parseDuration("15m"), 900_000);
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("60"), 60_000);
  assert.throws(() => parseDuration("tomorrow"), /Invalid polling interval/);
  assert.throws(() => parseDuration("0s"), /greater than zero/);
});

test("parses daemon options with a one-hour default", () => {
  assert.deepEqual(parseOptions(["--daemon"]), {
    daemon: true,
    every: "1h",
    everyMs: 3_600_000,
  });
  assert.deepEqual(parseOptions(["--daemon", "--every", "5m"]), {
    daemon: true,
    every: "5m",
    everyMs: 300_000,
  });
  assert.throws(() => parseOptions(["--every", "5m"]), /--daemon/);
  assert.throws(() => parseOptions(["--unknown"]), /Unknown argument/);
});

test("daemon polls repeatedly and continues after a poll error", async () => {
  let polls = 0;
  let waits = 0;
  const errors = [];

  await runDaemon({
    poll: async () => {
      polls += 1;
      if (polls === 1) throw new Error("temporary outage");
      return { failed: 0 };
    },
    every: "1h",
    everyMs: 3_600_000,
    log: { log() {}, error(message) { errors.push(message); } },
    wait: async (milliseconds) => {
      assert.equal(milliseconds, 3_600_000);
      waits += 1;
      return waits < 2;
    },
  });

  assert.equal(polls, 2);
  assert.deepEqual(errors, ["Poll failed: temporary outage"]);
});
