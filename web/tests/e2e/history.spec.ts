import { expect, Page, test } from "@playwright/test";

import { apiOrigin, documentOverflowX, installSession } from "./support";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "History scale cases set their own viewports.");
});

type Summary = { id: string; title: string; created_at: string; updated_at: string };

const summary = (index: number, title = `Saved analysis ${index + 1}`): Summary => ({
  id: `conversation-${String(index).padStart(3, "0")}`,
  title,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: new Date(Date.UTC(2026, 8, 29) - index * 86_400_000).toISOString(),
});

const detail = (item: Summary, answer: string) => ({
  ...item,
  messages: [
    { id: `${item.id}-u`, role: "user", content: `Question for ${item.title}`, created_at: item.created_at },
    { id: `${item.id}-a`, role: "assistant", content: answer, evidence: {}, created_at: item.created_at },
  ],
});

async function openWithHistory(page: Page, items: Summary[], delays: Record<string, number> = {}) {
  await installSession(page);
  let current = [...items];
  await page.route(`${apiOrigin}/conversations**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/conversations") return route.fulfill({ json: { conversations: current } });
    const id = path.split("/").at(-1)!;
    if (route.request().method() === "DELETE") {
      current = current.filter((item) => item.id !== id);
      return route.fulfill({ status: 204 });
    }
    await new Promise((resolve) => setTimeout(resolve, delays[id] ?? 0));
    const item = items.find((candidate) => candidate.id === id)!;
    return route.fulfill({ json: detail(item, `Answer for ${item.title}`) });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See airport opportunity/ })).toBeVisible();
}

for (const count of [0, 1, 2, 30, 100]) {
  test(`desktop rail lists ${count} saved analyses and the last is reachable`, async ({ page }) => {
    const items = Array.from({ length: count }, (_, index) => summary(index));
    await openWithHistory(page, items);
    const rail = page.getByRole("complementary", { name: "Saved analyses" });
    if (count === 0) {
      await expect(rail.getByText("No saved analyses yet.")).toBeVisible();
      return;
    }
    await expect(rail.getByRole("button", { name: /^Saved analysis/ })).toHaveCount(count);
    await rail.getByRole("button", { name: new RegExp(`^Saved analysis ${count} `) }).click();

    await expect(page.getByText(`Answer for Saved analysis ${count}`, { exact: true })).toBeVisible();
  });
}

test("phone history opens the full thread instead of a collapsed pane", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openWithHistory(page, [summary(0, "Saved airport comparison")]);
  await page.getByRole("button", { name: "Open analysis history" }).click();
  await page
    .getByRole("dialog", { name: "Saved analyses" })
    .getByRole("button", { name: /^Saved airport comparison/ })
    .click();

  await expect(page.getByText("Question for Saved airport comparison")).toBeVisible();
  const answer = page.getByText("Answer for Saved airport comparison", { exact: true });
  await expect(answer).toBeVisible();
  await expect(answer).toBeInViewport();
  const threadHeight = await page
    .getByRole("region", { name: "Airport analysis conversation" })
    .locator("div[aria-live='polite']")
    .evaluate((node) => (node as HTMLElement).getBoundingClientRect().height);
  expect(threadHeight).toBeGreaterThan(80);
});

test("phone drawer can reach the 100th saved analysis", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openWithHistory(
    page,
    Array.from({ length: 100 }, (_, index) => summary(index)),
  );
  await page.getByRole("button", { name: "Open analysis history" }).click();
  const drawer = page.getByRole("dialog", { name: "Saved analyses" });
  const last = drawer.getByRole("button", { name: /^Saved analysis 100 / });
  await last.scrollIntoViewIfNeeded();

  await expect(last).toBeInViewport();
});

test("long, right-to-left, and markup titles render as contained text", async ({ page }) => {
  const titles = [
    `A very long saved analysis title ${"that keeps going ".repeat(20)}`,
    "ניתוח שדות תעופה בצפון מזרח — مقارنة المطارات",
    "<img src=x onerror=alert(1)> Compare LAX",
    "Duplicate title",
    "Duplicate title",
  ];
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await openWithHistory(
    page,
    titles.map((title, index) => summary(index, title)),
  );
  const rail = page.getByRole("complementary", { name: "Saved analyses" });

  await expect(rail.locator("button[title='<img src=x onerror=alert(1)> Compare LAX']")).toBeVisible();
  await expect(rail.locator("button[title='Duplicate title']")).toHaveCount(2);
  expect(dialogs).toEqual([]);
  expect(await documentOverflowX(page)).toBe(0);
  const railBox = await rail.boundingBox();
  const titleBox = await rail.locator("button[title^='A very long saved analysis']").boundingBox();
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width);
});

test("opening one analysis quickly after another shows the last one chosen", async ({ page }) => {
  const items = [summary(0), summary(1)];
  await openWithHistory(page, items, { [items[0].id]: 1_200, [items[1].id]: 100 });
  const rail = page.getByRole("complementary", { name: "Saved analyses" });
  await rail.getByRole("button", { name: /^Saved analysis 1 / }).click();
  await rail.getByRole("button", { name: /^Saved analysis 2 / }).click();
  await page.waitForTimeout(1_600);

  await expect(page.getByText("Answer for Saved analysis 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Answer for Saved analysis 1", { exact: true })).toBeHidden();
});

test("deleting the open analysis returns to a fresh workspace", async ({ page }) => {
  const items = [summary(0), summary(1)];
  await openWithHistory(page, items);
  const rail = page.getByRole("complementary", { name: "Saved analyses" });
  await rail.getByRole("button", { name: /^Saved analysis 1 / }).click();
  await expect(page.getByText("Answer for Saved analysis 1", { exact: true })).toBeVisible();
  await rail.getByRole("button", { name: "Delete Saved analysis 1" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

  await expect(page.getByRole("heading", { name: "Questions built for this evidence set" })).toBeVisible();
  await expect(rail.getByRole("button", { name: /^Saved analysis/ })).toHaveCount(1);
});
