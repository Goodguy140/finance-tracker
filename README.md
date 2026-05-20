# Finance Tracker

Self-hosted personal finance app (expenses, income, budgets, recurring transactions, investments). Next.js + SQLite + Docker.

## Quick start (development)

```bash
npm ci
npm run dev
```

## Required environment (production)

| Variable | Purpose |
|----------|---------|
| `NEXTAUTH_URL` | Public app URL (e.g. `https://finance.example.com`) |
| `NEXTAUTH_SECRET` | Session signing secret (`openssl rand -base64 48`) |
| `SERVER_SETTINGS_ENCRYPTION_KEY` | Encrypts OAuth admin settings in DB (min 32 chars) |
| `AUTH_TRUST_HOST` | Set `true` behind reverse proxies |
| `ALLOW_PUBLIC_SIGNUP` | `false` recommended on public deployments |

`DATABASE_URL` defaults to `file:/data/app.db` (production) or `file:./dev.db` (development).

<details>
<summary><strong>Deploy on TrueNAS</strong></summary>

1. Build/publish the image from the repo `Dockerfile`.
2. **Apps → Discover Apps → Custom App** — set image and container port `3000`.
3. Mount persistent storage: host path → container `/data`.
4. Set the required env vars above (use your public HTTPS URL for `NEXTAUTH_URL`).
5. Deploy and verify: `curl -fsS http://<host>:3000/api/health`

The container runs `prisma migrate deploy` before `node server.js` on each start.

</details>

<details>
<summary><strong>Install on Linux</strong></summary>

Prerequisites: Node.js 22.x, npm, OpenSSL.

```bash
git clone <your-repo-url>
cd "finances tracker"
npm ci
export NEXTAUTH_URL="http://localhost:3000"
export NEXTAUTH_SECRET="$(openssl rand -base64 48)"
export SERVER_SETTINGS_ENCRYPTION_KEY="$(openssl rand -base64 48)"
export AUTH_TRUST_HOST="true"
npm run db:deploy
npm run dev   # or: npm run build && npm run start
```

</details>

<details>
<summary><strong>Optional configuration</strong></summary>

<details>
<summary>Authentik SSO (env overrides admin UI)</summary>

- `AUTHENTIK_ISSUER`, `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`
- `AUTHENTIK_ENABLED=false` to disable while keeping other vars
- Redirect URI: `{NEXTAUTH_URL}/api/auth/callback/authentik`

</details>

<details>
<summary>Google / Authentik via admin UI</summary>

Configure under **Settings → Server admin → OAuth** (encrypted in the database). Env-based Authentik vars take precedence when all three are set.

</details>

<details>
<summary>SMTP (password reset & budget alert email)</summary>

Requires `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (optional `SMTP_PORT`, default `587`). Enable budget email alerts under **Settings → Budgets** when configured.

</details>

<details>
<summary>Signup admin guard</summary>

- `INITIAL_ADMIN_EMAIL` — when set, only this email becomes `SERVER_ADMIN` on the first signup; others get `USER`.
- When unset, the first signup is `SERVER_ADMIN` (self-host default).

</details>

</details>

<details>
<summary><strong>Release checklist</strong></summary>

```bash
npm run lint && npm test && npm run build
npx prisma migrate status
```

Confirm production env vars are set, `DATABASE_URL` uses persistent `/data`, and no `.db` files are committed.

</details>

<details>
<summary><strong>Backup and restore</strong></summary>

**Per-user JSON** — **Settings → Advanced**: export via `/api/backup/export/me` (sanitized: no password hash, OAuth tokens, or reset tokens). Import replaces data for the same email only; role and password are never restored from the file.

**Full database** — stop traffic, copy `/data/app.db`, store encrypted off-host. Restore by replacing the file and restarting the container.

Always back up `app.db` before deploying migrations.

</details>
