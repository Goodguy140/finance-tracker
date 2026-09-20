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
| `AUDIT_LOG_RETENTION_DAYS` | Optional. Audit rows older than this are pruned (default `365`) |
| `RECURRING_AUTO_POST_SCHEDULER` | Optional. Set `false` to disable the hourly in-process sweep that posts recurring rules in "automatic" mode |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | Optional. Plaid API credentials. Both must be set to override what is stored in the admin UI |
| `PLAID_ENV` | Optional. `sandbox` (default) or `production`. Only consulted when the two vars above are set |
| `PLAID_SYNC_SCHEDULER` | Optional. Set `false` to disable the background sweep that pulls new bank transactions |
| `PLAID_SYNC_INTERVAL_MINUTES` | Optional. How often that sweep runs (default `60`, minimum `15`) |

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
<summary>Plaid bank sync (env overrides admin UI)</summary>

Once configured, users connect a bank under **Settings → Accounts**. Connecting or disconnecting
requires a passkey assertion from the last few minutes, the same bar as minting an API token.

Each Plaid account must be mapped to one of the user's accounts before anything syncs, and a
mapping is refused when the currencies differ — amounts are stored as plain cents against the
account's own currency and there is no conversion layer, so mixing them would silently corrupt
every total.

Disconnecting calls Plaid's `/item/remove` **before** deleting anything locally, and refuses the
whole operation if that fails. Deleting the local rows alone would leave the connection live at
Plaid, still billing and still holding access to the bank account.

**Plaid bills per connected bank per month**, so the integration is built to avoid paying for
connections that cannot earn their keep. The same bank cannot be connected twice (a second attempt
is refused *and* revoked at Plaid, since exchanging a token creates a billable item whether or not
it is stored). Banks that need re-authentication, whose consent has lapsed, or that feed no account
are flagged in the panel with a reminder that they are still being charged for. Disconnecting calls
`/item/remove`, which is what actually stops the billing.

The history window is chosen once, when you connect, and later syncs only pick up new
transactions. There is deliberately **no "fetch more history" button**: Plaid's
`days_requested` is set when the item is created, and whether raising it in update mode
actually backfills has not been confirmed against a live account. A button that silently
did nothing would be worse than its absence — to widen the window, disconnect the bank and
connect it again, choosing the longer period.

Connected banks are also swept in the background, hourly by default, so the review queue is
already waiting when you next open the dashboard. The sweep skips anything a call could not help:
unmapped banks, lapsed consent, banks awaiting re-authentication, and banks in failure backoff —
a repeatedly failing connection is retried on a doubling delay up to once a day rather than
every hour. Nothing the sweep fetches is posted anywhere —
synced transactions sit in the queue until you review them — so it cannot change your books while
you are not looking. `PLAID_SYNC_INTERVAL_MINUTES` changes the cadence (minimum 15; below that it
is rate-limit pressure rather than a refresh), and `PLAID_SYNC_SCHEDULER=false` turns it off so
**Sync now** is the only trigger. Banks waiting on re-authentication are skipped until you sign in
again, rather than being retried every hour.

Configure under **Settings → Server admin → Plaid** (encrypted in the database with
`SERVER_SETTINGS_ENCRYPTION_KEY`). `PLAID_CLIENT_ID` and `PLAID_SECRET` in the environment take
precedence when **both** are set, in which case `PLAID_ENV` selects the host; a half-set pair is
ignored and the stored values are used instead.

`sandbox` returns fake data and never touches a real bank. `production` requires Plaid approval and
is billed per linked item.

Rotating `SERVER_SETTINGS_ENCRYPTION_KEY` makes stored credentials unreadable — the admin page says
so rather than erroring, but every linked bank has to be relinked.

The end-to-end tests run against a deterministic in-memory Plaid (`PLAID_FAKE_CLIENT=1`,
permitted only when the environment resolves to `sandbox`), so no test run can reach the
real API. That also means **the integration has never been exercised against Plaid itself**:
the request shapes, the sign convention, `days_requested` and the
`personal_finance_category` values the category map keys on are all written from the
published API rather than verified against it. Connect one sandbox account before trusting
this with a real bank.

</details>

<details>
<summary>SMTP (password reset & budget alert email)</summary>

