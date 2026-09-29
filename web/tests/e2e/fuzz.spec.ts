import { expect, Page, test } from "@playwright/test";

import { apiOrigin, comparisonResponse, documentOverflowX, installSession, mockConversations } from "./support";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "Fuzz cases set their own viewports.");
});

const hostileStrings = [
  "<script>window.__pwned = 1</script>",
  '<img src=x onerror="window.__pwned = 1">',
  "javascript:window.__pwned=1",
  "../../../../etc/passwd",
  "💺✈️🛫 مرحبا שלום 中文",
  "\u202Egnp.exe\u202C RTL override",
  'tabs\tand\nnewlines "quotes" \\backslashes\\ null undefined NaN',
];

async function openWorkspace(page: Page, answer: Record<string, unknown> = comparisonResponse) {
  await installSession(page);
  await mockConversations(page);
  const bodies: Array<{ message: string; history: Array<{ role: string; content: string }> }> = [];
  await page.route(`${apiOrigin}/chat`, (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: answer });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See airport opportunity/ })).toBeVisible();
  return bodies;
}

async function ask(page: Page, text: string) {
  await page.getByLabel(/Ask about an airport/).fill(text);
  await page.getByRole("button", { name: "Send question" }).click();
}

async function widestArticleOverflow(page: Page) {
  return page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll<HTMLElement>("article *")]
        .filter((element) => !element.closest("[class*='tableWrap']"))
        .map((element) => element.scrollWidth - element.clientWidth),
    ),
  );
}

test.describe("composer input boundaries", () => {
  test("whitespace-only input cannot be sent", async ({ page }) => {
    const bodies = await openWorkspace(page);
    const composer = page.getByLabel(/Ask about an airport/);
    await composer.fill("   \n\t  ");
    await expect(page.getByRole("button", { name: "Send question" })).toBeDisabled();
    await composer.press("Enter");

    expect(bodies).toHaveLength(0);
  });

  test("a 100,000 character paste is capped at the API limit of 1,000 characters", async ({ page }) => {
    const bodies = await openWorkspace(page);
    await ask(page, "A".repeat(100_000));
    await expect(page.getByText(comparisonResponse.answer, { exact: true })).toBeVisible();

    expect(bodies[0].message.length).toBeLessThanOrEqual(1000);
  });

  test("a 1,000 character unbroken question stays inside the conversation column", async ({ page }) => {
    await openWorkspace(page);
    await ask(page, "A".repeat(1000));
    await expect(page.getByText(comparisonResponse.answer, { exact: true })).toBeVisible();

    expect(await widestArticleOverflow(page)).toBeLessThanOrEqual(1);
    expect(await documentOverflowX(page)).toBe(0);
  });

  test("hostile and multilingual questions render as inert text", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openWorkspace(page);
    for (const text of hostileStrings) {
      await ask(page, text);
      await expect(page.getByRole("button", { name: "Send question" })).toBeDisabled();
      await expect(page.getByLabel(/Ask about an airport/)).toBeEnabled();
    }

    expect(dialogs).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await page.locator("article img[src='x'], article script").count()).toBe(0);
    await expect(page.getByText("<script>window.__pwned = 1</script>", { exact: true })).toBeVisible();
    expect(await documentOverflowX(page)).toBe(0);
  });
});

test.describe("assistant payload boundaries", () => {
  test("an assistant answer containing HTML is rendered as text", async ({ page }) => {
    await openWorkspace(page, { ...comparisonResponse, answer: '<img src=x onerror="window.__pwned=1"><b>bold</b>' });
    await ask(page, "Compare LAX and SNA");

    await expect(page.getByText('<img src=x onerror="window.__pwned=1"><b>bold</b>', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("an unbroken URL in an answer stays inside the conversation column on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openWorkspace(page, { ...comparisonResponse, answer: `See https://example.com/${"segment".repeat(40)}` });
    await ask(page, "Compare LAX and SNA");
    await expect(page.getByText(/^See https:\/\/example\.com/)).toBeVisible();

    expect(await widestArticleOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("unsafe, missing, and odd evidence values are never invented or linked", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openWorkspace(page, {
      ...comparisonResponse,
      evidence: {
        ranking: Array.from({ length: 10 }, (_, index) => ({
          airport: { code: `A${index}`, name: `Airport ${index}` },
          score: [-50, 1e21, null, "80", 250, 42, 0, 100, 55, 60][index],
          metrics: { departure_delay_rate_pct: index === 1 ? 1e21 : -3 },
        })),
        sources: [
          { id: "js", name: "Script source", url: "javascript:window.__pwned=1", observed: "2024" },
          { id: "data", name: "Data source", url: "data:text/html,<script>1</script>", observed: "" },
          { id: "ok", name: "Safe source", url: "https://faa.gov", observed: "2024" },
        ],
      },
    });
    await ask(page, "Rank everything");
    await expect(page.getByRole("heading", { name: "Opportunity score" })).toBeVisible();

    await expect(page.locator("[class*='rankingBars'] > div")).toHaveCount(6);
    await expect(page.getByRole("link", { name: /Script source/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Data source/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Safe source/ })).toHaveAttribute("rel", "noreferrer");
    await expect(page.getByText("Observed date not provided")).toBeVisible();
    await expect(page.getByRole("row", { name: /A2/ })).toContainText("—");
    expect(await documentOverflowX(page)).toBe(0);
  });

  test("follow-up history respects the API's 4,000 character item limit", async ({ page }) => {
    const bodies = await openWorkspace(page, { ...comparisonResponse, answer: "Long analysis. ".repeat(400) });
    await ask(page, "Compare LAX and SNA");
    await expect(page.getByText(/^Long analysis\./)).toBeVisible();
    await ask(page, "And the follow-up?");
    await expect.poll(() => bodies.length).toBe(2);

    expect(Math.max(...bodies[1].history.map((item) => item.content.length))).toBeLessThanOrEqual(4000);
  });
});
