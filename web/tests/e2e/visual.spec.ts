import { expect, Page, test, TestInfo } from "@playwright/test";

const modes = [
  { name: "light", colorScheme: "light" as const, reducedMotion: "no-preference" as const },
  { name: "dark", colorScheme: "dark" as const, reducedMotion: "no-preference" as const },
  { name: "reduced", colorScheme: "light" as const, reducedMotion: "reduce" as const },
];

async function setMode(page: Page, mode: (typeof modes)[number]) {
  await page.emulateMedia({ colorScheme: mode.colorScheme, reducedMotion: mode.reducedMotion });
  await page.evaluate((preference) => {
    localStorage.setItem("airport-intelligence-theme", preference);
    document.documentElement.dataset.theme = preference;
  }, mode.colorScheme);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
}

async function installSession(page: Page) {
  await page.addInitScript(() => {
    const encode = (value: object) =>
      btoa(JSON.stringify(value)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
    const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "visual-user", email: "reviewer@example.com", role: "authenticated", aud: "authenticated", exp: 4102444800 })}.visual`;
    sessionStorage.setItem(
      "sb-visual-test-auth-token",
      JSON.stringify({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: 4102444800,
        refresh_token: "visual-refresh",
        user: {
          id: "visual-user",
          aud: "authenticated",
          role: "authenticated",
          email: "reviewer@example.com",
          email_confirmed_at: "2026-01-01T00:00:00Z",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-01-01T00:00:00Z",
        },
      }),
    );
  });
}

async function startNewAnalysis(page: Page) {
  const button = page.getByRole("button", { name: "New analysis" });
  if (!(await button.isVisible())) {
    await page.getByRole("button", { name: "Open analysis history" }).click();
  }
  await button.click();
}

test("captures authentication states", async ({ page }, testInfo) => {
  await page.route("https://visual-test.supabase.co/auth/v1/otp**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  for (const mode of modes) {
    await page.goto("/");
    await setMode(page, mode);
    await expect(page.getByRole("heading", { name: /Airport intelligence/ })).toBeVisible();
    await capture(page, testInfo, `auth-email-${mode.name}`);
    await page.getByLabel("Email address").fill("reviewer@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await expect(page.getByLabel("Eight-digit code")).toBeFocused();
    await capture(page, testInfo, `auth-otp-${mode.name}`);
  }
});

test("captures workspace, loading, comparison, ranking, error, and persisted states", async ({ page }, testInfo) => {
  await installSession(page);
  let conversations = [
    {
      id: "saved-1",
      title: "Saved airport comparison",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-29T00:00:00Z",
    },
  ];
  await page.route("http://localhost:8000/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/conversations" && route.request().method() === "GET")
      return route.fulfill({ json: { conversations } });
    if (url.pathname === "/conversations/saved-1")
      return route.fulfill({
        json: {
          ...conversations[0],
          messages: [
            { id: "u1", role: "user", content: "Compare LAX and SNA", created_at: "2026-09-29T00:00:00Z" },
            {
              id: "a1",
              role: "assistant",
              content: "LAX has the higher observed operational pressure.",
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
              },
              created_at: "2026-09-29T00:00:00Z",
            },
          ],
        },
      });
    if (url.pathname === "/chat") {
      const body = route.request().postDataJSON() as { message: string };
      if (body.message.includes("unavailable"))
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "provider_unavailable",
              message: "Provider evidence is temporarily unavailable.",
              request_id: "visual-request",
            },
          },
        });
      await new Promise((resolve) => setTimeout(resolve, 450));
      const ranking = body.message.includes("New England")
        ? [
            { airport: { code: "BOS", name: "Boston Logan" }, score: 82, metrics: { departure_delay_rate_pct: 24 } },
            {
              airport: { code: "BDL", name: "Bradley International" },
              score: 74,
              metrics: { departure_delay_rate_pct: 16 },
            },
          ]
        : undefined;
      const airports = ranking
        ? undefined
        : [
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
          ];
      return route.fulfill({
        json: {
          answer: "The evidence indicates a measurable difference in operational pressure.",
          intent: ranking ? "ranking" : "comparison",
          ai_status: "generated",
          evidence: {
            ranking,
            airports,
            sources: [{ id: "faa", name: "FAA public data", url: "https://faa.gov", observed: "2024" }],
          },
          assumptions: ["The comparison uses the available annual snapshot."],
          conversation_id: "visual-conversation",
          message_id: "assistant-1",
          user_message_id: "user-1",
        },
      });
    }
    if (route.request().method() === "DELETE") {
      conversations = [];
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: {} });
  });

  for (const mode of modes) {
    await page.goto("/");
    await setMode(page, mode);
    await expect(page.getByRole("heading", { name: /See airport opportunity/ })).toBeVisible();
    await capture(page, testInfo, `workspace-empty-${mode.name}`);
    const comparisonPrompt = page.getByRole("button", { name: /Compare Los Angeles/ });
    await comparisonPrompt.click();
    await expect(page.getByText("Checking the evidence")).toBeVisible();
    await capture(page, testInfo, `workspace-loading-${mode.name}`);
    await expect(page.getByRole("heading", { name: "Operational pressure" })).toBeVisible();
    await capture(page, testInfo, `workspace-comparison-${mode.name}`);
    await startNewAnalysis(page);
    await page.getByRole("button", { name: /New England/ }).click();
    await expect(page.getByRole("heading", { name: "Opportunity score" })).toBeVisible();
    await capture(page, testInfo, `workspace-ranking-${mode.name}`);
    await startNewAnalysis(page);
    await page.getByLabel(/Ask about an airport/).fill("Show unavailable provider state");
    await page.getByRole("button", { name: "Send question" }).click();
    await expect(page.getByText("Analysis unavailable")).toBeVisible();
    await capture(page, testInfo, `workspace-error-${mode.name}`);
    if (await page.getByRole("button", { name: "Open analysis history" }).isVisible())
      await page.getByRole("button", { name: "Open analysis history" }).click();
    await page.getByRole("button", { name: /^Saved airport comparison/ }).click();
    await expect(page.getByText("LAX has the higher observed operational pressure.")).toBeVisible();
    await capture(page, testInfo, `workspace-persisted-${mode.name}`);
  }
});
