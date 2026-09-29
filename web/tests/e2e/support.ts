import { Page } from "@playwright/test";

export const email = "reviewer@example.com";
export const apiOrigin = "http://localhost:8000";
export const supabaseOrigin = "https://visual-test.supabase.co";

function encodeJwtPart(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export async function installSession(page: Page) {
  const accessToken = `${encodeJwtPart({ alg: "HS256", typ: "JWT" })}.${encodeJwtPart({
    sub: "e2e-user",
    email,
    role: "authenticated",
    aud: "authenticated",
    exp: 4102444800,
  })}.e2e`;
  await page.addInitScript(
    ({ accessToken, email }) => {
      sessionStorage.setItem(
        "sb-visual-test-auth-token",
        JSON.stringify({
          access_token: accessToken,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: 4102444800,
          refresh_token: "e2e-refresh",
          user: {
            id: "e2e-user",
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

export const savedConversation = {
  id: "saved-1",
  title: "Saved airport comparison",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-29T00:00:00Z",
};

export async function mockConversations(page: Page, withSavedConversation = false) {
  const calls: string[] = [];
  await page.route(`${apiOrigin}/conversations**`, async (route) => {
    const target = new URL(route.request().url());
    calls.push(`${route.request().method()} ${target.pathname}`);
    if (route.request().method() === "DELETE") return route.fulfill({ status: 204 });
    if (target.pathname === "/conversations") {
      return route.fulfill({ json: { conversations: withSavedConversation ? [savedConversation] : [] } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return calls;
}

export const comparisonResponse = {
  answer: "The evidence indicates a measurable difference in operational pressure.",
  intent: "comparison",
  ai_status: "generated",
  evidence: {
    airports: [
      {
        airport: { code: "LAX", name: "Los Angeles International" },
        metrics: {
          departure_delay_rate_pct: 22.9,
          cancellation_rate_pct: 1.2,
          average_taxi_out_minutes: 19.6,
          reported_departures: 297400,
        },
      },
      {
        airport: { code: "SNA", name: "John Wayne Airport" },
        metrics: {
          departure_delay_rate_pct: 19.2,
          cancellation_rate_pct: 0.8,
          average_taxi_out_minutes: 14.2,
          reported_departures: 95400,
        },
      },
    ],
    sources: [
      {
        id: "bts-otp",
        name: "BTS Reporting Carrier On-Time Performance",
        url: "https://www.transtats.bts.gov",
        observed: "2024-01-01/2024-12-31",
      },
      {
        id: "faa-cy",
        name: "FAA CY 2024 Passenger Boarding Data",
        url: "https://www.faa.gov",
        observed: "2024-01-01/2024-12-31",
      },
    ],
  },
  assumptions: ["Metrics use the checked-in 2024 aggregate snapshot."],
  conversation_id: "e2e-conversation",
  message_id: "assistant-1",
  user_message_id: "user-1",
};

export async function documentOverflowX(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
