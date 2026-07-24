# X bookmarks → Karakeep

A small Node.js command-line app that imports bookmarks from an X account into a
Karakeep instance.

## How it works

It uses the authenticated X user's private bookmarks, follows X's pagination,
and creates one Karakeep link bookmark for each new post. It stops when it
reaches a URL already in Karakeep. The original post date is used as the
Karakeep bookmark date.

The app has no npm dependencies. It exchanges the configured X refresh token
for a short-lived access token on every run and keeps that access token only in
memory. The latest refresh token is written to
`/tmp/karakeep-x-importer/refresh-token` by default so refresh-token rotation
survives process restarts.

## Requirements

- An [X developer account and app](https://console.x.com/)
- X API access that includes the bookmarks endpoint
- A Karakeep account on a self-hosted or hosted instance

## Setup

Copy the example configuration:

```sh
cp .env.example .env
```

Then edit `.env`:

```dotenv
X_REFRESH_TOKEN=your-oauth-refresh-token
X_CLIENT_ID=your-x-app-client-id
KARAKEEP_URL=https://keep.example.com
KARAKEEP_API_KEY=your-karakeep-api-key
```

`KARAKEEP_URL` is the address opened in your browser. Do not add `/api/v1`;
the app adds it automatically. `http://localhost:3000` is the default.

`X_REFRESH_TOKEN` initializes the token store on the first run. After a
successful refresh, the stored token takes precedence because X may return a
replacement refresh token. Set `X_TOKEN_FILE` to use a location other than the
default under `/tmp`.

## Getting an X refresh token

### Important: use a user refresh token

X bookmarks are private. The app therefore needs an **OAuth 2.0 user access
grant created with Authorization Code + PKCE and the `offline.access` scope**.
Only the resulting refresh token is configured; the app obtains its own access
token when it starts.

Do not use the app-only **Bearer Token** displayed on the app's Keys and Tokens
page. Although both token types are sent as `Authorization: Bearer ...`, the
app-only token does not represent your X account and cannot read its bookmarks.


### 1. Create and configure an X app

1. Sign in to the [X Developer Console](https://console.x.com/).
2. Create an app.
3. Open the new app -> authentication settings and click setup.
4. Choose Read, Native App and register a callback URL / website URL. For the URLs. Use `http://127.0.0.1/`
5. Save the settings, then save the **Client ID** and, if issued, the
   **Client Secret**.

X does not provide the required bookmark user token by simply clicking
"Generate" beside the app-only Bearer Token. You must complete the OAuth consent
flow for your X account.

Then, under OAuth 2.0 Keys section, click the `Generate` button next to the `Generate an access token and refresh token for your own account to make authenticated API requests, including DM access.`.

The token needs these scopes:

| Scope | Why it is needed |
| --- | --- |
| `bookmark.read` | Read the authenticated user's bookmarks |
| `tweet.read` | Read the bookmarked posts |
| `users.read` | Identify the current user and post authors |

Add `offline.access` to have X issue a refresh token. When
`X_REFRESH_TOKEN` and `X_CLIENT_ID` are configured, the app exchanges the
refresh token for an access token at the beginning of every run. It does not
read, require, persist, or expose an `X_ACCESS_TOKEN`.

Save the **REFRESH_TOKEN**. The generated access token is not needed.


## Getting a Karakeep API key

1. Sign in to your Karakeep instance.
2. Open **Settings**.
3. Select **API Keys**.
4. Create a new API key and give it a recognizable name, such as
   `X bookmark importer`.
5. Copy the generated key into `.env` as `KARAKEEP_API_KEY`.
6. Set `KARAKEEP_URL` to the root URL of that Karakeep instance.

For example:

```dotenv
KARAKEEP_URL=https://karakeep.example.com
KARAKEEP_API_KEY=ak2_example_generated_value
```

Karakeep expects this key as a Bearer token. See the official
[Karakeep API authentication documentation](https://docs.karakeep.app/api/karakeep-api/)
for more information.

## Run the importer

Pull the published image from GitHub Container Registry:

```sh
docker pull ghcr.io/smfloris/karakeep-x-importer:v0.3
```

Run the container and poll once per hour:

```sh
docker volume create karakeep-x-token

docker run --rm \
  --mount source=karakeep-x-token,target=/data \
  -e X_REFRESH_TOKEN="$X_REFRESH_TOKEN" \
  -e X_CLIENT_ID="$X_CLIENT_ID" \
  -e KARAKEEP_URL="$KARAKEEP_URL" \
  -e KARAKEEP_API_KEY="$KARAKEEP_API_KEY" \
  ghcr.io/smfloris/karakeep-x-importer:v0.3 \
  --daemon --every 1h
```

Daemon mode imports immediately and then repeats at the configured interval.
`--every` accepts durations such as `30s`, `15m`, or `1h`; a plain number is
interpreted as seconds. If `--every` is omitted, the interval defaults to `1h`.
The named `karakeep-x-token` volume retains `/data/refresh-token` when the
container is recreated. For a confidential Web App or Automated App, also pass
`-e X_CLIENT_SECRET="$X_CLIENT_SECRET"`; do not pass it for a Native App.

Values already exported in the shell take precedence over values in `.env`.
The persisted refresh token, when present, takes precedence over
`X_REFRESH_TOKEN`. The supported configuration is:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `X_REFRESH_TOKEN` | First run | — | Refresh token received with `offline.access`; initializes an empty token store |
| `X_CLIENT_ID` | Yes | — | OAuth 2.0 Client ID from the X app |
| `X_CLIENT_SECRET` | Confidential clients only | — | OAuth client secret; omit for public PKCE clients |
| `X_TOKEN_FILE` | No | `/tmp/karakeep-x-importer/refresh-token` | File used to persist the latest refresh token; the image sets this to `/data/refresh-token` |
| `KARAKEEP_API_KEY` | Yes | — | API key generated by Karakeep |
| `KARAKEEP_URL` | No | `http://localhost:3000` | Root URL of the Karakeep instance |

## Troubleshooting

### X returns 401 or 403

- Confirm `X_REFRESH_TOKEN` is an OAuth 2.0 **user refresh token**, not the
  app-only Bearer Token.
- Confirm the authorization request included `bookmark.read`, `tweet.read`, and
  `users.read`, plus `offline.access`.
- Confirm the X app/account has access to the bookmarks endpoint.

If refresh fails, confirm that `offline.access` was included when the token was
created and that `X_CLIENT_ID` belongs to the same X app. If the grant has been
revoked or the refresh token is no longer valid, generate a new refresh token
and replace the token store. For the local default, remove
`/tmp/karakeep-x-importer/refresh-token`; for Docker, remove the file from the
mounted volume or start with a new named volume. The next run will initialize
the store from `X_REFRESH_TOKEN`.

### Karakeep returns 401

Create a new key under Karakeep **Settings → API Keys**, copy the entire value,
and make sure it belongs to the instance configured by `KARAKEEP_URL`.

### Some imports fail

The app continues after an individual Karakeep error and prints each failed URL.
Correct the reported problem and rerun it. Because the importer stops at the
first existing URL, it will not revisit a failed item that is older than that
boundary.

## Tests

Run the test suite with:

```sh
npm test
```

The tests use mocked HTTP responses and never contact X or Karakeep.

## Credential safety

- `.env` is ignored by Git; do not remove it from `.gitignore`.
- The refresh-token file is created with owner-only (`0600`) permissions.
- Never commit or share API keys, client secrets, or refresh tokens.
- Revoke and replace a credential immediately if it is exposed.
- Use only the minimum X scopes listed above.

## License

This project is available under the [MIT License](LICENSE).
