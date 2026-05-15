# Finance Tracker

## Development

```bash
npm ci
npm run dev
```

## Installation

### TrueNAS Custom App

1. Build and publish an image using the repository `Dockerfile`.
2. In TrueNAS, go to **Apps** -> **Discover Apps** -> **Custom App**.
3. Set the image reference to your published image.
4. Set container port `3000` and expose it through your preferred TrueNAS networking method.
5. Add a persistent storage mount:
   - Host path or dataset: your persistent dataset path
   - Container path: `/data`
6. Set environment variables:
   - `NEXTAUTH_URL=https://your-public-domain.example`
   - `NEXTAUTH_SECRET=<strong-random-secret>`
   - `SERVER_SETTINGS_ENCRYPTION_KEY=<strong-random-secret-min-32-chars>`
   - `AUTH_TRUST_HOST=true`
   - `ALLOW_PUBLIC_SIGNUP=false` (recommended)
   - Optional: `DATABASE_URL=file:/data/app.db` (defaults automatically if omitted)
7. Deploy the app.
8. Verify health:

```bash
curl -fsS http://<truenas-app-host>:3000/api/health
```

If you publish behind a reverse proxy/TLS endpoint, set `NEXTAUTH_URL` to the final public HTTPS URL.

### Linux (native install)

Prerequisites:

- Node.js 22.x
- npm 10+ (or npm bundled with Node 22)
- OpenSSL

Install and run:

```bash
git clone <your-repo-url>
cd "finances tracker"
npm ci
```

Set environment variables (example):

```bash
export NEXTAUTH_URL="http://localhost:3000"
export NEXTAUTH_SECRET="$(openssl rand -base64 48)"
export SERVER_SETTINGS_ENCRYPTION_KEY="$(openssl rand -base64 48)"
export AUTH_TRUST_HOST="true"
export ALLOW_PUBLIC_SIGNUP="true"
# Optional: defaults to file:./dev.db in non-production if omitted
# export DATABASE_URL="file:./dev.db"
```

Run migrations and start:

```bash
npm run db:deploy
npm run dev
```

For a production-like local start:

```bash
npm run build
npm run start
```

## Environment Variables

Set these values in your deployment environment (TrueNAS custom app):

- `NEXTAUTH_URL=https://your-public-domain.example`
- `NEXTAUTH_SECRET=<strong-random-secret>`
- `SERVER_SETTINGS_ENCRYPTION_KEY=<strong-random-secret-min-32-chars>`
- `AUTH_TRUST_HOST=true`
- `ALLOW_PUBLIC_SIGNUP=false` (recommended for production)

Optional **Authentik SSO** (OIDC via environment variables — overrides admin UI when all three are set):

- `AUTHENTIK_ISSUER=https://authentik.example.com/application/o/<slug>/`
- `AUTHENTIK_CLIENT_ID=<client-id>`
- `AUTHENTIK_CLIENT_SECRET=<client-secret>`
- `AUTHENTIK_ENABLED=false` (optional; set to disable env-based Authentik while keeping other vars)

In Authentik, create an OAuth2/OIDC provider and application. Set the redirect URI to:

`{NEXTAUTH_URL}/api/auth/callback/authentik`

You can also configure Google and Authentik under **Settings → Server admin → OAuth** (stored encrypted in the database).

`DATABASE_URL` is optional. If omitted, defaults are:

- production: `file:/data/app.db`
- non-production: `file:./dev.db`

Generate secure values with:

```bash
openssl rand -base64 48
```

## Production Deployment (TrueNAS Custom App)

1. Build and publish image from the included `Dockerfile`.
2. Mount persistent storage to `/data` in the container.
3. Provide production env vars listed above.
4. Deploy container and verify health:

```bash
curl -fsS http://<host>:3000/api/health
```

The container startup command runs `prisma migrate deploy` (via `./node_modules/.bin/prisma`) before starting the app server, so migrations apply automatically on every start.

## Release Preflight Checklist

Run before pushing a production image:

```bash
npm run lint
npm run test
npm run build
npx prisma migrate status
```

Confirm:

- Required non-database env vars are present and non-placeholder values are used.
- `DATABASE_URL` points to persistent storage (`/data/app.db`).
- No local `.db` files are committed.

## Backup and Restore Runbook (SQLite)

### Daily backup

1. Stop writes (maintenance mode or brief restart window).
2. Copy `/data/app.db` to a timestamped file.
3. Compress and store an encrypted off-host copy.
4. Retain daily backups (minimum 7-14 days).

### Pre-migration backup

Always back up `/data/app.db` immediately before deploying migrations.

### Restore verification drill

At least once before launch:

1. Restore a backup into a fresh environment.
2. Start the app against restored DB.
3. Validate login, dashboard load, and transaction create/edit/delete flow.
