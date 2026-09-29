import { expect, Page, test } from "@playwright/test";

import { apiOrigin, comparisonResponse, documentOverflowX, email, installSession, mockConversations } from "./support";

const extraViewports = [
  { width: 320, height: 568 },
  { width: 844, height: 390 },
];

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`${selector} is not rendered`);
  return found;
}

function boxesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
) {
  const overlapX = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const overlapY = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return overlapX > 1 && overlapY > 1;
}

test.describe("signed-out layout", () => {
  test("the document allows pinch and browser zoom", async ({ page }) => {
    await page.goto("/");
    const content = (await page.locator('meta[name="viewport"]').getAttribute("content")) || "";
    expect(content).toMatch(/width=device-width/);
    expect(content).not.toMatch(/user-scalable=no/);
    expect(content).not.toMatch(/maximum-scale=1(?:\.0)?(?:\s|,|$)/);
    expect(content).toMatch(/user-scalable=yes/);
  });

  test("sign-in never overflows horizontally", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Airport intelligence/ })).toBeVisible();
    expect(await documentOverflowX(page)).toBe(0);
    for (const viewport of extraViewports) {
      await page.setViewportSize(viewport);
      expect(await documentOverflowX(page), `overflow at ${viewport.width}x${viewport.height}`).toBe(0);
    }
    await page.setViewportSize({ width: 800, height: 600 });
    expect(await documentOverflowX(page), "overflow at 800x600").toBe(0);
  });
});

test.describe("signed-in layout", () => {
  test.beforeEach(async ({ page }) => {
    await installSession(page);
    await mockConversations(page);
    await page.route(`${apiOrigin}/chat`, (route) => route.fulfill({ json: comparisonResponse }));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /See airport opportunity/ })).toBeVisible();
  });

  test("the signed-in email is visible in the header", async ({ page }) => {
    const header = page.locator("header");
    await expect(
      header.getByText(email, { exact: true }).or(header.getByRole("button", { name: email })),
    ).toBeVisible();
  });

  test("header brand and actions never overlap or leave the viewport", async ({ page }) => {
    const brand = await box(page, "header a[href='#top']");
    const actions = await box(page, "header div:has(> button[aria-label='Sign out'])");
    const viewport = page.viewportSize()!;
    expect(boxesOverlap(brand, actions)).toBe(false);
    expect(actions.x + actions.width).toBeLessThanOrEqual(viewport.width + 1);
  });

  test("workspace with evidence never overflows horizontally", async ({ page }) => {
    expect(await documentOverflowX(page)).toBe(0);
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
    await expect(page.getByRole("heading", { name: "Operational pressure" })).toBeVisible();
    expect(await documentOverflowX(page)).toBe(0);
    for (const viewport of extraViewports) {
      await page.setViewportSize(viewport);
      expect(await documentOverflowX(page), `overflow at ${viewport.width}x${viewport.height}`).toBe(0);
    }
  });

  test("hero copy and workspace share one left content edge", async ({ page }) => {
    const heading = await box(page, "h1");
    const workspaceColumn = await box(page, "section[aria-label='Airport analysis conversation']");
    expect(Math.abs(heading.x - workspaceColumn.x)).toBeLessThanOrEqual(2);
  });

  for (const [label, viewport] of [
    ["200% zoom of a 1440×1000 window", { width: 720, height: 500 }],
    ["200% zoom of a 1280×800 window", { width: 640, height: 400 }],
  ] as const) {
    test(`${label} keeps the header and composer usable`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-1440", "Zoom is emulated from the desktop project.");
      await page.setViewportSize(viewport);
      const brand = await box(page, "header a[href='#top']");
      const actions = await box(page, "header div:has(> button[aria-label='Sign out'])");

      expect(await documentOverflowX(page)).toBe(0);
      expect(boxesOverlap(brand, actions)).toBe(false);
      await page.getByLabel(/Ask about an airport/).focus();
      await expect(page.getByLabel(/Ask about an airport/)).toBeInViewport();
    });
  }

  test("doubling the root text size keeps the header and workspace inside the viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone-375" && testInfo.project.name !== "desktop-1440");
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.waitForTimeout(200);
    const brand = await box(page, "header a[href='#top']");
    const actions = await box(page, "header div:has(> button[aria-label='Sign out'])");

    expect(await documentOverflowX(page)).toBe(0);
    expect(boxesOverlap(brand, actions)).toBe(false);
    expect(actions.x + actions.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });

  test("browser-style zoom keeps the workspace inside the layout viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440", "Zoom is emulated from the desktop project.");
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
    await expect(page.getByRole("heading", { name: "Operational pressure" })).toBeVisible();
    for (const scale of [1.25, 1.5, 2]) {
      await page.evaluate((value) => {
        document.documentElement.style.zoom = String(value);
      }, scale);
      await page.waitForTimeout(120);
      expect(await documentOverflowX(page), `overflow at css zoom ${scale}`).toBe(0);
      await expect(page.getByLabel(/Ask about an airport/)).toBeInViewport();
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
  });

  test("keyboard-only users reach the composer with a visible focus indicator", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440", "Keyboard order is checked once.");
    const visited: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const style = getComputedStyle(element);
        const composer = element.id === "question" ? getComputedStyle(element.closest("form")!) : undefined;
        return {
          name: element.getAttribute("aria-label") || element.id || element.textContent?.trim().slice(0, 30) || "",
          outline:
            (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
            (composer !== undefined && composer.boxShadow !== "none"),
        };
      });
      visited.push(focused.name);
      expect(focused.outline, `focus indicator on ${focused.name}`).toBe(true);
      if (focused.name === "question") break;
    }

    expect(visited).toContain("question");
  });

  test("phone header controls meet the 44px touch target", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone-375", "Touch-target sizing applies to the phone layout.");
    const buttons = page.locator("header button");
    for (const button of await buttons.all()) {
      const size = await button.boundingBox();
      const label = (await button.getAttribute("aria-label")) ?? "header button";
      expect(size?.width, label).toBeGreaterThanOrEqual(44);
      expect(size?.height, label).toBeGreaterThanOrEqual(44);
    }
  });
});
