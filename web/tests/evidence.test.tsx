import { describe, expect, it } from "vitest";

import { collectSources, publicProviderSummary } from "@/features/chat/evidence";

describe("collectSources", () => {
  it("deduplicates nested evidence sources", () => {
    const source = { id: "faa", name: "FAA", url: "https://faa.gov", observed: "2024" };
    expect(collectSources({ sources: [source], airports: [{ sources: [source] }] })).toEqual([source]);
  });
});

describe("publicProviderSummary", () => {
  it("hides exception class names", () => {
    expect(publicProviderSummary("provider unavailable: ValueError")).toBe("Temporarily unavailable");
    expect(publicProviderSummary("Live weather provider unavailable: ReadTimeout")).toBe("Did not respond in time");
    expect(publicProviderSummary("provider unavailable: the service could not be reached")).toBe(
      "the service could not be reached",
    );
  });
});
