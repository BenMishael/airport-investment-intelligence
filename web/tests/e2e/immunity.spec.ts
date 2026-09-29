import { expect, Page, Route, test } from "@playwright/test";

import {
  apiOrigin,
  comparisonResponse,
  installSession,
  mockConversations,
  savedConversation,
  supabaseOrigin,
} from "./support";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "Failure handling is viewport independent.");
});

type Reply = (route: Route) => Promise<void>;

const envelope = (status: number) => ({
  status,
  json: { error: { code: `http_${status}`, message: `Service returned ${status}.`, request_id: `immunity-${status}` } },
});

const statusReplies: Array<[string, Reply]> = [400, 404, 409, 422, 429, 500, 502, 503, 504].map((status) => [
  `HTTP ${status}`,
  (route) => route.fulfill(envelope(status)),
]);

const bodyReplies: Array<[string, Reply]> = [
  ["empty 200 body", (route) => route.fulfill({ status: 200, body: "" })],
  ["HTML 200 body", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html>Gateway</html>" })],
  [
    "truncated JSON",
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"answer": "tr' }),
  ],
  ["HTML 502 body", (route) => route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" })],
  ["aborted response", (route) => route.abort("aborted")],
  ["connection refused", (route) => route.abort("connectionrefused")],
];

const rawTransportText =
  /TypeError|SyntaxError|Unexpected (token|end)|JSON|Unterminated|at position \d+|Failed to fetch|NetworkError|undefined|\[object/;

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openWorkspace(page: Page, withSavedConversation = false) {
  await installSession(page);
  await mockConversations(page, withSavedConversation);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See airport opportunity/ })).toBeVisible();
}

async function expectWorkspaceOperable(page: Page, errors: string[]) {
  await expect(page.getByRole("heading", { name: /See airport opportunity/ })).toBeVisible();
  await expect(page.getByLabel(/Ask about an airport/)).toBeEnabled();
  expect(errors).toEqual([]);
}

test.describe("chat request failures", () => {
  for (const [name, reply] of [...statusReplies, ...bodyReplies]) {
    test(`chat ${name} keeps the workspace operable with a readable alert`, async ({ page }) => {
      const errors = watchErrors(page);
      await openWorkspace(page);
      await page.route(`${apiOrigin}/chat`, reply);
      await page.getByRole("button", { name: /Compare Los Angeles/ }).click();

      const alert = page.getByRole("region", { name: "Airport analysis conversation" }).getByRole("alert");
      await expect(alert).toBeVisible();
      await expect(
        page.getByText("Compare Los Angeles and Santa Ana airport congestion levels.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();
      expect(await alert.textContent()).not.toMatch(rawTransportText);
      await expectWorkspaceOperable(page, errors);
    });
  }

  test("chat 200 response missing required fields does not crash the workspace", async ({ page }) => {
    const errors = watchErrors(page);
    await openWorkspace(page);
    await page.route(`${apiOrigin}/chat`, (route) => route.fulfill({ json: { answer: "Partial answer." } }));
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();

    await expect(page.getByText("Partial answer.", { exact: true })).toBeVisible();
    await expectWorkspaceOperable(page, errors);
  });

  test("chat 200 response with wrong field types renders without inventing values", async ({ page }) => {
    const errors = watchErrors(page);
    await openWorkspace(page);
    await page.route(`${apiOrigin}/chat`, (route) =>
      route.fulfill({
        json: {
          ...comparisonResponse,
          evidence: {
            airports: "LAX,SNA",
            ranking: { code: "BOS" },
            metrics: "fast",
            sources: [{ id: 1 }, null, "faa"],
          },
        },
      }),
    );
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();

    await expect(page.getByText(comparisonResponse.answer, { exact: true })).toBeVisible();
    await expect(page.getByText(/did not include a supported evidence visualization/)).toBeVisible();
    await expectWorkspaceOperable(page, errors);
  });

  test("a hung chat request eventually times out with a retry", async ({ page }) => {
    await openWorkspace(page);
    await page.clock.install();
    await page.route(`${apiOrigin}/chat`, () => new Promise(() => undefined));
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
    await expect(page.getByText("Checking the evidence")).toBeVisible();
    await page.clock.fastForward("02:00");

    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 5_000 });
  });

  test("a five-second chat delay keeps the composer locked and then completes", async ({ page }) => {
    await openWorkspace(page);
    await page.route(`${apiOrigin}/chat`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return route.fulfill({ json: comparisonResponse });
    });
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
    await expect(page.getByText("Checking the evidence")).toBeVisible();
    await expect(page.getByLabel(/Ask about an airport/)).toBeDisabled();

    await expect(page.getByText(comparisonResponse.answer, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/Ask about an airport/)).toBeEnabled();
  });
});

