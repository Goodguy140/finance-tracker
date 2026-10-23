import { expect, test } from "@playwright/test";
import { CategoryKind } from "@prisma/client";
import { generateApiToken } from "../../src/lib/api-token";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { prisma } from "../../src/lib/prisma";
import { uniqueStamp } from "./helpers";

/** A user and a token with `scopes`, made directly: minting one in the UI needs a passkey. */
async function tokenFor(scopes: string[]) {
  const user = await prisma.user.create({
    data: { email: `e2e-api-${uniqueStamp()}@example.com`, displayName: "E2E API", countryCode: "CA", timezone: "America/Toronto" },
  });
  await ensureDefaultDataForUser(user);
  const { raw, hash, prefix } = generateApiToken();
  await prisma.personalAccessToken.create({
    data: { userId: user.id, name: "e2e", tokenHash: hash, tokenPrefix: prefix, scopes: scopes.join(",") },
  });
  return { user, headers: { authorization: `Bearer ${raw}` } };
}

test("a token logs an expense, lists it, and reads accounts and categories", async ({ request }) => {
  const { user, headers } = await tokenFor(["transactions:read", "transactions:write", "accounts:read"]);
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });

  const categories = await request.get("/api/v1/categories", { headers });
  expect(categories.status()).toBe(200);
  expect((await categories.json()).categories).toContainEqual({ id: category.id, name: category.name, kind: "expense" });
  const accounts = await request.get("/api/v1/accounts", { headers });
  expect((await accounts.json()).accounts.map((a: { id: string }) => a.id)).toContain(account.id);

  const created = await request.post("/api/v1/transactions", {
    headers,
    data: { type: "expense", amount: 4.75, title: "Coffee", date: "2026-10-20", category: category.name, account: account.name },
  });
  expect(created.status()).toBe(201);
  const { transaction } = await created.json();
  expect(transaction).toMatchObject({ type: "expense", amountCents: 475, title: "Coffee", categoryId: category.id, accountId: account.id });
  const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
  expect(stored).toMatchObject({ userId: user.id, amountCents: 475, type: "EXPENSE" });

  const listed = await request.get("/api/v1/transactions?from=2026-10-01&to=2026-10-31", { headers });
  expect(listed.status()).toBe(200);
  expect((await listed.json()).transactions.map((t: { id: string }) => t.id)).toEqual([transaction.id]);

  const bad = await request.post("/api/v1/transactions", { headers, data: { type: "expense" } });
  expect(bad.status()).toBe(400);
});

test("each endpoint needs its own scope, and no token gets nothing", async ({ request }) => {
  const { user, headers } = await tokenFor(["budgets:read"]);
  for (const path of ["/api/v1/transactions", "/api/v1/accounts", "/api/v1/categories"]) {
    expect((await request.get(path, { headers })).status(), path).toBe(403);
    expect((await request.get(path)).status(), path).toBe(401);
  }
  const post = await request.post("/api/v1/transactions", { headers, data: { type: "expense", amount: 1 } });
  expect(post.status()).toBe(403);
  expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
});
