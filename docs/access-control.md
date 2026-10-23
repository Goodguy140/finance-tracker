# Access control policy

How access to this deployment is granted, proven, reviewed, and removed. It describes what
the application actually enforces — every control below is in code, not aspiration — so it
can be handed to a security questionnaire as-is.

Operational setup lives in the [README](../README.md); this document covers policy.

## Roles

There are exactly two, on `User.role`:

| Role | May do |
|------|--------|
| `USER` | See and change only their own financial data. Every query is scoped by `userId`. Manages their own passkeys, API tokens, and linked SSO providers. |
| `SERVER_ADMIN` | Everything a `USER` can, plus: manage all accounts (role, suspend, sign out, delete), configure OAuth and sign-in methods, read and export the audit log, export a full database backup, and see server health. |

There is no per-resource sharing and no third role. An admin's elevated rights are
server-administration rights; they do **not** grant access to another user's transactions.

**How `SERVER_ADMIN` is granted.** The first account created on a fresh deployment becomes
`SERVER_ADMIN` automatically. Set `INITIAL_ADMIN_EMAIL` before first launch to pin that to a
specific address: that address becomes `SERVER_ADMIN` when it signs up, as long as the
deployment has no admin yet, even if other accounts were created before it. Every other
signup becomes `USER`. Afterwards, only an existing admin can promote someone, from
**Settings → Server admin → Users**.

Public signup is closed by default in production and open in development. An admin can open
it under **Settings → Server admin → Authentication**; `ALLOW_PUBLIC_SIGNUP` overrides that
switch either way. While it is open, anyone who can load the page can create an account.

## Authentication

Three ways in, all of which may be active at once:

- **Password** — bcrypt, cost 12. Rate limited to 10 attempts per address and 30 per client
  IP per 15 minutes (`LOGIN_MAX_PER_IP` raises the second for shared-NAT deployments). The
  client IP is the `X-Forwarded-For` entry added by the last of `TRUSTED_PROXY_HOPS` reverse
  proxies (default 1), so it cannot be chosen by the client. The per-IP limit is only as good
  as that setting: if the app can be reached without going through the proxy, a client can
  send any address it likes, and the per-address limit is what still holds.
- **Passkey (WebAuthn)** — user verification required. Works as a passwordless first factor.
- **SSO** — Google and/or Authentik via OIDC. An SSO identity is never auto-linked to an
  existing account by matching email address; linking requires a signed intent started from
  Settings by someone already signed in.

### Multi-factor

**Passkeys are the second factor.** Once an account has enrolled at least one, *every*
subsequent sign-in — password or SSO — stops at the `/mfa` wall until a passkey is asserted.
There is no opt-out per session.

Enrolment is per-user and self-service, under **Settings → Security**. Recovery codes are
issued at enrolment, shown once, and stored only as hashes; each is single-use.

**Step-up.** Linking anything external — an SSO provider, a new personal access token —
requires a passkey assertion from the last five minutes, not merely a valid session. This is
what stops a stolen session cookie from being turned into permanent access.

**Break-glass.** A user who has lost every passkey and recovery code is recovered by an
operator with shell access to the deployment:

```bash
node scripts/reset-mfa.cjs user@example.com
```

This strips that account's passkeys and recovery codes and signs it out everywhere. It
requires shell access deliberately — there is no in-app path, because an in-app path would be
a way around the second factor.

### Single sign-on only

Password sign-in can be turned off entirely at **Settings → Server admin → Sign-in methods**,
leaving SSO and passkeys. The credentials provider is then not registered at all, and signup
and password reset refuse.

Enabling it is refused unless an OAuth provider is enabled **and** the acting admin has
already linked their own account to one. If SSO later breaks and no admin can sign in, set
`DISABLE_PASSWORD_LOGIN=false` in the environment and restart: the environment overrides the
stored setting, so recovery never requires editing the database.

## Non-human access

External integrations authenticate with personal access tokens (`Authorization: Bearer ft_…`).

- Created per-user under **Settings → Advanced → API tokens**, and only after a passkey step-up.
- 256 bits of entropy; only a SHA-256 hash is stored. The raw value is shown exactly once.
- **Scoped** — chosen when the token is made, and a token carries no rights beyond them:
  `budgets:read` (`GET /api/v1/budgets`), `transactions:read` (`GET /api/v1/transactions`),
  `transactions:write` (`POST /api/v1/transactions`, expenses and income only) and
  `accounts:read` (`GET /api/v1/accounts`, `GET /api/v1/categories`). Writes are audit-logged
  per entry (`api_transaction_created`).