test.describe("history request failures", () => {
  const listReplies: Array<[string, Reply, string | undefined]> = [
    ["HTTP 500", (route) => route.fulfill(envelope(500)), undefined],
    ["empty object", (route) => route.fulfill({ json: {} }), "Known defect: conversations is assumed to be an array."],
    [
      "null conversations",
      (route) => route.fulfill({ json: { conversations: null } }),
      "Known defect: conversations is assumed to be an array.",
    ],
    [
      "truncated JSON",
      (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{" }),
      undefined,
    ],
    ["connection refused", (route) => route.abort("connectionrefused"), undefined],
  ];

  for (const [name, reply] of listReplies) {
    test(`history list ${name} does not crash the workspace`, async ({ page }) => {
      const errors = watchErrors(page);
      await installSession(page);
      let served = false;
      await page.route(`${apiOrigin}/conversations`, async (route) => {
        await reply(route);
        served = true;
      });
      await page.goto("/");
      await expect.poll(() => served).toBe(true);
      await page.waitForTimeout(300);

      await expect(page.getByRole("complementary", { name: "Saved analyses" })).toBeVisible();
      await expectWorkspaceOperable(page, errors);
    });
  }

  test("a failed history load is distinguishable from an empty history", async ({ page }) => {
    await installSession(page);
    await page.route(`${apiOrigin}/conversations`, (route) => route.fulfill(envelope(500)));
    await page.goto("/");
    await expect(page.getByText("Loading saved analyses…")).toBeHidden();

    await expect(
      page.getByRole("complementary", { name: "Saved analyses" }).getByText("No saved analyses yet."),
    ).toBeHidden();
    await expect(
      page.getByRole("complementary", { name: "Saved analyses" }).getByText(/could not load|unavailable/i),
    ).toBeVisible();
  });

  const detailReplies: Array<[string, Reply, string | undefined]> = [
    ["HTTP 404", (route) => route.fulfill(envelope(404)), undefined],
    ["HTTP 500", (route) => route.fulfill(envelope(500)), undefined],
    [
      "missing messages",
      (route) => route.fulfill({ json: { ...savedConversation } }),
      "Known defect: detail.messages is mapped without a guard; the TypeError text is shown.",
    ],
    [
      "evidence as a string",
      (route) =>
        route.fulfill({
          json: {
            ...savedConversation,
            messages: [
              { id: "u", role: "user", content: "Q", created_at: "2026-09-29T00:00:00Z" },
              { id: "a", role: "assistant", content: "A", evidence: "corrupt", created_at: "2026-09-29T00:00:00Z" },
            ],
          },
        }),
      undefined,
    ],
  ];

  for (const [name, reply] of detailReplies) {
    test(`opening a saved analysis with ${name} stays operable and readable`, async ({ page }) => {
      const errors = watchErrors(page);
      await installSession(page);
      await page.route(`${apiOrigin}/conversations`, (route) =>
        route.fulfill({ json: { conversations: [savedConversation] } }),
      );
      await page.route(`${apiOrigin}/conversations/${savedConversation.id}`, reply);
      await page.goto("/");
      await page.getByRole("button", { name: new RegExp(`^${savedConversation.title}`) }).click();
      await page.waitForTimeout(500);

      const alert = page.getByRole("region", { name: "Airport analysis conversation" }).getByRole("alert");
      if (await alert.isVisible()) expect(await alert.textContent()).not.toMatch(rawTransportText);
      await expectWorkspaceOperable(page, errors);
    });
  }

  for (const [name, reply] of [
    ["HTTP 500", (route: Route) => route.fulfill(envelope(500))],
    ["connection refused", (route: Route) => route.abort("connectionrefused")],
  ] as Array<[string, Reply]>) {
    test(`a delete ${name} keeps the analysis listed and explains the failure`, async ({ page }) => {
      const errors = watchErrors(page);
      await installSession(page);
      await page.route(`${apiOrigin}/conversations**`, (route) =>
        route.request().method() === "DELETE"
          ? reply(route)
          : route.fulfill({ json: { conversations: [savedConversation] } }),
      );
      await page.goto("/");
      await page.getByRole("button", { name: `Delete ${savedConversation.title}` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

      await expect(
        page.getByRole("region", { name: "Airport analysis conversation" }).getByRole("alert"),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: new RegExp(`^${savedConversation.title}`) })).toBeVisible();
      await expectWorkspaceOperable(page, errors);
    });
  }
});

test.describe("authentication request failures", () => {
  const otpReplies: Array<[string, Reply]> = [
    ["HTTP 500", (route) => route.fulfill({ status: 500, json: { msg: "Internal error" } })],
    [
      "HTTP 502 HTML",
      (route) => route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" }),
    ],
    ["connection refused", (route) => route.abort("connectionrefused")],
  ];

  for (const [name, reply] of otpReplies) {
    test(`code request ${name} is not reported as a sent code`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.route(`${supabaseOrigin}/auth/v1/otp**`, reply);
      await page.goto("/");
      await page.getByLabel("Email address").fill("reviewer@example.com");
      await page.getByRole("button", { name: "Send sign-in code" }).click();

      await expect(page.getByText(/code is on its way/)).toBeHidden();
      await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeEnabled();
      expect(errors).toEqual([]);
    });
  }

  for (const [name, reply] of otpReplies) {
    test(`code verification ${name} is not reported as an invalid code`, async ({ page }) => {
      await page.route(`${supabaseOrigin}/auth/v1/otp**`, (route) => route.fulfill({ json: {} }));
      await page.route(`${supabaseOrigin}/auth/v1/verify**`, reply);
      await page.goto("/");
      await page.getByLabel("Email address").fill("reviewer@example.com");
      await page.getByRole("button", { name: "Send sign-in code" }).click();
      await page.getByLabel("Eight-digit code").fill("12345678");
      await page.getByRole("button", { name: "Open workspace" }).click();

      await expect(page.getByText(/connection|could not be verified|try again/i)).toBeVisible();
      await expect(page.getByText(/invalid or expired/)).toBeHidden();
    });
  }
});

test.describe("secret handling", () => {
  test("access tokens never appear in page text or console output during failures", async ({ page }) => {
    const consoleText: string[] = [];
    page.on("console", (message) => consoleText.push(message.text()));
    await openWorkspace(page);
    const token = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("sb-visual-test-auth-token") || "{}").access_token as string,
    );
    await page.route(`${apiOrigin}/chat`, (route) => route.fulfill(envelope(500)));
    await page.getByRole("button", { name: /Compare Los Angeles/ }).click();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    expect(token.length).toBeGreaterThan(20);
    expect(await page.locator("body").innerText()).not.toContain(token);
    expect(consoleText.join("\n")).not.toContain(token);
    expect(page.url()).not.toContain(token);
  });
});
