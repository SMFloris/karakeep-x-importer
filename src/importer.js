const X_API_BASE = "https://api.x.com/2";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function apiError(service, response, body) {
  const detail =
    body?.detail ??
    body?.error_description ??
    body?.message ??
    body?.title ??
    body?.error ??
    (typeof body === "string" ? body : JSON.stringify(body));
  const error = new Error(`${service} request failed (${response.status}): ${detail}`);
  error.status = response.status;
  return error;
}

async function requestJsonResponse(fetchImpl, service, url, options = {}) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) throw apiError(service, response, body);
  return { body, status: response.status };
}

async function requestJson(fetchImpl, service, url, options = {}) {
  return (await requestJsonResponse(fetchImpl, service, url, options)).body;
}

function karakeepApiBase(serverUrl) {
  const normalized = serverUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith("/api/v1") ? normalized : `${normalized}/api/v1`;
}

async function requestXJson(fetchImpl, tokenManager, url) {
  const send = () =>
    requestJson(fetchImpl, "X", url, {
      headers: { Authorization: `Bearer ${tokenManager.accessToken}` },
    });

  try {
    return await send();
  } catch (error) {
    if (error.status !== 401 || !tokenManager.canRefresh) throw error;
    await tokenManager.refresh();
    return send();
  }
}

function createXTokenManager({
  env,
  fetchImpl,
  xApiBase,
  log,
}) {
  let accessToken;
  let refreshToken = required(env, "X_REFRESH_TOKEN");
  const clientId = required(env, "X_CLIENT_ID");
  const clientSecret = env.X_CLIENT_SECRET?.trim();

  return {
    get accessToken() {
      return accessToken;
    },
    get canRefresh() {
      return true;
    },
    async refresh() {
      log.log("Requesting an X access token...");
      const body = new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      };

      if (clientSecret) {
        headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
      } else {
        body.set("client_id", clientId);
      }

      const tokens = await requestJson(
        fetchImpl,
        "X token refresh",
        `${xApiBase}/oauth2/token`,
        { method: "POST", headers, body },
      );
      if (!tokens?.access_token) {
        throw new Error("X token refresh did not return an access token");
      }

      accessToken = tokens.access_token;
      refreshToken = tokens.refresh_token ?? refreshToken;
      log.log("X access token received.");
    },
  };
}

async function getXUser(fetchImpl, tokenManager, xApiBase) {
  const url = new URL(`${xApiBase}/users/me`);
  url.searchParams.set("user.fields", "username");
  const body = await requestXJson(fetchImpl, tokenManager, url);
  if (!body?.data?.id) throw new Error("X did not return an authenticated user");
  return body.data;
}

async function* getXBookmarks(fetchImpl, tokenManager, userId, xApiBase) {
  let paginationToken;

  do {
    const url = new URL(`${xApiBase}/users/${encodeURIComponent(userId)}/bookmarks`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("tweet.fields", "author_id,created_at");
    url.searchParams.set("user.fields", "username");
    if (paginationToken) url.searchParams.set("pagination_token", paginationToken);

    const body = await requestXJson(fetchImpl, tokenManager, url);
    const usernames = new Map(
      (body?.includes?.users ?? []).map((user) => [user.id, user.username]),
    );

    for (const post of body?.data ?? []) {
      yield { ...post, username: usernames.get(post.author_id) };
    }
    paginationToken = body?.meta?.next_token;
  } while (paginationToken);
}

function postUrl(post) {
  return post.username
    ? `https://x.com/${post.username}/status/${post.id}`
    : `https://x.com/i/web/status/${post.id}`;
}

async function createKarakeepBookmark(fetchImpl, apiBase, apiKey, post) {
  return requestJsonResponse(fetchImpl, "Karakeep", `${apiBase}/bookmarks`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "link",
      url: postUrl(post),
      createdAt: post.created_at,
      source: "import",
    }),
  });
}

export async function runImport({
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = console,
} = {}) {
  const apiKey = required(env, "KARAKEEP_API_KEY");
  const serverUrl = env.KARAKEEP_URL?.trim() || "http://localhost:3000";
  const xApiBase = env.X_API_BASE?.trim().replace(/\/+$/, "") || X_API_BASE;
  const apiBase = karakeepApiBase(serverUrl);
  const tokenManager = createXTokenManager({
    env,
    fetchImpl,
    xApiBase,
    log,
  });
  await tokenManager.refresh();

  const user = await getXUser(fetchImpl, tokenManager, xApiBase);
  log.log(`Connected to X as @${user.username ?? user.id}`);

  let found = 0;
  let imported = 0;
  let failed = 0;
  let stoppedEarly = false;

  for await (const post of getXBookmarks(fetchImpl, tokenManager, user.id, xApiBase)) {
    found += 1;
    const url = postUrl(post);

    try {
      const response = await createKarakeepBookmark(fetchImpl, apiBase, apiKey, post);
      if (response.status === 200) {
        stoppedEarly = true;
        log.log(`[${found}] Already in Karakeep; stopping at ${url}`);
        break;
      }
      imported += 1;
      log.log(`[${found}] Imported ${url}`);
    } catch (error) {
      failed += 1;
      log.error(`[${found}] Failed ${url}: ${error.message}`);
    }
  }

  const reason = stoppedEarly ? " Stopped at the first existing bookmark." : "";
  log.log(`Done: ${imported} imported, ${failed} failed.${reason}`);

  return { found, imported, failed, stoppedEarly };
}
