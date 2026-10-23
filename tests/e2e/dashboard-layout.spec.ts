import { expect, test, type Page } from "@playwright/test";
import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { ensureDefaultDataForUser } from "../../src/lib/defaults";
import { expectDashboardHome } from "./expect-dashboard-home";
import { hashTestPassword, signInWithPassword, uniqueStamp } from "./helpers";

// The arrangement UI is desktop-only; below lg the dashboard renders its frozen mobile
// column, which the mobile specs cover.

async function signInFreshUser(page: Page, label: string) {
  const stamp = uniqueStamp();
  const email = `e2e-layout-${label}-${stamp}@example.com`;
  const password = "e2e-password-123";

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashTestPassword(password),
      displayName: "E2E Layout User",
      countryCode: "CA",
      timezone: "America/Toronto",
      role: "USER",
    },
  });
  await ensureDefaultDataForUser(user);

  // The Budgets card only renders rows when there are budgets; without these the per-row
  // setting would have nothing to apply to and the test would assert against an empty state.
  const categories = await prisma.category.findMany({
    where: { userId: user.id, kind: CategoryKind.EXPENSE },
    orderBy: { name: "asc" },
    take: 4,
  });
  const now = new Date();
  const periodMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  await prisma.budget.createMany({
    data: categories.map((category, index) => ({
      userId: user.id,
      categoryId: category.id,
      periodMonth,
      limitCents: (index + 2) * 20_000,
    })),
  });

  await signInWithPassword(page, email, password);
  await expectDashboardHome(page);
  return user;
}

/** Four populated columns, one of them a stack, for the responsive sweep. */
const FOUR_COLUMN_LAYOUT = {
  version: 1,
  columns: [
    { id: "c1", weight: 6, slots: [{ id: "s1", cards: ["cumulative-spend"], activeIndex: 0 }] },
    {
      id: "c2",
      weight: 6,
      slots: [
        { id: "s2", cards: ["add-expense"], activeIndex: 0 },
        { id: "s3", cards: ["expense-log"], activeIndex: 0 },
      ],
    },
    { id: "c3", weight: 6, slots: [{ id: "s4", cards: ["budgets", "spending-by-category"], activeIndex: 0 }] },
    { id: "c4", weight: 6, slots: [{ id: "s5", cards: ["recurring"], activeIndex: 0 }] },
  ],
  settings: {},
};

/** Card ids per rendered column, left to right. */
async function columnCards(page: Page): Promise<string[][]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-column-index]")]
      .filter((column) => column.getClientRects().length > 0)
      .map((column) =>
        [...column.querySelectorAll("[data-card-id]")].map(
          (card) => (card as HTMLElement).dataset.cardId ?? "",
        ),
      ),
  );
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Cards whose box escapes the viewport. The scroll check alone cannot see these: the grid
 * clips horizontal overflow, so a layout too wide for its container stops scrolling and
 * starts cutting cards off instead — which is the failure a reader would actually notice.
 */
async function clippedCards(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-card-id]")]
      .filter((card) => card.getClientRects().length > 0)
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
      })
      .map((card) => (card as HTMLElement).dataset.cardId ?? ""),
  );
}

/**
 * dnd-kit reads a real pointer gesture: it needs the 4px activation threshold crossed and
 * then intermediate moves before the drop. A single mouse jump is not seen as a drag.
 */
async function dragCardTo(page: Page, handleLabel: string, target: { x: number; y: number }) {
  // Exact: "Move Add" is also a substring of the card's "Remove Add" button.
  const handle = page.getByRole("button", { name: handleLabel, exact: true });
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error(`No bounding box for ${handleLabel}`);

  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 20;
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(
      from.x + ((target.x - from.x) * step) / steps,
      from.y + ((target.y - from.y) * step) / steps,
    );
    // dnd-kit recomputes collisions per frame; moving faster than it can react drops events.
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(100);
  await page.mouse.up();
}

