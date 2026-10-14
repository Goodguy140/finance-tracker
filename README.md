# Finance Tracker

Self-hosted personal finance app. Next.js, SQLite and Prisma, shipped as a single Docker image.

Project site: https://goodguy140.github.io/finance-tracker/ (source in [`site/`](site/)).

## Features

- **Expense and income log** with categories, month / year-to-date / lifetime views, and CSV import
- **Categories** you can add, rename, merge and delete, each with its own monthly budget
- **Budgets** per category, with optional rollover of what is left (or overspent) into the next month and email alerts as a month approaches its limit
- **Recurring rules** for bills and salary, posted by hand or automatically
- **Upcoming bills** forecast for the next 30, 60 or 90 days
- **Transfers** between accounts, kept out of income and spending
- **Tags** that cut across categories, added by hand or by transaction rules, with a dashboard filter
- **Money owed to you**: mark part of an expense as owed by someone, keep it out of your spending, and track it until paid back
- **Investments** with TFSA, RRSP and FHSA contribution room tracking
- **Savings goals** with a target and optional date, following a savings account's balance or an amount you record, with what each needs a month
- **Bank sync** through Plaid; synced transactions wait in a review queue and are never posted on their own; you choose which of your categories each Plaid category is suggested as
- **Multi-user** with roles, Google or Authentik SSO, passkeys, and an admin audit log
- **Backup and restore** of each user's data, plus a read-only API with personal access tokens

## Quick start

Requires Node.js 22.

```bash
npm ci
npm run db:deploy   # create or update prisma/dev.db
npm run dev         # http://localhost:3000
```

The first account to sign up becomes the server admin. Development needs no environment variables.

## Production

Build the image from the `Dockerfile`, expose port `3000`, and mount persistent storage at `/data`
(the database lives at `/data/app.db`). Migrations run automatically on every container start.
`GET /api/health` returns 200 once the app is up.

### Required environment

| Variable | Purpose |
|----------|---------|
| `NEXTAUTH_URL` | Public URL users visit, e.g. `https://finance.example.com`. Passkeys are bound to this hostname. |
| `NEXTAUTH_SECRET` | Session signing secret: `openssl rand -base64 48` |
| `SERVER_SETTINGS_ENCRYPTION_KEY` | At least 32 characters. Encrypts SSO and Plaid credentials stored in the database; changing it means re-entering them and relinking banks. |
| `AUTH_TRUST_HOST` | Set to `true` when running behind a reverse proxy. |

### Optional environment

Most of these can also be set under **Settings → Server admin**; a value set in the environment wins.

| Variable | Purpose |
|----------|---------|
| `INITIAL_ADMIN_EMAIL` | Only this email becomes admin on first signup. |
| `ALLOW_PUBLIC_SIGNUP` | `true` or `false`. Signup is closed by default in production. |
| `DISABLE_PASSWORD_LOGIN` | `false` re-enables password sign-in if SSO breaks. |
| `LOGIN_MAX_PER_IP` | Raise if many users share one IP (default 30 attempts per 15 minutes). |
| `AUTHENTIK_ISSUER`, `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`, `AUTHENTIK_ENABLED` | Authentik SSO. Redirect URI is `<NEXTAUTH_URL>/api/auth/callback/authentik`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Password reset and budget alert email. |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | Plaid credentials (both must be set); `PLAID_ENV` is `sandbox` (default) or `production`. |
| `PLAID_SYNC_SCHEDULER`, `PLAID_SYNC_INTERVAL_MINUTES` | Turn off the background bank sync, or change its interval (default 60, minimum 15). |
| `PLAID_WEBHOOK_URL` | Public `https` webhook URL. Defaults to `<NEXTAUTH_URL>/api/plaid/webhook`. |
| `RECURRING_AUTO_POST_SCHEDULER` | `false` turns off the hourly posting of automatic recurring rules. |
| `AUDIT_LOG_RETENTION_DAYS` | How long audit rows are kept (default 365). |

## Development

```bash
npm run lint
npm run typecheck
npm test            # unit tests
npm run test:e2e    # Playwright
```

Contributor notes on migrations, tests and the Plaid integration are in [AGENTS.md](AGENTS.md).
Operator policies live in [docs/](docs/): [access control](docs/access-control.md) and
[data retention](docs/data-retention.md).
