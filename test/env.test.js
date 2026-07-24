import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadDotEnv } from "../src/env.js";

test("loads local configuration without overwriting exported variables", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "karakeep-x-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, ".env");
  await writeFile(
    path,
    [
      "X_REFRESH_TOKEN=file-refresh",
      "X_CLIENT_ID=file-client",
      "",
    ].join("\n"),
  );

  const previousRefreshToken = process.env.X_REFRESH_TOKEN;
  const previousClientId = process.env.X_CLIENT_ID;
  process.env.X_REFRESH_TOKEN = "exported-refresh";
  delete process.env.X_CLIENT_ID;
  try {
    await loadDotEnv(path);
    assert.equal(process.env.X_REFRESH_TOKEN, "exported-refresh");
    assert.equal(process.env.X_CLIENT_ID, "file-client");
  } finally {
    if (previousRefreshToken === undefined) delete process.env.X_REFRESH_TOKEN;
    else process.env.X_REFRESH_TOKEN = previousRefreshToken;
    if (previousClientId === undefined) delete process.env.X_CLIENT_ID;
    else process.env.X_CLIENT_ID = previousClientId;
  }
});
