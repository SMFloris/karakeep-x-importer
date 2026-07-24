import assert from "node:assert/strict";
import test from "node:test";

import { runImport } from "../src/importer.js";

function response(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function silentLog() {
  return { log() {}, error() {} };
}

function configuration(overrides = {}) {
  return {
    X_REFRESH_TOKEN: "refresh-token",
    X_CLIENT_ID: "client-id",
    KARAKEEP_API_KEY: "karakeep-token",
    ...overrides,
  };
}

function withTokenRefresh(fetchImpl, tokens = { access_token: "x-token" }) {
  return async (url, options = {}) => {
    if (new URL(url).pathname === "/2/oauth2/token") return response(tokens);
    return fetchImpl(url, options);
  };
}

test("imports paginated X bookmarks into Karakeep", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const parsed = new URL(url);

    if (parsed.pathname === "/2/users/me") {
      return response({ data: { id: "42", username: "reader" } });
    }
    if (
      parsed.pathname === "/2/users/42/bookmarks" &&
      !parsed.searchParams.has("pagination_token")
    ) {
      return response({
        data: [{ id: "100", author_id: "7", created_at: "2025-01-01T00:00:00.000Z" }],
        includes: { users: [{ id: "7", username: "author" }] },
        meta: { next_token: "next-page" },
      });
    }
    if (parsed.pathname === "/2/users/42/bookmarks") {
      assert.equal(parsed.searchParams.get("pagination_token"), "next-page");
      return response({
        data: [{ id: "101", author_id: "8", created_at: "2025-01-02T00:00:00.000Z" }],
        meta: {},
      });
    }
    if (parsed.pathname === "/api/v1/bookmarks") return response({ id: "saved" }, 201);
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await runImport({
    env: configuration({
      KARAKEEP_URL: "https://keep.example",
    }),
    fetchImpl: withTokenRefresh(fetchImpl),
    log: silentLog(),
  });

  assert.deepEqual(result, {
    found: 2,
    imported: 2,
    failed: 0,
    stoppedEarly: false,
  });
  const writes = requests.filter(({ options }) => options.method === "POST");
  assert.equal(writes.length, 2);
  assert.deepEqual(JSON.parse(writes[0].options.body), {
    type: "link",
    url: "https://x.com/author/status/100",
    createdAt: "2025-01-01T00:00:00.000Z",
    source: "import",
  });
  assert.equal(
    JSON.parse(writes[1].options.body).url,
    "https://x.com/i/web/status/101",
  );
});

test("reports individual Karakeep failures and continues", async () => {
  let postCount = 0;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/2/users/me") return response({ data: { id: "42" } });
    if (parsed.pathname === "/2/users/42/bookmarks") {
      return response({ data: [{ id: "100" }, { id: "101" }], meta: {} });
    }
    if (options.method === "POST") {
      postCount += 1;
      return postCount === 1
        ? response({ message: "server unhappy" }, 500)
        : response({ id: "saved" }, 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const env = configuration();
  const result = await runImport({
    env,
    fetchImpl: withTokenRefresh(fetchImpl),
    log: silentLog(),
  });

  assert.deepEqual(result, {
    found: 2,
    imported: 1,
    failed: 1,
    stoppedEarly: false,
  });
});

test("stops at the first bookmark Karakeep already has", async () => {
  let postCount = 0;
  const submittedUrls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/2/users/me") {
      return response({ data: { id: "42", username: "reader" } });
    }
    if (parsed.pathname === "/2/users/42/bookmarks") {
      return response({
        data: [{ id: "new" }, { id: "existing" }, { id: "must-not-import" }],
        meta: { next_token: "must-not-fetch" },
      });
    }
    if (parsed.pathname === "/api/v1/bookmarks" && options.method === "POST") {
      postCount += 1;
      submittedUrls.push(JSON.parse(options.body).url);
      return postCount === 1
        ? response({ id: "created" }, 201)
        : response({ id: "already-there" }, 200);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const env = configuration();
  const result = await runImport({
    env,
    fetchImpl: withTokenRefresh(fetchImpl),
    log: silentLog(),
  });

  assert.deepEqual(result, {
    found: 2,
    imported: 1,
    failed: 0,
    stoppedEarly: true,
  });
  assert.deepEqual(submittedUrls, [
    "https://x.com/i/web/status/new",
    "https://x.com/i/web/status/existing",
  ]);
});

test("uses a rotated refresh token in memory when an X request must retry", async () => {
  const xAuthorizationHeaders = [];
  const refreshTokens = [];
  let tokenRequests = 0;
  let userRequests = 0;

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);

    if (parsed.pathname === "/2/users/me") {
      userRequests += 1;
      xAuthorizationHeaders.push(options.headers.Authorization);
      if (userRequests === 1) return response({ detail: "expired" }, 401);
      return response({ data: { id: "42", username: "reader" } });
    }
    if (parsed.pathname === "/2/oauth2/token") {
      tokenRequests += 1;
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("grant_type"), "refresh_token");
      refreshTokens.push(options.body.get("refresh_token"));
      assert.equal(options.body.get("client_id"), "client-id");
      return response({
        access_token: `access-${tokenRequests}`,
        refresh_token: `refresh-${tokenRequests}`,
        expires_in: 7200,
      });
    }
    if (parsed.pathname === "/2/users/42/bookmarks") {
      assert.equal(options.headers.Authorization, "Bearer access-2");
      return response({ data: [], meta: {} });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const env = configuration();
  const result = await runImport({
    env,
    fetchImpl,
    log: silentLog(),
  });

  assert.equal(result.found, 0);
  assert.deepEqual(xAuthorizationHeaders, [
    "Bearer access-1",
    "Bearer access-2",
  ]);
  assert.deepEqual(refreshTokens, ["refresh-token", "refresh-1"]);
  assert.equal(env.X_REFRESH_TOKEN, "refresh-2");
});

test("uses client authentication when refreshing a confidential client", async () => {
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/2/oauth2/token") {
      assert.equal(
        options.headers.Authorization,
        `Basic ${Buffer.from("client:secret").toString("base64")}`,
      );
      assert.equal(options.body.has("client_id"), false);
      return response({ access_token: "new", refresh_token: "rotated" });
    }
    if (parsed.pathname === "/2/users/me") {
      assert.equal(options.headers.Authorization, "Bearer new");
      return response({ data: { id: "42" } });
    }
    if (parsed.pathname === "/2/users/42/bookmarks") return response({ meta: {} });
    throw new Error(`Unexpected request: ${url}`);
  };

  await runImport({
    env: configuration({
      X_CLIENT_SECRET: "secret",
      X_CLIENT_ID: "client",
    }),
    fetchImpl,
    log: silentLog(),
  });
});

test("requires both the refresh token and X client ID", async () => {
  await assert.rejects(
    runImport({
      env: { X_CLIENT_ID: "client", KARAKEEP_API_KEY: "karakeep" },
      log: silentLog(),
    }),
    /X_REFRESH_TOKEN/,
  );
  await assert.rejects(
    runImport({
      env: { X_REFRESH_TOKEN: "refresh", KARAKEEP_API_KEY: "karakeep" },
      log: silentLog(),
    }),
    /X_CLIENT_ID/,
  );
});