test("a card dragged to another column stays there across a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const user = await signInFreshUser(page, "move");

  // Assert the starting position: without this the test would pass on a layout that already
  // had the card where the drag was meant to put it.
  const before = await columnCards(page);
  expect(before).toHaveLength(2);
  expect(before[0]).toContain("add-expense");
  expect(before[1]).not.toContain("add-expense");

  await page.getByRole("button", { name: "Edit layout" }).click();
  await expect(page.getByRole("toolbar", { name: "Dashboard layout" })).toBeVisible();

  // Aim at the middle of the card currently at the head of the other column: dnd-kit sorts
  // by what the pointer is over, so an empty strip of column is not a reorder target.
  const targetCard = page.locator('[data-column-index="1"] [data-card-id]').first();
  const target = await targetCard.boundingBox();
  if (!target) throw new Error("no card in the side column");
  await dragCardTo(page, "Move Add", {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  });

  await expect
    .poll(async () => (await columnCards(page))[1]?.includes("add-expense"))
    .toBe(true);

  await page.getByRole("button", { name: "Done" }).click();

  // Wait on the row the save actually writes, not on the UI that scheduled it: leaving edit
  // mode flushes a debounced save, and reloading before it lands would read back the old
  // layout and look like the drag never persisted.
  await expect
    .poll(
      async () => {
        const row = await prisma.dashboardLayout.findUnique({ where: { userId: user.id } });
        if (!row) return null;
        const parsed = JSON.parse(row.layoutJson) as { columns: { slots: { cards: string[] }[] }[] };
        return parsed.columns.map((column) => column.slots.flatMap((slot) => slot.cards));
      },
      { timeout: 10_000 },
    )
    .toEqual([
      ["cumulative-spend", "insights", "investments", "bills-forecast", "expense-log"],
      ["add-expense", "budgets", "spending-by-category", "income", "recurring"],
    ]);

  await page.reload();
  await expectDashboardHome(page);

  const after = await columnCards(page);
  expect(after[1]).toContain("add-expense");
  expect(after[0]).not.toContain("add-expense");
});

test("a per-card setting takes effect and survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const user = await signInFreshUser(page, "settings");

  const budgets = page.getByRole("region", { name: "Budgets" });
  const rowsTemplate = async () =>
    budgets.locator("[data-budget-rows]").evaluate((el) => getComputedStyle(el).gridTemplateColumns);

  // One budget per row to begin with.
  expect((await rowsTemplate()).split(" ")).toHaveLength(1);

  await budgets.getByRole("button", { name: "Budgets settings" }).click();
  const popover = page.getByRole("dialog", { name: "Budgets settings" });
  await popover.getByRole("group", { name: "Budgets per row" }).getByRole("button", { name: "2" }).click();

  // The card reflows from client state immediately, so seeing two tracks says nothing about
  // the save. Wait on the row itself before reloading, or the reload reads back the old value.
  await expect.poll(async () => (await rowsTemplate()).split(" ").length).toBe(2);
  await expect
    .poll(
      async () => {
        const row = await prisma.dashboardLayout.findUnique({ where: { userId: user.id } });
        if (!row) return null;
        return (JSON.parse(row.layoutJson) as { settings?: { budgets?: { perRow?: number } } })
          .settings?.budgets?.perRow ?? null;
      },
      { timeout: 10_000 },
    )
    .toBe(2);

  await page.reload();
  await expectDashboardHome(page);
  expect((await rowsTemplate()).split(" ")).toHaveLength(2);
});

test("the cumulative card overlays last month's spending and remembers the choice", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const user = await signInFreshUser(page, "compare");

  // A month that is over, so the whole of it is plotted whatever day the suite runs on.
  const category = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, kind: CategoryKind.EXPENSE },
  });
  await prisma.transaction.createMany({
    data: [
      { date: "2026-02-03", amountCents: 20_000 },
      { date: "2026-03-02", amountCents: 5_000 },
    ].map((row, index) => ({
      userId: user.id,
      categoryId: category.id,
      type: TransactionType.EXPENSE,
      amountCents: row.amountCents,
      date: new Date(`${row.date}T00:00:00Z`),
      title: `Compare ${index}`,
    })),
  });

  await page.goto("/?month=2026-03");
  const card = page.getByRole("region", { name: "Cumulative spending" });
  await expect(card.getByText("Last month", { exact: true })).toHaveCount(0);

  await card.getByRole("button", { name: "Cumulative spending settings" }).click();
  const popover = page.getByRole("dialog", { name: "Cumulative spending settings" });
  await popover.getByRole("group", { name: "Compare with" }).getByRole("button", { name: "Last month" }).click();

  await expect
    .poll(
      async () => {
        const row = await prisma.dashboardLayout.findUnique({ where: { userId: user.id } });
        if (!row) return null;
        return (
          (JSON.parse(row.layoutJson) as { settings?: { "cumulative-spend"?: { compareWith?: string } } })
            .settings?.["cumulative-spend"]?.compareWith ?? null
        );
      },
      { timeout: 10_000 },
    )
    .toBe("last-month");

  // The line and the heading's gap are drawn on the server, so they appear on the reload.
  await page.reload();
  await expect(card.getByText("Last month", { exact: true })).toBeVisible();
  await expect(card.getByText(/150\.00 less than last month/)).toBeVisible();
});

