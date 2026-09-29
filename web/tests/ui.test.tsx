import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/components/motion/MotionAsset", () => ({
  MotionAsset: () => null,
}));

import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Evidence } from "@/features/chat/evidence";
import { LlmProviderToggle, useLlmProvider } from "@/features/chat/LlmProviderToggle";
import { MarkdownAnswer } from "@/features/chat/MarkdownAnswer";
import { FooterSources } from "@/features/auth/ProtectedApp";
import { Workspace } from "@/features/chat/Workspace";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { apiFetch } from "@/lib/api/client";

describe("interface primitives", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi
        .fn()
        .mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("persists an explicit dark theme", async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
    expect(localStorage.getItem("airport-intelligence-theme")).toBe("dark");
  });

  it("focuses the safe dialog action and closes with Escape", async () => {
    const cancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete this analysis?"
        description="This cannot be undone."
        onCancel={cancel}
        onConfirm={vi.fn()}
      />,
    );
    const safeAction = screen.getByRole("button", { name: "Keep analysis" });
    await waitFor(() => expect(safeAction).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("renders ranking score-component columns from the payload", () => {
    render(
      <Evidence
        response={{
          answer: "Ranking",
          intent: "ranking",
          ai_status: "generated",
          assumptions: [],
          conversation_id: "c",
          message_id: "m",
          user_message_id: "u",
          evidence: {
            ranking: [
              {
                airport: { code: "BOS", name: "Boston Logan" },
                score: 70.4,
                components: {
                  passenger_growth: 76.7,
                  departure_delay: 71.0,
                  cancellation: 37.5,
                  activity_scale: 96.8,
                },
              },
            ],
          },
        }}
      />,
    );
    const table = screen.getByRole("table", { name: "0–100 score components" });
    expect(table).toHaveTextContent("Growth");
    expect(table).toHaveTextContent("Delay");
    expect(table).toHaveTextContent("Cancel");
    expect(table).toHaveTextContent("Activity");
    expect(table).toHaveTextContent("76.7");
    expect(table).toHaveTextContent("71");
    expect(table).toHaveTextContent("37.5");
    expect(table).toHaveTextContent("96.8");
    expect(table).toHaveTextContent("70.4/100");
    expect(table).not.toHaveTextContent("Delayed");
  });

  it("renders metric component tiles and a compare component readout", () => {
    render(
      <Evidence
        response={{
          answer: "Metrics",
          intent: "metrics",
          ai_status: "generated",
          assumptions: [],
          conversation_id: "c",
          message_id: "m",
          user_message_id: "u",
          evidence: {
            airport: { code: "BOS", name: "Boston Logan" },
            metrics: {
              departure_delay_rate_pct: 24.2,
              cancellation_rate_pct: 1.5,
              reported_departures: 150000,
            },
            expansion_opportunity: {
              score: 70.4,
              components: {
                passenger_growth: 76.7,
                departure_delay: 71.0,
                cancellation: 37.5,
                activity_scale: 96.8,
              },
            },
          },
        }}
      />,
    );
    expect(screen.getByText("0–100 score components")).toBeInTheDocument();
    expect(screen.getByText("Growth")).toBeInTheDocument();
    expect(screen.getByText("76.7")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("96.8")).toBeInTheDocument();
  });

  it("renders a compare component readout without replacing delay bars", () => {
    render(
      <Evidence
        response={{
          answer: "Comparison",
          intent: "compare",
          ai_status: "generated",
          assumptions: [],
          conversation_id: "c",
          message_id: "m",
          user_message_id: "u",
          evidence: {
            airports: [
              {
                airport: { code: "LAX", name: "Los Angeles" },
                metrics: {
                  departure_delay_rate_pct: 27,
                  cancellation_rate_pct: 2,
                  average_taxi_out_minutes: 18,
                  reported_departures: 12345,
                },
                expansion_opportunity: {
                  score: 64.2,
                  components: {
                    passenger_growth: 50.1,
                    departure_delay: 80.2,
                    cancellation: 40,
                    activity_scale: 90,
                  },
                },
              },
            ],
          },
        }}
      />,
    );
    expect(
      screen.getByText(/Screen 64.2\/100 — growth 50.1 · delay 80.2 · cancel 40.0 · activity 90.0/),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "LAX delayed departures: 27" })).toBeInTheDocument();
  });

  it("renders exact comparison values as bars and a table", () => {
    render(
      <Evidence
        response={{
          answer: "Comparison",
          intent: "compare",
          ai_status: "generated",
          assumptions: [],
          conversation_id: "c",
          message_id: "m",
          user_message_id: "u",
          evidence: {
            airports: [
              {
                airport: { code: "LAX", name: "Los Angeles" },
                metrics: {
                  departure_delay_rate_pct: 27,
                  cancellation_rate_pct: 2,
                  average_taxi_out_minutes: 18,
                  reported_departures: 12345,
                },
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "LAX delayed departures: 27" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Airport comparison values" })).toHaveTextContent("12,345");
  });

  it("shows a readable label when the model rewrite falls back", () => {
    render(
      <Evidence
        response={{
          answer: "Comparison",
          intent: "compare",
          ai_status: "fallback:unavailable:HTTPStatusError",
          llm_provider: "groq",
          assumptions: [],
          conversation_id: "c",
          message_id: "m",
          user_message_id: "u",
          evidence: {
            airports: [
              {
                airport: { code: "LAX", name: "Los Angeles" },
                metrics: {
                  departure_delay_rate_pct: 27,
                  cancellation_rate_pct: 1,
                  reported_departures: 12345,
                },
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText(/fallback · model unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/HTTPStatusError/i)).not.toBeInTheDocument();
  });

  it("renders a partial chat payload without throwing", () => {
    expect(() =>
      render(
        <Evidence
          response={
            {
              answer: "Partial answer.",
              intent: "unknown",
              conversation_id: "c",
              message_id: "m",
              user_message_id: "u",
            } as never
          }
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText(/did not include a supported evidence visualization/)).toBeInTheDocument();
  });

  it("persists the composer Groq/Gemini choice in sessionStorage", () => {
    function Harness() {
      const [value, setValue] = useLlmProvider();
      return (
        <MotionProvider>
          <LlmProviderToggle value={value} onChange={setValue} />
        </MotionProvider>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Gemini" }));
    expect(sessionStorage.getItem("airport-intelligence-llm-provider")).toBe("gemini");
    expect(screen.getByRole("button", { name: "Gemini" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the selected language-model name on evidence", () => {
    render(
      <Evidence
        response={{
          answer: "Comparison",
          intent: "compare",
          ai_status: "generated",
          llm_provider: "gemini",
          assumptions: [],
          conversation_id: "c",
          message_id: "m",
          user_message_id: "u",
          evidence: {
            airports: [
              {
                airport: { code: "LAX", name: "Los Angeles" },
                metrics: { departure_delay_rate_pct: 27, cancellation_rate_pct: 2, reported_departures: 1 },
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText(/Gemini/)).toBeInTheDocument();
  });

  it("posts the selected llm_provider when Send is clicked", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path === "/conversations") return { conversations: [] };
      if (path === "/chat") {
        return {
          answer: "Boston Logan International Airport recorded delayed departures in the observation window.",
          intent: "metrics",
          ai_status: "generated",
          llm_provider: "gemini",
          assumptions: [],
          conversation_id: "c",
          message_id: "m",
          user_message_id: "u",
          evidence: {
            airport: { code: "BOS", name: "Boston Logan" },
            metrics: { departure_delay_rate_pct: 18, cancellation_rate_pct: 2, reported_departures: 1 },
          },
        };
      }
      return {};
    });

    render(
      <MotionProvider>
        <Workspace
          accessToken="token"
          onUnauthorized={vi.fn()}
          historyOpen={false}
          onHistoryOpenChange={vi.fn()}
          onActiveChange={vi.fn()}
        />
      </MotionProvider>,
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/conversations", "token"));
    fireEvent.click(screen.getByRole("button", { name: "Gemini" }));
    fireEvent.change(screen.getByLabelText(/Ask about an airport/), { target: { value: "metrics for BOS" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));

    await waitFor(() => {
      const chatCall = vi.mocked(apiFetch).mock.calls.find((call) => call[0] === "/chat");
      expect(chatCall).toBeTruthy();
      const body = JSON.parse(String((chatCall?.[2] as RequestInit).body));
      expect(body).toMatchObject({ message: "metrics for BOS", llm_provider: "gemini" });
    });
  });

  it("exposes the full saved analysis question for hover", async () => {
    const title = "Which New England airports are the strongest candidates for a terminal expansion this decade?";
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path === "/conversations") {
        return {
          conversations: [
            {
              id: "saved-1",
              title,
              created_at: "2026-09-01T00:00:00Z",
              updated_at: "2026-09-29T12:00:00Z",
            },
          ],
        };
      }
      return { conversations: [] };
    });

    render(
      <MotionProvider>
        <Workspace
          accessToken="token"
          onUnauthorized={vi.fn()}
          historyOpen={false}
          onHistoryOpenChange={vi.fn()}
          onActiveChange={vi.fn()}
        />
      </MotionProvider>,
    );

    const open = await screen.findByTitle(title);
    expect(open).toHaveAttribute("title", title);
    expect(open).toHaveTextContent(title);
  });

  it("turns Groq-escaped newlines into memo headings", () => {
    render(
      <MarkdownAnswer
        markdown={
          "Direct answer:\\nBOS, PWM, and PVD lead.\\n\\nEvidence and method:\\n- BOS 70.4 (growth 76.7, delay 71.0, cancel 37.5, activity 98.7)\\n\\nConclusion:\\nScreening only."
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Direct answer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evidence and method" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Conclusion" })).toBeInTheDocument();
    expect(screen.getByText(/BOS, PWM, and PVD lead/)).toBeInTheDocument();
    expect(screen.queryByText(/\\n/)).not.toBeInTheDocument();
  });

  it("strips Groq semicolon leftovers after memo headings", () => {
    render(
      <MarkdownAnswer
        markdown={
          "Direct answer; BOS, PWM, and PVD lead.\n\nEvidence and method; Weights applied.\n\nConclusion; Screening only."
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Direct answer" })).toBeInTheDocument();
    expect(screen.getByText(/BOS, PWM, and PVD lead/)).toBeInTheDocument();
    expect(screen.queryByText(/; BOS/)).not.toBeInTheDocument();
  });

  it("renders assistant markdown headings and lists without raw markers", () => {
    render(
      <MarkdownAnswer
        markdown={
          "## Direct answer\n\nBOS leads the screen.\n\n## Evidence and method\n\n- **BOS** scored 70.4\n\n## Conclusion\n\nScreening only."
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Direct answer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evidence and method" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("BOS scored 70.4");
    expect(screen.queryByText("## Direct answer")).not.toBeInTheDocument();
  });

  it("links footer sources to the public datasets", () => {
    render(<FooterSources />);
    expect(screen.getByRole("link", { name: "BTS" })).toHaveAttribute(
      "href",
      "https://www.transtats.bts.gov/Fields.asp?gnoyr_VQ=FGJ",
    );
    expect(screen.getByRole("link", { name: "FAA" })).toHaveAttribute(
      "href",
      "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger",
    );
    expect(screen.getByRole("link", { name: "NOAA" })).toHaveAttribute("href", "https://aviationweather.gov/");
    expect(screen.getByRole("link", { name: "Census" })).toHaveAttribute(
      "href",
      "https://www.census.gov/programs-surveys/acs.html",
    );
    expect(screen.getByRole("link", { name: "BLS" })).toHaveAttribute("href", "https://www.bls.gov/");
  });
});
