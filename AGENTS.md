<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working in this repo

Everything below sits outside the `next dev` block above, which is regenerated in place and
leaves surrounding content alone (`upsertAgentRulesBlock` in
`node_modules/next/dist/server/lib/generate-agent-files.js` splices between the markers).

## Where features live

`docs/features.md` maps every feature to its page, card or settings section and the files
behind it. Check it before building something new (several requested features already exist),
and update it in the same PR when you add, move or remove one.

## Database and migrations

**The migration history was broken and is now guarded.** `20260503220000` adds
`Transaction.preCreditCents`/`.creditCents`; `20260504002823` then rebuilt the table without
them and copied only the older columns, silently dropping both. It went unnoticed for months
because `scripts/repair-sqlite-schema.cjs` adds them back on every container start.
`src/lib/migrations-match-schema.test.ts` now replays the whole history into a shadow
database and fails if it does not reproduce `schema.prisma`. If that test fails, the
migration you just wrote is wrong — do not "fix" it by editing the test.

Because of that history, **`prisma migrate diff --from-migrations` cannot be trusted as a
baseline** for new migrations. Write them by hand, in the repo's existing style
(`prisma/migrations/YYYYMMDDHHMMSS_snake_case/migration.sql`), and apply with
`npm run db:deploy`. Never `prisma migrate dev` — see the divergent `_prisma_migrations`
history note below.

**Adding a column to an existing table means four files, not one.** The column, plus
`REQUIRED_SCHEMA_COLUMNS` in `src/lib/migration-health.ts`, plus `COLUMN_REPAIRS` in
`scripts/repair-sqlite-schema-lib.cjs`, plus `SCHEMA_REPAIR_VERSION` **in both of those
files** — they drifted apart once already and the admin health panel reported a stale version
for months. Creating a new *table* needs none of that; the repair script only adds columns,
and skips a repair whose table does not exist.

**There are two dev databases.** `prisma/dev.db` is the live one; the `dev.db` at the repo
root was an empty April leftover and is gone. Prisma resolves `file:./dev.db` relative to the
schema directory, not the repo root.

**`prisma/dev.db` has a divergent `_prisma_migrations` history.** It carries a row for
`20260515190000_add_audit_log`, a name that does not exist in `prisma/migrations/` — the repo
ships `20260515140000_add_audit_log` instead. That row is marked rolled back with
`applied_steps_count` 0, so it changed nothing and is inert. `npm run db:deploy` steps over it
and applies whatever is genuinely pending. `prisma migrate dev` does not: it reads the unknown
name as drift and offers to reset the database, discarding your local data to resolve a row
that never mattered. That is the reason for the rule above.

**A long-running `next dev` pins the Prisma client it booted with.** `prisma generate` — which
the `postinstall` hook also runs — rewrites `node_modules/.prisma/client`, but a server already
running keeps the old client in its require cache; Turbopack recompiles your code, not a
`node_modules` dependency. The symptom is a `PrismaClientValidationError` for a column that is
plainly present in `schema.prisma`, absent from the error's "Available options" list while its
schema neighbours are there. Restart the dev server. Check `npm run db:deploy` as well: if the
column is new, that same session likely never applied its migration either, and restarting
alone only trades the validation error for a `P2022`.

## Tests

**Wait on the last thing an operation writes, never an earlier one.** This has caused three
separate flakes here. Server actions write several rows in sequence, so polling for an early
row and then asserting a later one reads the gap between two writes. Examples: the admin
Plaid settings action upserts four rows *then* records an audit row (wait on the audit row);
a sync commits staged rows *then* matches them (wait on the match, not the row count).

**`ServerSetting` rows are global, not per-user.** Every spec shares them. `plaid.*` is set
through one shared helper (`tests/e2e/plaid-helpers.ts`), upsert-only — a spec that *deleted*
those rows to test an unconfigured path reproducibly broke two others. Assert
unconfigured behaviour in a unit test, not in the e2e suite.

**A passing test that asserts nothing is the failure mode to watch for here.** It has
happened three times: an import round-trip whose poll was satisfied by the pre-import row; a
sandbox contract check that passed because the data it needed had not been generated yet and
every real assertion sat behind an `if`; and a helper that was exported and tested but never
called by production code. When adding a test, check it fails when the thing it covers is
broken.

