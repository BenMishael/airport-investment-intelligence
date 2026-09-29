import { expect, test } from "@playwright/test";

import { apiOrigin, comparisonResponse, installSession, mockConversations, supabaseOrigin } from "./support";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "Behavioral checks are viewport independent.");
});

test.describe("authentication failures", () => {
  test("a rate-limited code request is reported instead of claiming a code was sent", async ({ page }) => {
    await page.route(`${supabaseOrigin}/auth/v1/otp**`, (route) =>
      route.fulfill({
        status: 429,
        json: { code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" },
      }),
    );
    await page.goto("/");
    await page.getByLabel("Email address").fill("reviewer@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();

    await expect(page.getByRole("alert").filter({ hasText: /try again/i })).toBeVisible();
    await expect(page.getByText(/code is on its way/)).toBeHidden();
  });

  test("an unknown email still receives the generic confirmation", async ({ page }) => {
    await page.route(`${supabaseOrigin}/auth/v1/otp**`, (route) =>
      route.fulfill({
        status: 422,
        json: { code: 422, error_code: "otp_disabled", msg: "Signups not allowed for otp" },
      }),
    );
    await page.goto("/");
    await page.getByLabel("Email address").fill("stranger@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();

    await expect(page.getByText("If this email is authorized, an eight-digit code is on its way.")).toBeVisible();
    await expect(page.getByLabel("Eight-digit code")).toBeFocused();
  });

  test("an expired session explains why the user was signed out", async ({ page }) => {
    await installSession(page);
    await page.route(`${apiOrigin}/conversations`, (route) =>
      route.fulfill({
        status: 401,
        json: { error: { code: "unauthorized", message: "The session is invalid or expired" } },
      }),
    );
    await page.route(`${supabaseOrigin}/auth/v1/logout**`, (route) => route.fulfill({ status: 204 }));
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Airport intelligence/ })).toBeVisible();
    await expect(page.getByText(/session (has )?expired/i)).toBeVisible();
  });

  test("a revoked account sees an access message instead of an empty history", async ({ page }) => {
    await installSession(page);
    await page.route(`${apiOrigin}/conversations`, (route) =>
      route.fulfill({ status: 403, json: { error: { code: "forbidden", message: "This account is not authorized" } } }),
    );
    await page.goto("/");

    await expect(page.getByText(/not authorized|access (has been )?(revoked|removed)/i).first()).toBeVisible();
    await expect(page.getByText("No saved analyses yet.")).toBeHidden();
  });
});

test.describe("analysis failures", () => {
  test("a dropped connection can be retried without retyping the question", async ({ page }) => {
    await installSession(page);
    await mockConversations(page);
    let attempts = 0;
    await page.route(`${apiOrigin}/chat`, (route) => {
      attempts += 1;
      return attempts === 1 ? route.abort("internetdisconnected") : route.fulfill({ json: comparisonResponse });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
    await expect(page.getByText("Analysis unavailable")).toBeVisible();

    await page.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByText(comparisonResponse.answer, { exact: true })).toBeVisible();
    await expect(
      page.getByText("Compare Los Angeles and Santa Ana airport congestion levels.", { exact: true }),
    ).toHaveCount(1);
    await expect(page.getByText("Analysis unavailable")).toBeHidden();
  });

  test("a dropped connection is described in plain language", async ({ page }) => {
    await installSession(page);
    await mockConversations(page);
    await page.route(`${apiOrigin}/chat`, (route) => route.abort("internetdisconnected"));
    await page.goto("/");
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();

    const alert = page.getByRole("region", { name: "Airport analysis conversation" }).getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText("Failed to fetch");
  });

  test("the header connection status reflects an offline browser", async ({ page, context }) => {
    await installSession(page);
    await mockConversations(page);
    await page.goto("/");
    await expect(page.locator("header").getByText("Evidence connected")).toBeVisible();
    await context.setOffline(true);

    await expect(page.locator("header").getByText("Evidence connected")).toBeHidden();
    await context.setOffline(false);
  });
});

test.describe("history", () => {
  test("history is refreshed once after an answer", async ({ page }) => {
    await installSession(page);
    const calls = await mockConversations(page);
    await page.route(`${apiOrigin}/chat`, (route) => route.fulfill({ json: comparisonResponse }));
    await page.goto("/");
    await expect(page.getByText("No saved analyses yet.")).toBeVisible();
    const beforeAnswer = calls.length;

    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
    await expect(page.getByText(comparisonResponse.answer, { exact: true })).toBeVisible();
    await page.waitForTimeout(500);

    expect(calls.length - beforeAnswer).toBe(1);
  });

  test("a single saved analysis uses singular wording", async ({ page }) => {
    await installSession(page);
    await mockConversations(page, true);
    await page.goto("/");

    await expect(page.getByText("1 analysis", { exact: true })).toBeVisible();
  });
});