Requires `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (optional `SMTP_PORT`, default `587`). Enable budget email alerts under **Settings → Budgets** when configured: after any change to the current month's spending, each category that has reached 80% of its limit (and again when it goes over) is emailed once per month.

</details>

<details>
<summary>Signup admin guard</summary>

- `INITIAL_ADMIN_EMAIL` — when set, only this email becomes `SERVER_ADMIN` on the first signup; others get `USER`.
- When unset, the first signup is `SERVER_ADMIN` (self-host default).

</details>

<details>
<summary>Single sign-on only</summary>

Turn password sign-in off under **Settings → Server admin → Sign-in methods**, leaving SSO and passkeys. Refused unless an OAuth provider is enabled and your own account has one linked. `DISABLE_PASSWORD_LOGIN=false` in the environment overrides the stored setting, which is how you get back in if SSO breaks.

</details>

</details>

<details>
<summary><strong>Access control and account management</strong></summary>

Roles, MFA policy, API token rotation, the de-provisioning runbook, and a quarterly access-review checklist: **[docs/access-control.md](docs/access-control.md)**.

Admins manage accounts at **Settings → Server admin → Users** (change role, suspend, sign out, delete) and review activity at **Settings → Server admin → Audit log** (filter by action, actor, and date; export CSV). Audit rows are kept for `AUDIT_LOG_RETENTION_DAYS` days, default 365.

</details>

<details>
<summary><strong>Data retention and disposal</strong></summary>

What is stored, how long it is kept, how it is destroyed, and how to answer an access, portability, or erasure request: **[docs/data-retention.md](docs/data-retention.md)**.

Financial records have **no automatic expiry** — they are kept until the user deletes them. Users export their full history from **Settings → Advanced → Backup and restore**, wipe it with **Reset financial data**, or close the account entirely under **Settings → Advanced → Delete account**.

Two operator notes worth reading before relying on any of that: a backup export contains the password hash and live OAuth tokens, so treat the file as a credential; and deleting rows does not erase them from disk — run `VACUUM` after bulk deletion, and remember that dataset snapshots still hold whatever you deleted.

**[docs/data-retention-external.md](docs/data-retention-external.md)** is the shareable version of the same policy — for users, customers, or a third-party security review. It carries no table names, environment variables, commands, or internal findings. Fill in the bracketed placeholders (organization, contact, effective date, backup retention window) before sending it anywhere.

</details>

<details>
<summary><strong>API access (personal access tokens)</strong></summary>

External apps (e.g. a personal dashboard) can read your data with a scoped token.

1. **Settings → Advanced → API tokens → Create token.** The raw token is shown **once** — copy it immediately; only a SHA-256 hash is stored. Revoke anytime.
2. Call the versioned API with a bearer token:

   ```bash
   curl -H "Authorization: Bearer <token>" \
     "https://finance.example.com/api/v1/budgets?month=2026-06"
   ```

   ```jsonc
   // 200 OK
   {
     "periodMonth": "2026-06",
     "currency": "CAD",
     "budgets": [
       { "categoryId": "…", "categoryName": "Groceries",
         "limitCents": 40000, "spentCents": 31200, "percentUsed": 78 }
     ],
     "totalLimitCents": 74000,
     "totalSpentCents": 52100
   }
   ```

| Endpoint | Scope | Notes |
|----------|-------|-------|
| `GET /api/v1/budgets?month=YYYY-MM` | `budgets:read` | `month` defaults to the current month. Rate limited to 60 req/min per token. |

Responses: `401` (missing/invalid/expired/revoked token), `403` (missing scope), `400` (bad `month`), `429` (rate limited). Tokens are not browser-CORS enabled — call from a server.

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

**Per-user JSON** — **Settings → Advanced**: export via `/api/backup/export/me` (sanitized: no password hash, OAuth tokens, or reset tokens). Import replaces financial data for the same email only; role, password, passkeys, and linked SSO identities are never restored from the file (relink SSO from Settings → Security).

**Full database** — stop traffic, copy `/data/app.db`, store encrypted off-host. Restore by replacing the file and restarting the container.

Always back up `app.db` before deploying migrations.

</details>

## Recurring transactions

Each rule is either **posted by hand** (the default: the dashboard shows it as due and you click *Post transaction*) or **posted automatically**. Automatic rules are posted when you open the dashboard and by an hourly sweep inside the server process, so an account nobody opens still gets its rent and salary entries on time. Set the mode when creating or editing a rule.

## Passkeys (phishing-resistant MFA)

Users can add passkeys (Touch ID, Windows Hello, Android, security keys) under **Settings → Profile → Security**. Once an account has one:

- every sign-in — password or SSO — must be confirmed with a passkey on the `/mfa` wall;
- passkeys also work as a passwordless first factor ("Sign in with a passkey" on the login page);
- linking anything external (Google/Authentik sign-in, personal API tokens) requires a passkey assertion from the last 5 minutes;
- SSO identities are never auto-linked by email any more — link them from Settings after a passkey check;
- an account with no password (SSO-only) can add its first passkey only within 5 minutes of signing in, so a stolen session cookie cannot turn MFA on by itself.

Eight single-use recovery codes are issued with the first passkey. If an account loses every passkey *and* its codes, an operator can reset it from a shell:

```bash
node scripts/reset-mfa.cjs user@example.com
```

Password logins are limited to 10 per email and 30 per client IP every 15 minutes; set `LOGIN_MAX_PER_IP` higher if your users share one address (office NAT, VPN egress).

`NEXTAUTH_URL` must be the hostname users actually visit: the passkey relying-party ID is derived from it (IP addresses are not accepted by browsers; `localhost` works for development).
