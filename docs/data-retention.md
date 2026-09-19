# Data retention and disposal policy

What this deployment stores, how long it keeps it, how it is destroyed, and how to answer a
request from the person the data is about. Like the access control policy it sits beside, it
describes what the application actually does — every retention period and disposal path below
is enforced in code, and the gaps are named as gaps rather than papered over.

This document is self-contained: it states the behaviour rather than pointing at the source,
so it can be read in full by someone who does not have access to the code.

> **This is not legal advice.** It is an engineering description written so that whoever
> operates the deployment can map it onto their own obligations. Which laws apply depends on
> who you host for and where they are — see [Which laws apply](#which-laws-apply). Have
> counsel review this before relying on it for a commercial or institutional deployment.

## Who is responsible

Finance Tracker is self-hosted. Anthropic, the project authors, and any upstream host are
not parties to the data — **the operator of the deployment is the controller** (GDPR) and
the *organization* accountable for it (PIPEDA). If you run this for anyone other than
yourself, the obligations in this document are yours, not the software's.

The software gives you the mechanisms. It does not give you a lawful basis, a privacy
notice, or a breach-response plan; those are yours to write.

## Which laws apply

The deployment's defaults are Canadian — `America/Toronto`, `CAD`, `countryCode` `CA`, and
the TFSA/RRSP/FHSA account types in the data model — so **PIPEDA** is the natural anchor, with
**Quebec's Law 25** where the operator is an enterprise in Quebec and **GDPR/UK GDPR** where
any user is in the EU or UK.

**The household exemption matters more than anything else here.** PIPEDA applies to personal
information collected in the course of *commercial activity*; GDPR Art. 2(2)(c) excludes
processing "in the course of a purely personal or household activity." A single person
tracking their own budget on their own NAS is almost certainly outside both. The exemption
stops applying when the deployment stops being a household one:

| Deployment | Realistically in scope? |
|------------|-------------------------|
| One person, or a household, on private hardware | No — personal/household activity |
| An employer hosting it for staff | Yes — PIPEDA (or provincial equivalent), Law 25, GDPR by user location |
| Offered to others as a product or service, paid or free | Yes, in full |
| `ALLOW_PUBLIC_SIGNUP` unset on an internet-reachable host | Assume yes — you have accepted unknown registrants |

Everything in a financial tracker is **sensitive**: transaction-level spending reveals
health, religion, political affiliation, and relationships. Law 25 and GDPR both raise the
bar for sensitive data, and PIPEDA's Principle 4.3.4 expects consent to scale with
sensitivity. Treat the whole dataset as sensitive rather than trying to grade it.

The governing principle across all three regimes is the same, and it is the one this
document implements — **PIPEDA Principle 4.5**: retain personal information only as long as
necessary for the purpose it was collected, then destroy, erase, or anonymize it.

## What is held

Every table below is user-scoped unless noted. "Sensitive" marks data whose disclosure would
directly harm the person.

| Data | Model(s) | Sensitive | Why it is held |
|------|----------|:---------:|----------------|
| Transactions, splits, accounts, categories, budgets, recurring rules, investment flows, portfolio snapshots | `Transaction`, `SplitTransactionPart`, `Account`, `Category`, `Budget`, `RecurringTransaction`, `InvestmentFlow`, `PortfolioSnapshot` | ● | The product. Financial history the user entered. |
| Third-party names and shares | `SubscriptionMember`, `SubscriptionShareStatus` | ● | Cost-splitting. **These are people who never signed up** — see [Third parties in the data](#third-parties-in-the-data). |
| Identity and profile | `User` (email, display name, timezone, country, role) | | Authentication and localization. |
| Password hash | `User.passwordHash` (bcrypt, cost 12) | ● | Credential. |
| Passkeys and recovery codes | `WebAuthnCredential`, `RecoveryCode` (bcrypt) | ● | Second factor. |
| SSO linkage and provider tokens | `AuthAccount` (`accessToken`, `refreshToken`, `idToken`) | ● | OIDC sign-in. Stored in plaintext. |
| API tokens | `PersonalAccessToken` (SHA-256 hash, prefix, scopes, `lastUsedAt`) | ● | Machine access. |
| Audit trail | `AuditLog` (actor, target, **IP address**, **user agent**, scrubbed metadata) | ● | Security and accountability. IP and UA are personal data in their own right. |
| Alert bookkeeping | `BudgetAlertNotification` (month, category, severity) | | Stops one alert per severity per month repeating. |
| Transient auth state | `MfaChallenge`, `PasswordResetToken`, `RateLimitEntry` | | Single ceremonies and abuse limits. |
| Bank connections | `PlaidItem` (`accessTokenEnc`, institution, sync cursor), `PlaidAccount` | ● | Plaid bank sync. The access token is a **live credential for the user's bank feed**, encrypted at rest with `SERVER_SETTINGS_ENCRYPTION_KEY` — unlike `AuthAccount`'s OAuth tokens, which are plaintext. |
| Un-reviewed bank transactions | `PlaidStagedTransaction` | ● | Transactions pulled from the bank that the user has not yet linked, added, or ignored. Full financial detail, not yet in the log. |
| Verification marks | `TransactionVerification` | | Records that a transaction was confirmed against a bank record; drives the Verified badge. |
| Server configuration | `ServerSetting` (encrypted at rest) | | OAuth **and Plaid** secrets, sign-in policy. |
| Unused | `Session` | | **Dead table.** Sessions are stateless JWTs; nothing reads or writes this model. |

## Retention schedule

| Data | Retained for | Disposal mechanism |
|------|--------------|--------------------|
| All financial records | **Until the user deletes them.** No automatic expiry. | Cascade on account deletion; bulk wipe via **Settings → Data → Reset financial data** |
| `User`, credentials, passkeys, recovery codes, SSO links, API tokens | Life of the account | `onDelete: Cascade` from `User` |
| `AuditLog` | `AUDIT_LOG_RETENTION_DAYS`, **default 365** | Probabilistic sweep, ~1 write in 200 |
| `MfaChallenge` | Minutes. Deleted the moment it is consumed | Delete on use; sweep ~1 ceremony in 20 |
| `RateLimitEntry` | Until `resetAt` | Cleared on success; sweep ~1 check in 50 |
| `PasswordResetToken` | Unusable after 30 min — **but the row is never deleted** | None. See [Known gaps](#known-gaps) |
| `BudgetAlertNotification` | Indefinite | Only on account deletion, reset, or restore |
| `PlaidItem`, `PlaidAccount` | Until the user unlinks the bank, or the account is deleted | `/item/remove` at Plaid **then** cascade — see [Bank connections](#bank-connections-plaid) |
| `PlaidStagedTransaction` | **Indefinite, by design** | Only on unlink or account deletion. See below. |
| `TransactionVerification` | Life of the transaction it marks | `onDelete: Cascade` from `Transaction` |
| `ServerSetting` | Life of the deployment | Overwritten on change |

`PlaidStagedTransaction` rows are kept even after the user has dealt with them, including ones they
chose to ignore. The `(userId, plaidTransactionId)` pair is the idempotency key for the whole sync:
it is what stops a re-sync re-proposing a transaction that was already added, or re-suggesting one the
user explicitly declined. Pruning them would trade a little storage for duplicate financial records,
which is the wrong trade. The alternative — a tombstone table holding only the ids — keeps the same
personal data under a different name, so it is not a genuine improvement.

### Why financial records have no expiry

Deliberate, and defensible under Principle 4.5: the purpose of a finance tracker is
longitudinal — a five-year spending trend needs five years of transactions, so "as long as
necessary" is "as long as the user wants the history." The user, not a timer, decides.

Auto-deleting would also cut against the user's own obligations. The CRA expects individuals
to keep records supporting a return for **six years** from the end of the tax year, and this
data backs TFSA, RRSP, and FHSA contribution room. Silently deleting a four-year-old
transaction could destroy a record its owner is required to hold.

**This makes deletion a user action, so it must be reachable and honest — which is the
substance of the rest of this document.**

## Disposal

### What account deletion actually destroys

Both paths — self-service (**Settings → Danger zone**, type `DELETE`) and admin
(**Settings → Server admin → Users**, type the account's email) — run
`prisma.user.delete`, and every user-owned relation cascades: transactions, splits,
accounts, categories, budgets, recurring rules, subscription members and their share
statuses, investment flows, portfolio snapshots, passkeys, recovery codes, SSO links, API
tokens, reset tokens, and alert bookkeeping. It cannot be undone.

**Two things deliberately survive**, and both need to be disclosed in your privacy notice:

1. **The audit trail.** `AuditLog.userId` is `SetNull`, so the rows persist without an actor
   link — but an admin deletion writes the deleted address into `metadata` on purpose, so
   the removal stays accountable. The audit row is written *before* the delete, and the
   target's address is stored as a plain string rather than a foreign key, so it survives the
   cascade intact. The email of a deleted user therefore remains readable for up to
   `AUDIT_LOG_RETENTION_DAYS`.
2. **`ServerSetting.updatedByUserId`** is `SetNull`; who configured what becomes anonymous.

Retaining (1) against an erasure request is defensible — GDPR Art. 17(3) carves erasure back
where processing is needed for the establishment or defence of legal claims (e), or to meet a
legal obligation (b) where one mandates log retention, and PIPEDA's security-safeguards
principle points the same way — but it is defensible **only because it is bounded**. An
unbounded audit log holding deleted users' emails forever would not be defensible. This is the
reason `AUDIT_LOG_RETENTION_DAYS=0` is rejected rather than treated as "keep nothing," and the
reason you should not raise the value without a stated reason.
### Erasing financial data without closing the account

**Settings → Data → Reset financial data**, confirmed by typing `RESET FINANCIAL DATA`,
drops every financial row in one transaction and re-seeds default categories. The account,
its credentials, and its audit history remain. Use this when someone wants their history
gone but their login kept.

### Deletion is not destruction on disk

Three layers outlive a `DELETE` statement. A policy that stops at the application layer is
incomplete, and this is where most self-hosted deployments actually leak.

**1. SQLite does not zero freed pages.** Deleted rows sit in the freelist until overwritten,
recoverable with a hex editor. After any bulk deletion — an account closure, a data reset —
reclaim the space:

```bash
sqlite3 /data/app.db "VACUUM;"
```

`VACUUM` rewrites the database into a fresh file and drops the freelist. Stop the container
first; it is not safe to run against a live writer. For a stronger guarantee, set
`PRAGMA secure_delete = ON` so freed pages are zeroed as they are released, at some write
cost.

**2. Snapshots and backups.** The TrueNAS dataset holding `/data` is almost certainly
snapshotted. A deleted account is still present in every snapshot taken before the deletion,
and it comes back in full if one is rolled back. **An erasure request is not complete until
the retention window on those snapshots has passed.** Decide that window deliberately, write
it down here, and tell users what it is:

> Snapshot retention for this deployment: `____` days. Erasure requests are fully effective
> after this period; rollbacks within it will restore erased data.

**3. Exported files.** Covered below — they are the most dangerous artifacts this system
produces.

### Disposing of exports and backups

`GET /api/backup/export/me` returns the user's full history as JSON, and it includes
`passwordHash` and the plaintext OAuth `accessToken`, `refreshToken`, and `idToken` from
the stored SSO linkage.

**A backup file is a credential, not just a copy of the data.** Anyone holding one can
attempt offline cracking of the password hash and may be able to replay live OAuth tokens.
The same is true of the audit CSV from **Settings → Server admin → Audit log**, which
carries IP addresses and user agents.

Accordingly:

- Never store an export on shared, synced, or cloud-backed storage.
- Encrypt any export kept longer than the moment it is used (`age`, `gpg`, or an encrypted
  volume).
- Delete exports as soon as their purpose is served, and `shred -u` them on spinning disks.
- Treat a leaked export as a credential compromise: rotate the user's password, revoke their
  API tokens, and unlink and re-link SSO.
- If you retain exports as operational backups, **their retention period is the real
  retention period for the whole dataset.** Record it:

> Backup retention for this deployment: `____` days.

### Decommissioning the deployment

When the deployment is retired, destroy the data rather than leaving a stale volume behind:

1. Export anything users are entitled to keep, and deliver it, before destroying anything.
2. Stop the container.
3. Destroy the `/data` volume — and every snapshot of it, which is the step people forget.
4. Delete backup copies and any exported JSON or CSV wherever they were filed.
5. Rotate `NEXTAUTH_SECRET`, `SERVER_SETTINGS_ENCRYPTION_KEY`, SMTP credentials, and every
   OAuth client secret, so a recovered volume is inert.
6. On physical media, `blkdiscard` an SSD or overwrite a disk; on a cloud volume, rely on the
   provider's destruction guarantee and record it.

## Answering a request from a user

PIPEDA gives **30 days** to respond to an access request; GDPR gives **one month**; Law 25
gives **30 days**. Before acting, verify the requester — an erasure request honoured for an
impersonator is itself a breach. Require a signed-in session with the passkey step-up, or
out-of-band confirmation you already trust.

| Right | How to satisfy it | Where |
|-------|-------------------|-------|
| **Access** (PIPEDA 4.9, GDPR 15) | The JSON export is the complete user-scoped record | **Settings → Data → Export**, or `GET /api/backup/export/me` |
| **Portability** (GDPR 20, Law 25) | Same export — structured, machine-readable JSON | as above |
| **Correction** (PIPEDA 4.9.5, GDPR 16) | The user edits their own records directly; profile via **Settings → Profile** | in-app |
| **Erasure** (GDPR 17, Law 25) | Delete the account, or reset financial data only | **Settings → Danger zone** / admin **Users** |
| **Withdraw consent** (PIPEDA 4.3.8) | Suspend, then delete if asked. Suspension halts processing without destroying data | admin **Users** |
| **Object / restrict** (GDPR 18, 21) | Suspension is the mechanism — all access and token use stops | admin **Users** |

Note two limits when you answer:

- The export **excludes `WebAuthnCredential`** by design — a passkey is bound to this RP
  origin, and restoring someone else's credential list would be a takeover vector. Passkey
  *metadata* (device name, creation date) is visible to the user in **Settings → Security**,
  which satisfies access; say so rather than claiming the export is exhaustive.
- The export **does not include the user's `AuditLog` rows.** They are personal data about
  the requester and are in scope for an access request. Pull them by hand from
  **Settings → Server admin → Audit log**, filtered to that actor, and include them.

### If there is a breach

PIPEDA requires reporting to the Privacy Commissioner and notifying affected individuals
where there is a **real risk of significant harm** — which financial data, credentials, or
an exported backup will almost always meet. GDPR requires notifying the supervisory
authority within **72 hours**. Law 25 requires prompt notification and a register of
incidents.

**PIPEDA also requires you to keep a record of every breach — including ones you decide not
to report — for 24 months.** That record is itself a retention obligation this application
does not implement; keep it outside the app, and do not let the 365-day audit window quietly
destroy your evidence. Export the relevant audit CSV and file it with the breach record.

## Third parties in the data

Two categories of personal data here belong to people who are not users and cannot exercise
rights through the app:

**Subscription members.** `SubscriptionMember.name` and their payment status are data about
a real person — a roommate, a partner — entered by someone else. They have no account and no
way to request access or deletion. If your deployment is in scope for PIPEDA or GDPR, you
are processing their data. In practice: keep names minimal (a first name, not a full legal
name), and honour a deletion request by editing or removing the member on the owning user's
behalf.

**Recipients of outbound mail.** Budget alerts sent through SMTP carry the category name and
spend amounts — financial data, in plaintext, to whatever mail provider `SMTP_HOST` points at,
retained under *their* policy and not this one. If that is a third-party service, it is a
processor: you need a data processing agreement, and a cross-border transfer assessment if it
is outside your jurisdiction. Self-hosting the relay, or leaving `budgetAlertEmailEnabled` off,
avoids this entirely.
Your OIDC providers (Google, Authentik) are likewise processors for the identity data they
return.

### Bank connections (Plaid)

When a user links a bank, **Plaid holds its own copy of that account's transaction history**,
under Plaid's retention policy and not this one, processed in the United States. Plaid is a
processor: if your deployment is in scope for PIPEDA or GDPR you need a data processing
agreement with them and a cross-border transfer assessment. Nothing in this repository can
delete data from Plaid's side — that is a request to Plaid.

**Unlinking is the only thing that actually ends access.** Deleting the `PlaidItem` row does
not: the item stays live at Plaid, keeps billing, and keeps its standing permission on the
bank account — and once the local row is gone, nothing records which item to revoke. Plaid's
`/item/remove` must therefore be called *first*, and the local row deleted only once it
succeeds.

Account deletion, admin deletion of a user, and **Settings → Data → Reset financial data**
each route through `revokePlaidItemsForUser` (`src/lib/plaid/unlink.ts`) before anything
cascades, and **refuse the whole operation if any connection cannot be revoked** — the user
is told to retry or unlink manually rather than having a connection silently stranded. The
refusal names the affected item ids so they can be removed from the Plaid dashboard by hand.

> **Status:** bank linking is not enabled in this release, so no `PlaidItem` can exist yet
> and the guard never fires in practice. It is wired up now precisely so that it is already
> in the right place when linking ships; until the Plaid client lands, the guard treats any
> item it finds as unrevocable and refuses, which is the safe direction to fail.

Bank connections are **never included in a backup export** — not the access token, not the
item, not the staged transactions — for the same reason passkeys are not: restoring one on
another deployment would hand that deployment a working connection to someone's bank. An
export does carry `TransactionVerification` rows, but stripped of every Plaid identifier, so a
restored transaction still shows as verified without implying a live link.

## Known gaps

Named honestly, because a policy that overstates what the code does is worse than none.

- **`PasswordResetToken` rows are never deleted.** They expire after 30 minutes and are
  marked `usedAt`, but nothing prunes them — the only deletions are on account deletion and
  backup restore. The table grows for the life of the deployment, holding a bcrypt hash, a
  `userId`, and timestamps per reset. Low sensitivity, but it is retention without a limit,
  which is exactly what Principle 4.5 prohibits. It wants the same probabilistic sweep the
  other transient tables already have.
- **`BudgetAlertNotification` rows are never pruned.** Harmless in volume, but they record
  which categories a user overspent and when, kept indefinitely with no stated purpose past
  the month they cover.
- **`AuthAccount` OAuth tokens are stored in plaintext**, unlike `ServerSetting`, which is
  encrypted. Database read access is provider-account access.
- **The `Session` model is dead schema.** It stores nothing, but it appears in the schema and
  invites reviewers to conclude sessions are server-side and revocable per-session. They are
  not; see the access control policy.
- **Self-service account deletion has no last-admin guard.** The admin path refuses to
  remove the final active admin, but the self-service path does not perform that check, so a
  sole admin can delete their own account and leave the deployment with no one able to
  administer it. An availability problem rather than a privacy one, but it is on the
  disposal path.
- **Retention sweeps are probabilistic and piggyback on traffic.** A deployment that goes
  quiet stops pruning: rows past their retention period survive until the next qualifying
  request. Audit rows on an idle server can outlive `AUDIT_LOG_RETENTION_DAYS` by a wide
  margin. On a deployment that must evidence its retention period, run a periodic sweep
  rather than relying on traffic.

## Annual retention review

Once a year, alongside the quarterly access review in the access control policy:

- [ ] Confirm `AUDIT_LOG_RETENTION_DAYS` still matches what your privacy notice claims.
- [ ] Check for audit rows past their retention period — a non-zero count means the
      probabilistic sweep is not keeping up:

      ```bash
      sqlite3 /data/app.db "SELECT COUNT(*) FROM AuditLog WHERE createdAt < (strftime('%s','now','-365 days') * 1000);"
      ```

      Prisma stores `DateTime` as an **integer of milliseconds since the epoch**, not as text,
      despite the column being declared `DATETIME`. Comparing against `datetime('now', ...)`
      compares an integer to a string, which in SQLite is always true — it returns every row
      and reads as a totally broken sweep. Multiply by 1000 and compare numerically.
- [ ] Check `PasswordResetToken` and `BudgetAlertNotification` row counts; clear them out
      manually until the gaps above are closed.
- [ ] List every export and backup copy in existence. Delete the ones past their purpose.
- [ ] Confirm the snapshot and backup retention windows written into this document are still
      the real ones.
- [ ] Confirm suspended accounts still need their data kept. Suspension is not disposal —
      an account suspended two years ago is retention without a purpose.
- [ ] Re-check the processor list: `SMTP_HOST`, OIDC providers, Plaid, and where backups are stored.
- [ ] Reconcile linked Plaid items against the Plaid dashboard: any item live there but absent here is
      an orphan still holding bank access, and should be removed.
- [ ] `VACUUM` the database if there has been bulk deletion since the last review.

## Related environment variables

| Variable | Effect on retention |
|----------|---------------------|
| `AUDIT_LOG_RETENTION_DAYS` | How long audit rows — including IPs and deleted users' emails — are kept. Default 365. `0` is rejected. |
| `DATABASE_URL` | Where the data lives. Defaults to `file:/data/app.db`; that volume's snapshot policy is part of your real retention period. |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_FROM` | Sends financial detail to a third party under their retention policy. Unset means no alert mail leaves the deployment. |
| `SERVER_SETTINGS_ENCRYPTION_KEY` | Encrypts `ServerSetting` **and every Plaid access token** at rest. Rotate on decommission — note that rotating it on a live deployment makes linked banks unreadable and they must be relinked. |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | Plaid API credentials. Override the encrypted `plaid.*` server settings when **both** are set. Do not determine retention, but govern whether bank data is pulled at all. |
| `PLAID_ENV` | `sandbox` (default) or `production`. Only consulted when the two above are set. Sandbox items hold no real bank data. |
| `NEXTAUTH_SECRET` | Signs sessions. Rotate on decommission so old volumes are inert. |
