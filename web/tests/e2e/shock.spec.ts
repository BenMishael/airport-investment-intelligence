import { expect, Page, test } from "@playwright/test";

import {
  apiOrigin,
  comparisonResponse,
  installSession,
  mockConversations,
  savedConversation,
  supabaseOrigin,
} from "./support";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "Shock tests set their own viewports.");
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function countRequests(
  page: Page,
  pattern: string,
  respond: () => Promise<void> | void,
  status = 200,
  json = {},
) {
  const hits: string[] = [];
  await page.route(pattern, async (route) => {
    hits.push(route.request().method());
    await respond();
    return route.fulfill({ status, json });
  });
  return hits;
}

async function openWorkspace(page: Page, withSavedConversation = false) {
  await installSession(page);
  const calls = await mockConversations(page, withSavedConversation);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See airport opportunity/ })).toBeVisible();
  return calls;
}

test.describe("rapid authentication interaction", () => {
  test("triple-clicking Send sign-in code issues one OTP request", async ({ page }) => {
    const hits = await countRequests(page, `${supabaseOrigin}/auth/v1/otp**`, () => delay(400));
    await page.goto("/");
    await page.getByLabel("Email address").fill("reviewer@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click({ clickCount: 3 });
    await expect(page.getByLabel("Eight-digit code")).toBeVisible();

    expect(hits).toHaveLength(1);
  });

  test("double-clicking Open workspace issues one verification request", async ({ page }) => {
    await page.route(`${supabaseOrigin}/auth/v1/otp**`, (route) => route.fulfill({ json: {} }));
    const hits = await countRequests(page, `${supabaseOrigin}/auth/v1/verify**`, () => delay(400), 403, {
      error_code: "otp_expired",
      msg: "Token has expired or is invalid",
    });
    await page.goto("/");
    await page.getByLabel("Email address").fill("reviewer@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await page.getByLabel("Eight-digit code").fill("12345678");
    await page.getByRole("button", { name: "Open workspace" }).dblclick();
    await expect(page.getByText(/invalid or expired/)).toBeVisible();

    expect(hits).toHaveLength(1);
  });
});

test.describe("rapid workspace interaction", () => {
  test("clicking Send and pressing Enter together sends one question", async ({ page }) => {
    await openWorkspace(page);
    const hits = await countRequests(page, `${apiOrigin}/chat`, () => delay(400), 200, comparisonResponse);
    const composer = page.getByLabel(/Ask about an airport/);
    await composer.fill("Compare LAX and SNA");
    await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>("#question")!;
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      document.querySelector<HTMLButtonElement>("button[aria-label='Send question']")!.click();
    });
    await expect(page.getByText(comparisonResponse.answer, { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(300);

    expect(hits).toHaveLength(1);
    await expect(page.getByText("Compare LAX and SNA", { exact: true })).toHaveCount(1);
  });

  test("triple-clicking a starter prompt sends one question", async ({ page }) => {
    await openWorkspace(page);
    const hits = await countRequests(page, `${apiOrigin}/chat`, () => delay(400), 200, comparisonResponse);
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click({ clickCount: 3 });
    await expect(page.getByText(comparisonResponse.answer, { exact: true })).toBeVisible();

    expect(hits).toHaveLength(1);
  });

  test("double-clicking Retry sends one retry", async ({ page }) => {
    await openWorkspace(page);
    let attempts = 0;
    await page.route(`${apiOrigin}/chat`, async (route) => {
      attempts += 1;
      if (attempts === 1)
        return route.fulfill({ status: 503, json: { error: { message: "Temporarily unavailable" } } });
      await delay(400);
      return route.fulfill({ json: comparisonResponse });
    });
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
    await page.getByRole("button", { name: "Retry" }).dblclick();
    await expect(page.getByText(comparisonResponse.answer, { exact: true })).toBeVisible();

    expect(attempts).toBe(2);
  });

  test("double-clicking Delete in the confirmation issues one delete", async ({ page }) => {
    await openWorkspace(page, true);
    const deletes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "DELETE") deletes.push(request.url());
    });
    await page.getByRole("button", { name: `Delete ${savedConversation.title}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).dblclick();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await page.waitForTimeout(300);

    expect(deletes).toHaveLength(1);
  });

  test("rapid theme switching settles on the last choice", async ({ page }) => {
    await openWorkspace(page);
    for (const label of ["Dark theme", "Light theme", "Use system theme", "Dark theme", "Light theme", "Dark theme"]) {
      await page.getByRole("button", { name: label }).click();
    }

    await expect(page.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("airport-intelligence-theme"))).toBe("dark");
  });

  test("triple-clicking Sign out returns to sign-in without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openWorkspace(page);
    await page.route(`${supabaseOrigin}/auth/v1/logout**`, (route) => route.fulfill({ status: 204 }));
    await page.getByRole("button", { name: "Sign out" }).click({ clickCount: 3 });

    await expect(page.getByRole("heading", { name: /Airport intelligence/ })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("overlay churn", () => {
  test("rapidly opening and closing the history drawer never leaves the page scroll-locked", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openWorkspace(page, true);
    const trigger = page.getByRole("button", { name: "Open analysis history" });
    for (let index = 0; index < 8; index += 1) {
      await trigger.click();
      await page.keyboard.press("Escape");
    }
    await expect(page.getByRole("dialog", { name: "Saved analyses" })).toBeHidden();

    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("focus returns to the History trigger after rapid open/close cycles", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openWorkspace(page, true);
    const trigger = page.getByRole("button", { name: "Open analysis history" });
    for (let index = 0; index < 8; index += 1) {
      await trigger.click();
      await page.keyboard.press("Escape");
    }
    await expect(page.getByRole("dialog", { name: "Saved analyses" })).toBeHidden();

    await expect(trigger).toBeFocused();
  });

  test("opening delete confirmation during drawer animation keeps one dialog stack", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openWorkspace(page, true);
    await page.getByRole("button", { name: "Open analysis history" }).click();
    await page
      .getByRole("dialog", { name: "Saved analyses" })
      .getByRole("button", { name: /^Delete/ })
      .click();
    await page.getByRole("button", { name: "Keep analysis" }).click();
    await page.getByRole("button", { name: "Close history" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("widening past the drawer breakpoint releases the mobile drawer", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openWorkspace(page, true);
    await page.getByRole("button", { name: "Open analysis history" }).click();
    await expect(page.getByRole("dialog", { name: "Saved analyses" })).toBeVisible();

    for (const width of [620, 760, 800, 1024, 1025, 1440]) await page.setViewportSize({ width, height: 900 });

    await expect(page.getByRole("dialog", { name: "Saved analyses" })).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("resizing across every breakpoint during an answer keeps the document stable", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openWorkspace(page);
    await page.route(`${apiOrigin}/chat`, async (route) => {
      await delay(600);
      return route.fulfill({ json: comparisonResponse });
    });
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
    for (const width of [1440, 1025, 1024, 800, 760, 620, 430, 375, 620, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
    }
    await expect(page.getByText(comparisonResponse.answer, { exact: true })).toBeVisible();

    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
      0,
    );
  });
});
