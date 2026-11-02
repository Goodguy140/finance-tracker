import { createHash, randomBytes } from "crypto";
import { expect, test } from "@playwright/test";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { prisma } from "../../src/lib/prisma";
import { hashTestPassword, TEST_PASSWORD, uniqueStamp } from "./helpers";

/**
 * The phone app's sign-in, played by the browser and the request fixture: the sign-in sheet
 * opens /app/authorize signed out, signs in, allows the phone, and the app trades the code for
 * a device token, uses it, and loses it when the phone is signed out under Settings → Security.
 */
test("a phone signs in through the website, uses the API, and is signed out from Settings", async ({ page, request }) => {
  const email = `e2e-app-${uniqueStamp()}@example.com`;
  const user = await prisma.user.create({
    data: { email, displayName: "E2E App", passwordHash: await hashTestPassword(), countryCode: "CA", timezone: "America/Toronto" },
  });
  await ensureDefaultDataForUser(user);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({ code_challenge: challenge, code_challenge_method: "S256", state: "e2e-state", device: "E2E iPhone" });

  // Signed out, so the proxy sends the sheet to /login, which must bring it back.
  await page.goto(`/app/authorize?${query}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to the app" })).toBeVisible();
  await expect(page.getByText("E2E iPhone")).toBeVisible();

  // Just signed in, so "confirm it's you" is already satisfied. The browser cannot open the
  // app's own address; the page's fallback link carries the same URL.
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByText("Done. Returning you to the app…")).toBeVisible();
  const href = await page.getByRole("link", { name: "open the app" }).getAttribute("href");
  const handedBack = new URL(href ?? "");
  expect(`${handedBack.protocol}//${handedBack.host}`).toBe("financetracker://signed-in");
  expect(handedBack.searchParams.get("state")).toBe("e2e-state");
  const code = handedBack.searchParams.get("code") ?? "";

  const form = { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: "financetracker://signed-in" };
  const exchanged = await request.post("/api/v1/app/token", { form });
  expect(exchanged.status()).toBe(200);
  const { access_token: token } = await exchanged.json();
  expect((await request.post("/api/v1/app/token", { form })).status()).toBe(400);

  const headers = { authorization: `Bearer ${token}` };
  const me = await request.get("/api/v1/me", { headers });
  expect(me.status()).toBe(200);
  expect((await me.json()).user).toMatchObject({ id: user.id, email, currency: "CAD" });
  expect((await request.get("/api/v1/budgets", { headers })).status()).toBe(200);

  // A new tab: Chromium holds the first one on the app address it could not open, and input
  // to that tab stops reaching the page.
  const settings = await page.context().newPage();
  await settings.goto("/settings/security");
  const card = settings.getByRole("region", { name: "Signed-in apps" });
  await expect(card.getByText("E2E iPhone")).toBeVisible();
  await card.getByRole("button", { name: "Sign out E2E iPhone" }).click();
  await expect(card.getByText("No phones are signed in to the app.")).toBeVisible();
  expect((await request.get("/api/v1/me", { headers })).status()).toBe(401);
});