`npm run lint` must be clean; `.claude/**` is ignored because agent worktrees are full
checkouts of this repo nested inside it.

## Plaid integration

**Plaid bills per connected Item per month, working or not.** The cost is in how many
connections exist and how many are useless, not in call volume. Consequences that are easy
to undo by accident:

- Exchanging a public token creates a billable Item **whether or not it is stored**. Anything
  that declines a link must also call `/item/remove`, or it creates the orphan it was
  preventing (`discardRedundantItem`).
- The same institution cannot be linked twice — Plaid issues a fresh `item_id` each time
  Link completes, so a second connect does not collide on `itemId` and would silently double
  the monthly charge.
- Deleting a `PlaidItem` row does not end anything. `/item/remove` first, delete second, and
  refuse the whole operation if revocation fails (`revokePlaidItemsForUser`).
- Plaid data is kept only while there is a use for it. Unlinking or withdrawn consent deletes
  the item, its accounts and review queue, and strips Plaid ids from verifications (the badge
  keeps only the fact and the bank's name). Withdrawn and superseded staged rows are pruned
  after 30 days. The rest of the queue stays for the life of the connection: it is the
  idempotency key that stops a re-sync re-proposing declined rows.
- The background sweep skips banks nothing could come of: unmapped, lapsed consent, awaiting
  re-authentication, or in failure backoff.

**The stored sync cursor moves only when a walk completes** (the page with `has_more: false`).
After `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` Plaid requires restarting from the
cursor the walk began with, so a mid-walk cursor is never stored. Rows for unmapped accounts
are skipped while the cursor moves past them, which is why mapping an account clears the
cursor (`setPlaidAccountMapping`) and a walk that saw a mapping change mid-way stores none.

**Nullable columns in Prisma `where` clauses need explicit null handling.** `NOT: { col: { lt:
x } }` excludes rows where `col` is NULL, because the comparison yields NULL rather than
true. One such clause would have silently disabled the entire sweep. Write
`OR: [{ col: null }, { col: { gte: x } }]`.

**The sign convention is the single most important thing to get right.** A positive Plaid
`amount` means money *out*. A negative amount that is not `INCOME`/`TRANSFER_IN` is a refund
and is booked as a **negative expense** in the original category, not as income — booking it
as income would inflate income and leave the original spend uncorrected.

**Nothing synced is ever written to the log automatically.** Rows land in
`PlaidStagedTransaction` and wait for a person. The one exception adds nothing: a posted bank
row whose amount exactly equals an unverified entry the matcher paired it with, where no
other pairing is exact, is linked during the sync (`selectAutoLinks`) — the entry gains a
verified badge and, if it had none, a posted date; nothing else about it changes. That is what makes an unattended sweep safe,
and it is why a bank revising or withdrawing a committed transaction updates the staged copy
and raises a flag rather than editing the user's record. A revision whose amount still equals
the user's (a rename, a re-categorisation) only updates the staged copy — there is nothing to
ask (`keepChangedRevisions`).

**Webhooks only raise and clear prompts — except consent withdrawn at Plaid.**
`/api/plaid/webhook` sits outside the session gate, so the ES256 signature check
(`webhook-verify.ts`) is the whole of its security — never act on a body before it passes, and
hash the raw text, not a re-serialised object. `USER_PERMISSION_REVOKED` and
`USER_ACCOUNT_REVOKED` are the exception: the user has already said no, so what was synced
under that consent is deleted (`src/lib/plaid/purge.ts`) — for a whole item, only after
`/item/remove` succeeds. Never the user's committed transactions. The ITEM codes set
columns that `describePlaidItemAttention` reads; update mode (`completePlaidUpdateAction`) and
`LOGIN_REPAIRED` clear them. An update-mode public token is not exchanged — the access token is
unchanged. E2E specs sign deliveries with the fixture key in `fake-webhook.ts`.

`npm run verify:plaid` checks the hand-written client against the real Plaid sandbox (free,
fabricated data). The rest of the suite runs against a fake written from the published API,
so it proves the code agrees with that fake — not that the API behaves that way. Run it after
any Plaid-side change. Still uncovered by it: the pending → posted transition, which the
sandbox did not produce.
