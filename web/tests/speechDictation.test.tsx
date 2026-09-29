import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/components/motion/MotionAsset", () => ({
  MotionAsset: () => null,
}));

import { MotionProvider } from "@/components/motion/MotionProvider";
import { Workspace } from "@/features/chat/Workspace";
import { joinDictation, QUESTION_MAX_LENGTH, transcriptFromResults } from "@/features/chat/useSpeechDictation";
import { apiFetch } from "@/lib/api/client";
import nextConfig from "../next.config";

class FakeSpeechRecognition {
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  static latest: FakeSpeechRecognition | null = null;

  start() {
    FakeSpeechRecognition.latest = this;
  }

  stop() {
    this.onend?.();
  }

  emit(transcript: string, isFinal: boolean) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript }, isFinal, length: 1 }],
    });
  }
}

function installRecognition() {
  FakeSpeechRecognition.latest = null;
  Object.defineProperty(window, "webkitSpeechRecognition", {
    configurable: true,
    writable: true,
    value: FakeSpeechRecognition,
  });
}

function installMicrophonePermission(
  state: PermissionState,
  getUserMedia: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
) {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state }) },
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return getUserMedia;
}

function uninstallRecognition() {
  FakeSpeechRecognition.latest = null;
  delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
}

function renderWorkspace() {
  return render(
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
}

describe("client voice dictation", () => {
  beforeEach(() => {
    uninstallRecognition();
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path === "/conversations") return { conversations: [] };
      if (path === "/chat") {
        return {
          answer: "BOS leads New England at 70.4.",
          intent: "ranking",
          ai_status: "generated",
          assumptions: [],
          conversation_id: "c",
          message_id: "m",
          user_message_id: "u",
          evidence: {
            ranking: [{ airport: { code: "BOS", name: "Boston Logan" }, score: 70.4 }],
          },
        };
      }
      return {};
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi
        .fn()
        .mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    Element.prototype.scrollIntoView = vi.fn();
    class FakeIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: FakeIntersectionObserver,
    });
    Object.defineProperty(navigator, "permissions", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  });

  afterEach(() => uninstallRecognition());

  it("allows the microphone in Permissions-Policy", async () => {
    const headers = await nextConfig.headers!();
    const policy = headers[0].headers.find((item) => item.key === "Permissions-Policy")?.value;
    expect(policy).toContain("microphone=(self)");
    expect(policy).not.toMatch(/microphone=\(\)/);
    expect(policy).toContain("camera=()");
    expect(policy).toContain("geolocation=()");
  });

  it("clips a dictation transcript to the composer limit", () => {
    expect(joinDictation("already there", "spoken")).toBe("already there spoken");
    expect(joinDictation("", "x".repeat(QUESTION_MAX_LENGTH + 20))).toHaveLength(QUESTION_MAX_LENGTH);
  });

  it("reads Chrome host-object speech results via item()", () => {
    const results = {
      length: 1,
      item: (index: number) =>
        index === 0
          ? {
              isFinal: false,
              length: 1,
              item: () => ({ transcript: " Boston Logan " }),
            }
          : { isFinal: false, length: 0, item: () => ({ transcript: "" }) },
    };
    expect(transcriptFromResults({ resultIndex: 0, results })).toEqual({
      spoken: "Boston Logan",
      isFinal: false,
    });
  });

  it("disables the microphone when speech recognition is missing", async () => {
    renderWorkspace();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/conversations", "token"));
    expect(screen.getByRole("button", { name: "Dictate question" })).toBeDisabled();
    expect(screen.getByText(/Voice dictation is not available/)).toBeInTheDocument();
  });

  it("fills the composer from interim and final results without auto-sending", async () => {
    installRecognition();
    renderWorkspace();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/conversations", "token"));

    const mic = screen.getByRole("button", { name: "Dictate question" });
    expect(mic).toBeEnabled();
    fireEvent.click(mic);
    await waitFor(() => expect(mic).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText(/Listening/)).toBeInTheDocument();
    expect(FakeSpeechRecognition.latest?.interimResults).toBe(true);
    expect(FakeSpeechRecognition.latest?.continuous).toBe(false);

    act(() => {
      FakeSpeechRecognition.latest!.emit("Which airports in New England", false);
    });
    expect(screen.getByLabelText(/Ask about an airport/)).toHaveValue("Which airports in New England");
    expect(vi.mocked(apiFetch).mock.calls.filter((call) => call[0] === "/chat")).toHaveLength(0);

    act(() => {
      FakeSpeechRecognition.latest!.emit(
        "Which airports in New England are strong candidates for terminal expansion?",
        true,
      );
    });
    expect(screen.getByLabelText(/Ask about an airport/)).toHaveValue(
      "Which airports in New England are strong candidates for terminal expansion?",
    );
    expect(screen.getByText(/Listening/)).toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.filter((call) => call[0] === "/chat")).toHaveLength(0);

    fireEvent.click(mic);
    await waitFor(() => expect(mic).toHaveAttribute("aria-pressed", "false"));

    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => {
      const chatCall = vi.mocked(apiFetch).mock.calls.find((call) => call[0] === "/chat");
      expect(chatCall).toBeTruthy();
      const body = JSON.parse(String((chatCall?.[2] as RequestInit).body));
      expect(body.message).toBe("Which airports in New England are strong candidates for terminal expansion?");
    });
  });

  it("keeps dictation available after recognition is blocked", async () => {
    installRecognition();
    renderWorkspace();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/conversations", "token"));
    fireEvent.click(screen.getByRole("button", { name: "Dictate question" }));
    await waitFor(() => expect(FakeSpeechRecognition.latest).toBeTruthy());
    act(() => {
      FakeSpeechRecognition.latest!.onerror?.({ error: "not-allowed" });
      FakeSpeechRecognition.latest!.onend?.();
    });
    expect(screen.getByRole("button", { name: "Dictate question" })).toBeEnabled();
    expect(screen.getByText(/Microphone access was denied/)).toBeInTheDocument();
  });

  it("asks the browser for microphone permission when recognition is blocked", async () => {
    installRecognition();
    let grant: ((stream: { getTracks: () => Array<{ stop: () => void }> }) => void) | undefined;
    const getUserMedia = vi.fn(
      () =>
        new Promise<{ getTracks: () => Array<{ stop: () => void }> }>((resolve) => {
          grant = resolve;
        }),
    );
    installMicrophonePermission("prompt", getUserMedia);
    renderWorkspace();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/conversations", "token"));
    fireEvent.click(screen.getByRole("button", { name: "Dictate question" }));
    await waitFor(() => expect(FakeSpeechRecognition.latest).toBeTruthy());
    act(() => {
      FakeSpeechRecognition.latest!.onerror?.({ error: "not-allowed" });
      FakeSpeechRecognition.latest!.onend?.();
    });
    expect(await screen.findByText(/Allow microphone access when the browser asks/)).toBeInTheDocument();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));
    act(() => {
      grant?.({ getTracks: () => [{ stop: vi.fn() }] });
    });
    expect(await screen.findByText(/Microphone is allowed/)).toBeInTheDocument();
  });

  it("does not start listening when microphone permission is already denied", async () => {
    installRecognition();
    const getUserMedia = installMicrophonePermission(
      "denied",
      vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")),
    );
    renderWorkspace();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/conversations", "token"));
    fireEvent.click(screen.getByRole("button", { name: "Dictate question" }));
    await waitFor(() => expect(FakeSpeechRecognition.latest).toBeTruthy());
    act(() => {
      FakeSpeechRecognition.latest!.onerror?.({ error: "not-allowed" });
      FakeSpeechRecognition.latest!.onend?.();
    });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));
    await waitFor(() => expect(screen.getByText(/Microphone access was denied/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Dictate question" })).toBeEnabled();
  });

  it("shows the permission prompt result when the user blocks getUserMedia", async () => {
    installRecognition();
    const getUserMedia = installMicrophonePermission(
      "prompt",
      vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")),
    );
    renderWorkspace();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/conversations", "token"));
    fireEvent.click(screen.getByRole("button", { name: "Dictate question" }));
    await waitFor(() => expect(FakeSpeechRecognition.latest).toBeTruthy());
    act(() => {
      FakeSpeechRecognition.latest!.onerror?.({ error: "not-allowed" });
      FakeSpeechRecognition.latest!.onend?.();
    });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));
    await waitFor(() => expect(screen.getByText(/Microphone access was denied/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Dictate question" })).toBeEnabled();
  });

  it("explains when the mic is stopped with no speech captured", async () => {
    installRecognition();
    renderWorkspace();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/conversations", "token"));
    const mic = screen.getByRole("button", { name: "Dictate question" });
    fireEvent.click(mic);
    await waitFor(() => expect(mic).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(mic);
    await waitFor(() => expect(mic).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByText(/No speech was captured/)).toBeInTheDocument();
  });
});