test("narrowing the window never produces horizontal scrolling, and no card disappears", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const user = await signInFreshUser(page, "narrow");

  // Four populated columns, written straight to the layout row. Adding them through the
  // toolbar would leave them empty, and an empty column collapses away for viewing — the
  // sweep would then be measuring the two-column default and passing on slack.
  await prisma.dashboardLayout.upsert({
    where: { userId: user.id },
    create: { userId: user.id, version: 1, layoutJson: JSON.stringify(FOUR_COLUMN_LAYOUT) },
    update: { version: 1, layoutJson: JSON.stringify(FOUR_COLUMN_LAYOUT) },
  });

  await page.reload();
  await expectDashboardHome(page);
  await expect(page.locator("[data-column-index]")).toHaveCount(4);

  const expected = (await columnCards(page)).flat().sort();
  // A stack is one card element carrying both of its cards' ids.
  expect(expected).toEqual([
    "add-expense",
    "bills-forecast",
    "budgets+spending-by-category",
    "cumulative-spend",
    "expense-log",
    "insights+investments",
    "recurring",
  ]);

  for (const width of [1600, 1440, 1280, 1100, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.reload();
    await expectDashboardHome(page);

    // All three matter: a layout could avoid scrolling by clipping its cards, or by dropping
    // them, and either would satisfy the scroll check on its own.
    expect(await horizontalOverflow(page), `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    expect(await clippedCards(page), `cards cut off at ${width}px`).toEqual([]);
    expect((await columnCards(page)).flat().sort(), `cards at ${width}px`).toEqual(expected);
  }
});

test("a column that clears the pixel minimum but cuts off its text is merged away", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  const user = await signInFreshUser(page, "cramped");

  // The expense log's date labels are what a 340px column cuts off; without rows there is
  // nothing to cut off and every width would pass on the pixel rule alone.
  const category = await prisma.category.findFirstOrThrow({ where: { userId: user.id, kind: CategoryKind.EXPENSE } });
  const now = new Date();
  await prisma.transaction.createMany({
    data: Array.from({ length: 8 }, (_, i) => ({
      userId: user.id,
      type: TransactionType.EXPENSE,
      amountCents: 1234 * (i + 1),
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2 + i)),
      title: `Purchase ${i + 1}`,
      categoryId: category.id,
    })),
  });
  await prisma.dashboardLayout.upsert({
    where: { userId: user.id },
    create: { userId: user.id, version: 1, layoutJson: JSON.stringify(FOUR_COLUMN_LAYOUT) },
    update: { version: 1, layoutJson: JSON.stringify(FOUR_COLUMN_LAYOUT) },
  });
  await page.reload();
  await expectDashboardHome(page);

  // Edit mode applies only the pixel minimum, so it shows what that rule alone allows.
  await page.getByRole("button", { name: "Edit layout" }).click();
  await expect(page.locator("[data-column-index]")).toHaveCount(3);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("[data-column-index]")).toHaveCount(2);

  // Narrower, the pixel rule already gets to two; the cap from 1100px must not take one more.
  await page.setViewportSize({ width: 1024, height: 1000 });
  await expect(page.locator("[data-column-index]")).toHaveCount(2);

  // And the columns come back once there is room for them.
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect(page.locator("[data-column-index]")).toHaveCount(4);
  expect((await columnCards(page)).flat()).toHaveLength(7);
});

test("a column is dropped rather than show less than 90% of a budget name", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const user = await signInFreshUser(page, "budget-names");

  // One long name among short ones. Several would also trip the card-wide 95% rule, and the
  // test would then pass whether or not the per-name floor exists.
  const budget = await prisma.budget.findFirstOrThrow({ where: { userId: user.id }, include: { category: true } });
  const longName = "Household repairs and seasonal upkeep";
  await prisma.category.update({ where: { id: budget.categoryId }, data: { name: longName } });
  await prisma.dashboardLayout.upsert({
    where: { userId: user.id },
    create: { userId: user.id, version: 1, layoutJson: JSON.stringify(FOUR_COLUMN_LAYOUT) },
    update: { version: 1, layoutJson: JSON.stringify(FOUR_COLUMN_LAYOUT) },
  });
  await page.reload();
  await expectDashboardHome(page);

  // The share of each budget name on screen; an ellipsis counts against it.
  const nameShares = () =>
    page.locator("[data-min-visible]").evaluateAll((spans) =>
      spans
        .filter((span) => span.getClientRects().length > 0)
        .map((span) => {
          const el = span as HTMLElement;
          if (el.scrollWidth <= el.clientWidth) return 1;
          return (el.clientWidth - parseFloat(getComputedStyle(el).fontSize)) / el.scrollWidth;
        }),
    );

  // Four columns clear the pixel minimum here — edit mode, which applies only that, shows
  // them — and in them the long name is cut well short.
  await page.getByRole("button", { name: "Edit layout" }).click();
  await expect(page.locator("[data-column-index]")).toHaveCount(4);
  expect(Math.min(...(await nameShares()))).toBeLessThan(0.9);
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page.locator("[data-column-index]")).toHaveCount(3);
  const shares = await nameShares();
  expect(shares.length).toBeGreaterThan(0);
  expect(Math.min(...shares)).toBeGreaterThanOrEqual(0.9);

  // The floor is the user's to set. Lowered far enough in Settings, the cut-off name is
  // acceptable and all four columns stay.
  await page.goto("/settings/appearance");
  // 10% is the lowest the setting allows.
  await page.locator('input[name="budgetNameVisiblePct"]').fill("10");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).dashboardBudgetNameVisiblePct)
    .toBe(10);

  await page.goto("/");
  await expectDashboardHome(page);
  await expect(page.locator("[data-column-index]")).toHaveCount(4);
  expect(Math.min(...(await nameShares()))).toBeLessThan(0.9);
});

test("columns can be added and removed, and removing one keeps its cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signInFreshUser(page, "columns");

  await page.getByRole("button", { name: "Edit layout" }).click();
  await expect(page.locator("[data-column-index]")).toHaveCount(2);

  await page.getByRole("button", { name: "Add column" }).click();
  await expect(page.locator("[data-column-index]")).toHaveCount(3);

  const before = (await columnCards(page)).flat().sort();
  await page.getByRole("button", { name: "Remove column 2" }).click();
  await expect(page.locator("[data-column-index]")).toHaveCount(2);

  // The point of the assertion: a removed column hands its cards to a neighbour rather than
  // taking them with it.
  expect((await columnCards(page)).flat().sort()).toEqual(before);
});

test("a removed card stays off across a reload and can be added back as a tab", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const user = await signInFreshUser(page, "remove");

  // Upcoming bills rather than Insights: it is a card on its own, where Insights shares a stack
  // with Investments. Starting position, so the test cannot pass on a dashboard that never
  // showed the card.
  expect((await columnCards(page)).flat()).toContain("bills-forecast");

  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByRole("button", { name: "Remove Upcoming bills" }).click();
  await expect(page.locator('[data-card-id="bills-forecast"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Done" }).click();

  // Wait on the row the save writes, then reload: the reconciler re-adds any card it does not
  // know was removed, so this is the assertion that the removal persisted.
  await expect
    .poll(
      async () => {
        const row = await prisma.dashboardLayout.findUnique({ where: { userId: user.id } });
        return row ? (JSON.parse(row.layoutJson) as { hidden?: string[] }).hidden ?? null : null;
      },
      { timeout: 10_000 },
    )
    .toEqual(["bills-forecast"]);

  await page.reload();
  await expectDashboardHome(page);
  expect((await columnCards(page)).flat()).not.toContain("bills-forecast");

  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByRole("button", { name: "Add card (1)" }).click();
  await page.getByLabel("Upcoming bills", { exact: true }).selectOption({ label: "Tab on Budgets" });
  await page.getByRole("button", { name: "Add Upcoming bills" }).click();

  const stack = page.getByRole("region", { name: "Budgets, Upcoming bills" });
  await expect(stack).toBeVisible();
  await expect(page.getByRole("button", { name: "Add card" })).toBeDisabled();
  await page.getByRole("button", { name: "Done" }).click();

  await expect
    .poll(
      async () => {
        const row = await prisma.dashboardLayout.findUnique({ where: { userId: user.id } });
        if (!row) return null;
        const parsed = JSON.parse(row.layoutJson) as {
          hidden?: string[];
          columns: { slots: { cards: string[] }[] }[];
        };
        return {
          hidden: parsed.hidden ?? [],
          stacked: parsed.columns.some((column) =>
            column.slots.some((slot) => slot.cards.join(",") === "budgets,bills-forecast"),
          ),
        };
      },
      { timeout: 10_000 },
    )
    .toEqual({ hidden: [], stacked: true });
});

test("Insights taken off the dashboard is not worked out, and shows its insights once added back", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const user = await signInFreshUser(page, "insights-off");
  expect((await columnCards(page)).flat()).toContain("insights+investments");

  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByRole("button", { name: "Remove Insights" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect
    .poll(
      async () => {
        const row = await prisma.dashboardLayout.findUnique({ where: { userId: user.id } });
        return row ? (JSON.parse(row.layoutJson) as { hidden?: string[] }).hidden ?? null : null;
      },
      { timeout: 10_000 },
    )
    .toEqual(["insights"]);

  // Reloaded with the card off, the page does not load insights; adding it back has to fetch
  // them rather than show the placeholder it was rendered with.
  await page.reload();
  await expectDashboardHome(page);
  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByRole("button", { name: "Add card (1)" }).click();
  await page.getByRole("button", { name: "Add Insights" }).click();
  const card = page.locator('[data-card-id="insights"]');
  await expect(card).toContainText("Nothing needs your attention", { timeout: 10_000 });
  await expect(card).not.toContainText("Loading insights");
});
