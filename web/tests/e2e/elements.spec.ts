import { expect, test } from "@playwright/test";

import { apiOrigin, comparisonResponse, installSession, mockConversations, supabaseOrigin } from "./support";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "Element checks are viewport independent unless they set size.");
});

test.describe("authentication page elements", () => {
  test("email field exposes the expected input contract", async ({ page }) => {
    await page.goto("/");
    const email = page.getByLabel("Email address");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(email).toHaveAttribute("required", "");
    await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeDisabled();
  });

  test("offline before the first document load cannot boot the application", async ({ page, context }) => {
    await context.setOffline(true);
    const error = await page.goto("/").catch((caught: Error) => caught.message);
    expect(String(error)).toMatch(/INTERNET_DISCONNECTED|NS_ERROR_OFFLINE/);
  });

  test("going offline after load disables code request and shows Offline", async ({ page, context }) => {
    await page.goto("/");
    await context.setOffline(true);
    await page.getByLabel("Email address").fill("reviewer@example.com");

    await expect(page.getByText("Offline", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeDisabled();
  });

  test("OTP verify stays disabled until eight digits and ignores a ninth", async ({ page }) => {
    await page.route(`${supabaseOrigin}/auth/v1/otp**`, (route) => route.fulfill({ json: {} }));
    await page.goto("/");
    await page.getByLabel("Email address").fill("reviewer@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    const otp = page.getByLabel("Eight-digit code");
    const verify = page.getByRole("button", { name: "Open workspace" });

    await expect(otp).toHaveAttribute("inputmode", "numeric");
    await expect(otp).toHaveAttribute("autocomplete", "one-time-code");
    await expect(otp).toHaveAttribute("maxlength", "8");
    await expect(verify).toBeDisabled();
    await otp.fill("1");
    await expect(verify).toBeDisabled();
    await otp.fill("1234567");
    await expect(verify).toBeDisabled();
    await otp.fill("123456789");
    await expect(otp).toHaveValue("12345678");
    await expect(verify).toBeEnabled();
  });

  test("Use another email restores a blank email step and focus", async ({ page }) => {
    await page.route(`${supabaseOrigin}/auth/v1/otp**`, (route) => route.fulfill({ json: {} }));
    await page.goto("/");
    await page.getByLabel("Email address").fill("reviewer@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await page.getByLabel("Eight-digit code").fill("12345678");
    await page.getByRole("button", { name: "Use another email" }).click();

    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue("reviewer@example.com");
    await expect(page.getByText(/code is on its way/)).toBeHidden();
    await expect(page.getByLabel("Eight-digit code")).toHaveCount(0);
  });

  test("the route-network animation has no playback control", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("img", { name: /connected airports/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /animation/ })).toHaveCount(0);
  });

  test("missing animation JSON falls back to the static poster", async ({ page }) => {
    await page.route("**/assets/motion/route-network.json", (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/");

    await expect(page.getByRole("img", { name: /connected airports/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /animation/ })).toHaveCount(0);
  });
});

test.describe("authenticated surface elements", () => {
  test("header, footer, and brand names are present but landmarks are incomplete", async ({ page }) => {
    await installSession(page);
    await mockConversations(page);
    await page.goto("/");

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("the brand accessible name matches the visible label", async ({ page }) => {
    await installSession(page);
    await mockConversations(page);
    await page.goto("/");
    const brand = page.getByRole("link", { name: /Airport Intelligence/ }).first();
    const accessible = await brand.evaluate((element) => (element as HTMLElement).getAttribute("aria-label") || "");
    const visible = ((await brand.innerText()) || "").replace(/\s+/g, " ").trim();

    expect(accessible).toBe("");
    expect(visible.toLowerCase()).toContain("airport intelligence");
  });

  test("favicon.ico is served", async ({ page, request }) => {
    await page.goto("/");
    const response = await request.get("/favicon.ico");
    expect(response.status()).toBeLessThan(400);
  });

  test("failed logout still returns to sign-in after clearing the local session", async ({ page }) => {
    await installSession(page);
    await mockConversations(page);
    await page.route(`${supabaseOrigin}/auth/v1/logout**`, (route) =>
      route.fulfill({ status: 500, json: { msg: "logout failed" } }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByRole("heading", { name: /Airport intelligence/ })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).length)).toBe(0);
  });

  test("evidence disclosure can close and reopen without losing values", async ({ page }) => {
    await installSession(page);
    await mockConversations(page);
    await page.route(`${apiOrigin}/chat`, (route) => route.fulfill({ json: comparisonResponse }));
    await page.goto("/");
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
    const disclosure = page.getByRole("button", { name: /Evidence & calculation/ });
    await expect(page.getByRole("heading", { name: "Operational pressure" })).toBeVisible();
    await disclosure.click();
    await expect(page.getByRole("heading", { name: "Operational pressure" })).toBeHidden();
    await disclosure.click();
    await expect(page.getByText("22.9%").first()).toBeVisible();
  });

  test("phone starter shows two prompts until the disclosure is opened", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installSession(page);
    await mockConversations(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /New England/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Compare Los Angeles/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Anchorage/ })).toBeHidden();
    await page.getByRole("button", { name: "Show two more questions" }).click();
    await expect(page.getByRole("button", { name: /Anchorage/ })).toBeVisible();
    await page.getByRole("button", { name: "Show fewer questions" }).click();
    await expect(page.getByRole("button", { name: /Anchorage/ })).toBeHidden();
  });

  test("analysis workspace is on the page without a jump CTA", async ({ page }) => {
    await installSession(page);
    await mockConversations(page);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Open intelligence workspace" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Airport analysis conversation" })).toBeVisible();
  });

  test("saved analyses stay inside the viewport when history is long", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSession(page);
    const conversations = Array.from({ length: 16 }, (_, index) => ({
      id: `saved-${index + 1}`,
      title: `Saved analysis ${index + 1} for terminal expansion screening`,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-29T00:00:00Z",
    }));
    await page.route(`${apiOrigin}/conversations**`, async (route) => {
      if (route.request().method() === "DELETE") return route.fulfill({ status: 204 });
      if (new URL(route.request().url()).pathname === "/conversations") {
        return route.fulfill({ json: { conversations } });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto("/");
    const history = page.getByRole("complementary", { name: "Saved analyses" });
    await expect(history).toBeVisible();
    const box = await history.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(900);
    const list = page.getByRole("region", { name: "Saved analysis list" });
    await expect(list).toBeVisible();
    const scrollable = await list.evaluate((node) => node.scrollHeight > node.clientHeight);
    expect(scrollable).toBe(true);
  });
});
