export type ThemePreference = "light" | "dark" | "system";
export type AssetManifestEntry = {
  id: string;
  file: string;
  type: "svg" | "lottie" | "raster";
  status: "placeholder" | "review" | "ready";
  sourceUrl: string;
  creator: string;
  license: string;
  attribution: string;
  acquiredAt: string;
  dimensions: string;
  sizeBytes: number;
  intendedUse: string;
};
export type EvidenceMetric = { label: string; value: number | string; unit?: string };
export type ScoreComponents = {
  passenger_growth?: number;
  departure_delay?: number;
  cancellation?: number;
  activity_scale?: number;
};
export type EvidenceAirport = {
  code: string;
  name: string;
  score?: number;
  delayedPct?: number;
  cancellationPct?: number;
  taxiOutMinutes?: number;
  departures?: number;
  country?: string;
  kpiTier?: string;
  components?: ScoreComponents;
};
