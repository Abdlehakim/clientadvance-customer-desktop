# Customer Desktop Environment

`customer-desktop` is a Vite + React + Tauri app. It must talk only to the
customer `app-server` API through `VITE_API_BASE_URL`. The only backend base URL
documented here is the customer app-server URL.

## Production `.env`

Use this when building the desktop app for the deployed customer API:

```env
VITE_API_BASE_URL=http://102.204.205.77:4101/api
VITE_USE_LOCAL_AUTH=false
VITE_STORAGE_DRIVER=sqlite
```

`VITE_API_BASE_URL` is required in production builds. If it is missing, the app
throws a configuration error instead of falling back to localhost.

## Local Development `.env`

Use this when running a local `app-server` on port `4000`:

```env
VITE_API_BASE_URL=http://localhost:4000/api
VITE_USE_LOCAL_AUTH=false
VITE_STORAGE_DRIVER=sqlite
```

In development builds only, missing `VITE_API_BASE_URL` falls back to
`http://localhost:4000/api`.

## Variables Used

| Variable | Required for production | Production value | Local development value |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | Yes | `http://102.204.205.77:4101/api` | `http://localhost:4000/api` |
| `VITE_USE_LOCAL_AUTH` | Yes | `false` | `false` |
| `VITE_STORAGE_DRIVER` | Recommended for desktop | `sqlite` | `sqlite` |

## Client-Exposed Values

Vite bundles frontend env variables into the app when they use an exposed
prefix. This project exposes `VITE_` and `DEFAULT_`, so neither prefix may be
used for secrets.

Do not place passwords, JWT secrets, database URLs, private keys, owner admin
keys, or any other secret in `VITE_*` or `DEFAULT_*` variables.

## Rebuild Requirement

Vite substitutes `VITE_*` and `DEFAULT_*` values at build time. After changing
`.env`, `.env.production`, or shell-provided env values, rebuild the desktop app
so the packaged frontend contains the new API URL and storage settings.

## Generated Files To Keep Out Of Git

The project ignores generated dependency/build output:

```text
node_modules/
dist/
build/
.wrangler/
src-tauri/target/
src-tauri/gen/schemas/
*.log
```
