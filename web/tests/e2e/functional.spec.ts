import { expect, Page, test } from "@playwright/test";

const email = "reviewer@example.com";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "This suite runs its own responsive viewport matrix.");
});

function encodeJwtPart(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function installSession(page: Page) {
  const accessToken = `${encodeJwtPart({ alg: "HS256", typ: "JWT" })}.${encodeJwtPart({
    sub: "functional-user",
    email,
    role: "authenticated",
    aud: "authenticated",
    exp: 4102444800,
  })}.functional`;
  await page.addInitScript(
    ({ accessToken, email }) => {
      sessionStorage.setItem(
        "sb-visual-test-auth-token",
        JSON.stringify({
          access_token: accessToken,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: 4102444800,
          refresh_token: "functional-refresh",
          user: {
            id: "functional-user",
            aud: "authenticated",
            role: "authenticated",
            email,
            email_confirmed_at: "2026-01-01T00:00:00Z",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          },
        }),
      );
    },
    { accessToken, email },
  );
}

async function mockConversations(page: Page, withSavedConversation = false) {
  await page.route("http://localhost:8000/conversations**", async (route) => {
    const target = route.request().url();
    if (route.request().method() === "DELETE") return route.fulfill({ status: 204 });
    if (target.endsWith("/conversations")) {
      return route.fulfill({
        json: {
          conversations: withSavedConversation
            ? [
                {
                  id: "saved-1",
                  title: "Saved airport comparison",
                  created_at: "2026-09-01T00:00:00Z",
                  updated_at: "2026-09-29T00:00:00Z",
                },
              ]
            : [],
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
}

const comparisonResponse = {
  answer: "The evidence indicates a measurable difference in operational pressure.",
  intent: "comparison",
  ai_status: "generated",
  evidence: {
    airports: [
      {
        airport: { code: "LAX", name: "Los Angeles International" },
        metrics: {
          departure_delay_rate_pct: 27,
          cancellation_rate_pct: 2.1,
          average_taxi_out_minutes: 18,
          reported_departures: 12345,
        },
      },
      {
        airport: { code: "SNA", name: "John Wayne" },
        metrics: {
          departure_delay_rate_pct: 18,
          cancellation_rate_pct: 1.2,
          average_taxi_out_minutes: 12,
          reported_departures: 6543,
        },
      },
    ],
    sources: [{ id: "faa", name: "FAA public data", url: "https://faa.gov", observed: "2024" }],
  },
  assumptions: ["The comparison uses the available annual snapshot."],
  conversation_id: "functional-conversation",
  message_id: "assistant-1",
  user_message_id: "user-1",
};

test("authentication keeps invalid-code feedback generic and visible", async ({ page }) => {
  await page.route("https://visual-test.supabase.co/auth/v1/otp**", (route) =>
    route.fulfill({ status: 200, json: {} }),
  );
  await page.route("https://visual-test.supabase.co/auth/v1/verify**", (route) =>
    route.fulfill({ status: 403, json: { error_code: "otp_expired", msg: "Token has expired or is invalid" } }),
  );

  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByLabel("Eight-digit code")).toBeFocused();
  await page.getByLabel("Eight-digit code").fill("00000000");
  await page.getByRole("button", { name: "Open workspace" }).click();

  await expect(
    page.getByText("The code is invalid or expired. Request a new code and try again.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Eight-digit code")).toHaveAttribute("aria-invalid", "true");
});

test("invalid OTP feedback does not produce a Motion runtime error", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  await page.route("https://visual-test.supabase.co/auth/v1/otp**", (route) =>
    route.fulfill({ status: 200, json: {} }),
  );
  await page.route("https://visual-test.supabase.co/auth/v1/verify**", (route) =>
    route.fulfill({ status: 403, json: { error_code: "otp_expired", msg: "Token has expired or is invalid" } }),
  );

  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await page.getByLabel("Eight-digit code").fill("00000000");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByText("The code is invalid or expired. Request a new code and try again.", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(250);

  expect(runtimeErrors.filter((message) => message.includes("Only two keyframes currently supported"))).toEqual([]);
});

test("authentication and workspace avoid horizontal document overflow", async ({ page }) => {
  const viewports = [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 1000 },
  ];
  await page.goto("/");
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `authentication overflow at ${viewport.width}px`,
    ).toBe(true);
  }

  await installSession(page);
  await mockConversations(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See airport opportunity/ })).toBeVisible();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `workspace overflow at ${viewport.width}px`,
    ).toBe(true);
  }
});

test("authenticated email remains visible at the laptop breakpoint", async ({ page }) => {
  await installSession(page);
  await mockConversations(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  await expect(page.getByText(email, { exact: true })).toBeVisible();
});

test("desktop header renders the authenticated email", async ({ page }) => {
  await installSession(page);
  await mockConversations(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  await expect(page.getByText(email, { exact: true })).toBeVisible();
});

test("mobile history drawer traps focus and restores it when closed", async ({ page }) => {
  await installSession(page);
  await mockConversations(page, true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open analysis history" });
  await trigger.click();

  await expect(page.getByRole("button", { name: "Close history" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Delete Saved airport comparison" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Saved analyses" })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("a completed answer starts in view instead of jumping to its final evidence row", async ({ page }) => {
  await installSession(page);
  await mockConversations(page);
  await page.route("http://localhost:8000/chat", (route) => route.fulfill({ json: comparisonResponse }));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
  const answer = page.getByText(comparisonResponse.answer, { exact: true });
  await expect(answer).toBeAttached();
  await page.waitForTimeout(700);

  await expect(answer).toBeInViewport({ ratio: 0.5 });
});

test("Escape closes delete confirmation before the underlying history drawer", async ({ page }) => {
  await installSession(page);
  await mockConversations(page, true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open analysis history" }).click();
  const drawer = page.getByRole("dialog", { name: "Saved analyses" });
  await expect(drawer).toBeVisible();
  await page.getByRole("button", { name: "Delete Saved airport comparison" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(confirmation).toBeHidden();
  await expect(drawer).toBeVisible();
});

test("provider failures retain the question and expose a retry with request ID", async ({ page }) => {
  await installSession(page);
  await mockConversations(page);
  await page.route("http://localhost:8000/chat", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "provider_unavailable",
          message: "Provider evidence is temporarily unavailable.",
          request_id: "functional-request",
        },
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel(/Ask about an airport/).fill("Show unavailable provider state");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Show unavailable provider state", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Airport analysis conversation" }).getByRole("alert")).toContainText(
    "Request ID: functional-request",
  );
  await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();
});

test("an unauthorized API response clears the session and returns to sign-in", async ({ page }) => {
  await installSession(page);
  await page.route("http://localhost:8000/conversations", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "Authentication is required" } } }),
  );
  await page.route("https://visual-test.supabase.co/auth/v1/logout**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Airport intelligence/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).length)).toBe(0);
});

test("sign-out clears the browser session", async ({ page }) => {
  await installSession(page);
  await mockConversations(page);
  await page.route("https://visual-test.supabase.co/auth/v1/logout**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page.getByRole("heading", { name: /Airport intelligence/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).length)).toBe(0);
});