- **Expiring** — 30, 90, or 365 days, or never. Default 90.
- Revocable at any time; revocation takes effect on the next request.
- Rate limited to 60 requests per minute per token, per endpoint.
- Not CORS-enabled, so they cannot be used from a browser.

**Rotation.** Rotate any token older than a year, and immediately on suspicion. Create the
replacement, move the integration over, then revoke the old one — `lastUsedAt` in the token
list confirms nothing is still using it.

Tokens of a suspended user are rejected, so suspension covers machine access too.

## De-provisioning

When someone leaves, from **Settings → Server admin → Users**:

1. **Suspend** the account. This is the whole step for most cases — it ends every live
   session at their next request, blocks password, passkey, and SSO sign-in, and disables
   their API tokens, while keeping their financial history intact.
2. **Sign out** is implied by suspension, but is available separately when you want to end
   sessions without removing access (a suspected stolen laptop, say).
3. **Revoke their API tokens** if the account will be restored later and the integrations
   should not come back with it.
4. **Delete** only when the data itself should go. This cascades to every transaction,
   account, budget, and passkey and cannot be undone. It requires typing the account's email.

The audit log keeps a record of the deletion with the acting admin and the deleted address,
so a removed account is still accounted for afterwards.

Two guard rails are enforced and cannot be overridden from the UI: no admin may demote,
suspend, or delete **their own** account, and the server may never be left without at least
one admin who can actually sign in. A suspended admin does not count toward that minimum.

## Audit log

Recorded for every authentication and every privileged or destructive action: sign-in
success and failure (with the reason), sign-out, signup, password change and reset,
passkey enrolment and removal, MFA verification and failure, SSO link and unlink, role
changes, suspension, forced sign-out, account deletion, token creation and revocation,
backup export, and audit export itself. Each row carries the actor, target, client IP, user
agent, and scrubbed metadata — values under keys matching password, secret, token, hash, or
cookie are dropped before the row is written.

Reviewed at **Settings → Server admin → Audit log**, filterable by action, actor, and date
range, and exportable as CSV.

**Retention** is `AUDIT_LOG_RETENTION_DAYS`, default 365. Rows older than that are pruned
automatically. A value of `0` is rejected rather than meaning "keep nothing".

### Quarterly access review

Once a quarter, an admin should:

- [ ] Open **Settings → Server admin → Users**. Confirm every listed account still needs
      access, and that the `SERVER_ADMIN` count is as small as the deployment allows.
- [ ] Check the sign-in column. Any account with no passkey is single-factor — chase it.
- [ ] Review active API tokens. Revoke any whose `lastUsedAt` is stale or absent.
- [ ] Filter the audit log to `user_login_failed` for the quarter. Look for repeated failures
      against one address, or `unknown_email` bursts from one IP.
- [ ] Filter to `admin_user_role_changed`, `admin_user_disabled`, and `admin_user_deleted`.
      Confirm every entry was intended and was performed by a known admin.
- [ ] Export the quarter to CSV and store it with the other compliance evidence.

## Implementation notes

Three behaviours that surprise reviewers:

- **Role changes take up to five minutes to reach an open session.** The role is re-read from
  the database at most once every five minutes per token. Suspension and forced sign-out are
  *immediate* — they bump a revocation counter every guard checks on every request.
- **Sessions are stateless JWTs**, so there is no server-side session table to enumerate.
  Revocation works by rejecting tokens that carry an older counter, which is why "sign out
  everywhere" is offered rather than "end this one session".
- **A suspended or deleted account's cookies are actively cleared**, not merely refused,
  because a refused-but-retained cookie would loop between the login page and the dashboard.

## Related environment variables

| Variable | Effect on access |
|----------|------------------|
| `INITIAL_ADMIN_EMAIL` | Pins the first `SERVER_ADMIN` to one address. |
| `ALLOW_PUBLIC_SIGNUP` | `true` or `false` overrides the admin switch for public signup (closed by default in production). |
| `DISABLE_PASSWORD_LOGIN` | Forces SSO-only on, or `false` forces password login back on, overriding the stored setting. |
| `AUDIT_LOG_RETENTION_DAYS` | How long audit rows are kept. Default 365. |
| `LOGIN_MAX_PER_IP` | Per-IP login budget per 15 minutes. Default 30. |
| `TRUSTED_PROXY_HOPS` | How many reverse proxies append to `X-Forwarded-For` in front of the app. Default 1. Decides which address per-IP limits and the audit log use. |
