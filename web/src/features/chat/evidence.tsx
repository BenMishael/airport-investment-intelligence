"use client";

import { ArrowSquareOut, Calculator, CheckCircle, CloudSun, Database } from "@phosphor-icons/react";
import { m, useReducedMotion } from "motion/react";

import { MotionAsset } from "@/components/motion/MotionAsset";
import { AnimatedDisclosure } from "@/components/ui/AnimatedDisclosure";
import { ChatResponse, Source } from "@/types/api";
import type { EvidenceAirport, ScoreComponents } from "@/types/ui";
import styles from "./Evidence.module.css";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const string = (value: unknown): string => (typeof value === "string" ? value : "");
function formatAiStatus(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "generated") return "generated";
  if (normalized.startsWith("fallback:")) {
    if (normalized.includes("rejected")) return "fallback · validation";
    if (normalized.includes("not_configured") || normalized.includes("not configured")) {
      return "fallback · not configured";
    }
    if (normalized.includes("http") || normalized.includes("unavailable")) {
      return "fallback · model unavailable";
    }
    return "fallback · deterministic briefing";
  }
  return status.replaceAll("_", " ");
}
const displayNumber = (value: number | undefined) => (value === undefined ? "—" : value.toLocaleString());
const displayScore = (value: number | undefined) =>
  value === undefined ? "—" : value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DEFAULT_WINDOW = "FAA CY2025 / BTS CY2024";

export function publicProviderSummary(reason: string | undefined): string {
  const text = (reason || "").trim();
  if (!text) return "Unavailable";
  if (/(ReadTimeout|ConnectTimeout|TimeoutException|timed? ?out)/i.test(text)) return "Did not respond in time";
  if (/\b(ValueError|KeyError|TypeError|HTTPError|JSONDecodeError|ParseError)\b/.test(text)) {
    return "Temporarily unavailable";
  }
  return text.replace(/^(?:provider unavailable|Live weather provider unavailable):\s*/i, "") || "Unavailable";
}

function scoreComponents(value: unknown): ScoreComponents | undefined {
  const item = record(value);
  if (!item) return undefined;
  const parsed: ScoreComponents = {
    passenger_growth: number(item.passenger_growth),
    departure_delay: number(item.departure_delay),
    cancellation: number(item.cancellation),
    activity_scale: number(item.activity_scale),
  };
  if (Object.values(parsed).every((entry) => entry === undefined)) return undefined;
  return parsed;
}

function componentReadout(components?: ScoreComponents): string {
  if (!components) return "";
  return (
    [
      ["growth", components.passenger_growth],
      ["delay", components.departure_delay],
      ["cancel", components.cancellation],
      ["activity", components.activity_scale],
    ] as const
  )
    .filter((entry) => entry[1] !== undefined)
    .map(([label, value]) => `${label} ${displayScore(value)}`)
    .join(" · ");
}

export function collectSources(value: unknown): Source[] {
  const item = record(value);
  if (!item) return [];
  const own = Array.isArray(item.sources)
    ? item.sources.filter((source): source is Source => Boolean(record(source)?.id && record(source)?.name))
    : [];
  const nested = Array.isArray(item.airports) ? item.airports.flatMap(collectSources) : [];
  return [...own, ...nested].filter(
    (source, index, all) => all.findIndex((candidate) => candidate.id === source.id) === index,
  );
}

function airportFrom(value: unknown): EvidenceAirport | undefined {
  const item = record(value);
  const airport = record(item?.airport);
  const metrics = record(item?.metrics) || {};
  if (!item || !airport || !string(airport.code)) return undefined;
  const expansion = record(item.expansion_opportunity);
  return {
    code: string(airport.code),
    name: string(airport.name),
    score: number(item.score) ?? number(expansion?.score),
    delayedPct: number(metrics.departure_delay_rate_pct),
    cancellationPct: number(metrics.cancellation_rate_pct),
    taxiOutMinutes: number(metrics.average_taxi_out_minutes),
    departures: number(metrics.reported_departures),
    country: string(airport.country) || undefined,
    kpiTier: string(airport.kpi_tier) || string(item.kpi_tier) || undefined,
    components: scoreComponents(item.components) ?? scoreComponents(expansion?.components),
  };
}

function Bar({ value, max = 100, label, delay = 0 }: { value?: number; max?: number; label: string; delay?: number }) {
  const reduced = useReducedMotion();
  const proportion = value === undefined ? 0 : Math.max(0, Math.min(1, value / Math.max(max, 1)));
  return (
    <div className={styles.bar} role="img" aria-label={`${label}: ${value ?? "not available"}`}>
      <m.i
        initial={{ scaleX: reduced ? proportion : 0 }}
        whileInView={{ scaleX: proportion }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: reduced ? 0 : 0.48, delay }}
      />
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function Ranking({ rows, identity }: { rows: EvidenceAirport[]; identity?: boolean }) {
  return (
    <section className={styles.block} aria-labelledby="ranking-heading">
      <div className={styles.blockHead}>
        <div>
          <span className={styles.kicker}>{identity ? "Identity catalog" : "0–100 score components"}</span>
          <h2 id="ranking-heading">{identity ? "IATA coverage" : "Opportunity score"}</h2>
        </div>
        <Calculator size={21} />
      </div>
      <div className={styles.rankingBars}>
        {rows.map((item, index) => (
          <m.div
            className={styles.rank}
            key={item.code}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.045 }}
          >
            <span className={styles.rankNumber}>0{index + 1}</span>
            <span>
              <strong>{item.code}</strong>
              <small>
                {item.name}
                {item.kpiTier ? ` · ${item.kpiTier.replaceAll("_", " ")}` : ""}
              </small>
            </span>
            {identity ? (
              <span className={styles.identityMeta}>{item.country || "International"}</span>
            ) : (
              <Bar value={item.score} label={`${item.code} score`} delay={index * 0.045} />
            )}
            <strong>
              {identity ? item.kpiTier?.replaceAll("_", " ") || "identity" : displayNumber(item.score)}
              {!identity && <small>/100</small>}
            </strong>
          </m.div>
        ))}
      </div>
      <div className={styles.tableWrap}>
        <table>
          <caption>{identity ? "Catalog values" : "0–100 score components"}</caption>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Airport</th>
              <th>Score</th>
              {!identity && (
                <>
                  <th>Growth</th>
                  <th>Delay</th>
                  <th>Cancel</th>
                  <th>Activity</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={item.code}>
                <td>{index + 1}</td>
                <th scope="row">{item.code}</th>
                <td>{identity ? "—" : `${displayNumber(item.score)}/100`}</td>
                {!identity && (
                  <>
                    <td>{displayScore(item.components?.passenger_growth)}</td>
                    <td>{displayScore(item.components?.departure_delay)}</td>
                    <td>{displayScore(item.components?.cancellation)}</td>
                    <td>{displayScore(item.components?.activity_scale)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Comparison({ airports }: { airports: EvidenceAirport[] }) {
  const taxiMax = Math.max(...airports.map((airport) => airport.taxiOutMinutes || 0), 1);
  return (
    <section className={styles.block} aria-labelledby="comparison-heading">
      <div className={styles.blockHead}>
        <div>
          <span className={styles.kicker}>Airport comparison</span>
          <h2 id="comparison-heading">Operational pressure</h2>
        </div>
        <Database size={21} />
      </div>
      <div className={styles.compareBars}>
        {airports.map((airport) => (
          <section key={airport.code}>
            <header>
              <strong>{airport.code}</strong>
              <span>{airport.name}</span>
            </header>
            {airport.components && componentReadout(airport.components) ? (
              <p className={styles.componentLine}>
                Screen {displayScore(airport.score)}/100 — {componentReadout(airport.components)}
              </p>
            ) : null}
            <div>
              <span>
                Delayed departures <b>{displayNumber(airport.delayedPct)}%</b>
              </span>
              <Bar value={airport.delayedPct} label={`${airport.code} delayed departures`} />
            </div>
            <div>
              <span>
                Cancellations <b>{displayNumber(airport.cancellationPct)}%</b>
              </span>
              <Bar value={airport.cancellationPct} label={`${airport.code} cancellations`} />
            </div>
            <div>
              <span>
                Average taxi-out <b>{displayNumber(airport.taxiOutMinutes)} min</b>
              </span>
              <Bar value={airport.taxiOutMinutes} max={taxiMax} label={`${airport.code} average taxi-out`} />
            </div>
          </section>
        ))}
      </div>
      <div className={styles.tableWrap}>
        <table>
          <caption>Airport comparison values</caption>
          <thead>
            <tr>
              <th>Airport</th>
              <th>Delayed</th>
              <th>Cancellations</th>
              <th>Taxi-out</th>
              <th>Departures</th>
            </tr>
          </thead>
          <tbody>
            {airports.map((airport) => (
              <tr key={airport.code}>
                <th scope="row">{airport.code}</th>
                <td>{displayNumber(airport.delayedPct)}%</td>
                <td>{displayNumber(airport.cancellationPct)}%</td>
                <td>{displayNumber(airport.taxiOutMinutes)} min</td>
                <td>{displayNumber(airport.departures)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function sectionStatus(value: unknown): { available: boolean; summary: string } {
  const item = record(value);
  if (!item) return { available: false, summary: "Not supplied" };
  if (item.available === false) return { available: false, summary: publicProviderSummary(string(item.reason)) };
  const data = record(item.data) || item;
  const window = record(data.window);
  const categories = record(window?.categories);
  const ifr =
    typeof window?.ifr_or_worse === "number"
      ? window.ifr_or_worse
      : typeof categories?.IFR === "number" || typeof categories?.LIFR === "number"
        ? Number(categories?.IFR || 0) + Number(categories?.LIFR || 0)
        : undefined;
  const flight = string(data.flight_category);
  const temperature = data.temperature_c;
  if (flight || temperature !== undefined || window) {
    const parts = [
      flight,
      typeof temperature === "number" ? `${temperature}°C` : "",
      typeof ifr === "number" && typeof window?.observations === "number"
        ? `${ifr}/${window.observations} IFR+ (24h)`
        : "",
    ].filter(Boolean);
    return { available: true, summary: parts.join(" · ") || "Available" };
  }
  if (typeof data.population === "number" || data.geo_level) {
    const pop = typeof data.population === "number" ? `${Math.round(Number(data.population) / 1000)}k pop` : "";
    const unemp = typeof data.unemployment_rate_pct === "number" ? `${data.unemployment_rate_pct}% unemp` : "";
    return { available: true, summary: [string(data.region), pop, unemp].filter(Boolean).join(" · ") || "Available" };
  }
  if (typeof data.unemployment_rate_pct === "number") {
    const period = string(data.period_name) || string(data.period);
    const geo = string(data.geography);
    return {
      available: true,
      summary: [`${data.unemployment_rate_pct}%`, period, geo].filter(Boolean).join(" · "),
    };
  }
  if (typeof data.longest_runway_ft === "number") {
    return {
      available: true,
      summary: `${data.longest_runway_ft.toLocaleString()} ft longest · ${data.runway_count ?? ""} rwy`.trim(),
    };
  }
  return { available: Boolean(item.available ?? data), summary: "Available" };
}

function LiveContext({ payload }: { payload: Record<string, unknown> }) {
  const codes = Object.keys(payload);
  if (!codes.length) return null;
  return (
    <section className={styles.block} aria-labelledby="live-context-heading">
      <div className={styles.blockHead}>
        <div>
          <span className={styles.kicker}>Supplemental APIs</span>
          <h2 id="live-context-heading">Live public context</h2>
        </div>
        <CloudSun size={21} />
      </div>
      <div className={styles.liveGrid}>
        {codes.map((code) => {
          const sections = record(payload[code]) || {};
          const regional = record(sections.regional) || {};
          const weather = sectionStatus(sections.weather);
          const operations = sectionStatus(sections.operations);
          const facility = sectionStatus(sections.facility);
          const census = sectionStatus(regional.census);
          const labor = sectionStatus(regional.labor);
          return (
            <article key={code} className={styles.liveCard}>
              <header>
                <strong>{code}</strong>
                <small>Does not change the 0–100 score</small>
              </header>
              <ul>
                <li>
                  Weather <span className={weather.available ? styles.liveOk : styles.liveOff}>{weather.summary}</span>
                </li>
                <li>
                  NAS operations{" "}
                  <span className={operations.available ? styles.liveOk : styles.liveOff}>{operations.summary}</span>
                </li>
                <li>
                  Facility{" "}
                  <span className={facility.available ? styles.liveOk : styles.liveOff}>{facility.summary}</span>
                </li>
                <li>
                  Census <span className={census.available ? styles.liveOk : styles.liveOff}>{census.summary}</span>
                </li>
                <li>
                  Labor <span className={labor.available ? styles.liveOk : styles.liveOff}>{labor.summary}</span>
                </li>
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function Evidence({ response }: { response: ChatResponse }) {
  const evidence = response.evidence || {};
  const rankingMode = string(evidence.ranking_mode);
  const ranking = Array.isArray(evidence.ranking)
    ? evidence.ranking
        .map(airportFrom)
        .filter((item): item is EvidenceAirport => Boolean(item))
        .slice(0, 6)
    : [];
  const compared = Array.isArray(evidence.airports)
    ? evidence.airports.map(airportFrom).filter((item): item is EvidenceAirport => Boolean(item))
    : [];
  const proxy = record(evidence.proxy);
  const metricBlock = record(evidence.metrics);
  const expansionComponents = scoreComponents(record(evidence.expansion_opportunity)?.components);
  const longHaul = record(evidence.long_haul);
  const liveContext = record(evidence.live_context);
  const kpiTier = string(evidence.kpi_tier) || compared[0]?.kpiTier || ranking[0]?.kpiTier;
  const sources = collectSources(evidence);
  const observationWindow = string(evidence.window) || DEFAULT_WINDOW;
  const recognized =
    ranking.length > 0 || compared.length > 0 || proxy || metricBlock || longHaul || Boolean(liveContext);
  const aiLabel =
    typeof response.ai_status === "string" && response.ai_status ? formatAiStatus(response.ai_status) : "unavailable";
  const providerLabel = response.llm_provider === "groq" ? "Groq" : response.llm_provider === "gemini" ? "Gemini" : "";
  const assumptions = Array.isArray(response.assumptions)
    ? response.assumptions.filter((item): item is string => typeof item === "string")
    : [];
  return (
    <AnimatedDisclosure
      className={styles.evidence}
      label={
        <span className={styles.disclosureLabel}>
          <CheckCircle size={17} weight="fill" />
          Evidence &amp; calculation <small>{sources.length} sources</small>
        </span>
      }
      defaultOpen
    >
      <div className={styles.statusRow}>
        <div>
          <MotionAsset
            src="/assets/motion/result-resolve.json"
            posterSrc="/assets/posters/result-resolve-poster.svg"
            alt="Evidence checks completed"
            loop={false}
            speed={1.5}
          />
          <span>
            <strong>Calculations resolved</strong>
            <small>Exact values are shown immediately and are never generated by the language model.</small>
          </span>
        </div>
        <span className={styles.aiStatus}>
          AI explanation · {aiLabel}
          {providerLabel ? ` · ${providerLabel}` : ""}
          {kpiTier ? ` · ${kpiTier.replaceAll("_", " ")}` : ""}
        </span>
      </div>
      {ranking.length > 0 && <Ranking rows={ranking} identity={rankingMode === "identity"} />}
      {compared.length > 0 && <Comparison airports={compared} />}
      {liveContext && <LiveContext payload={liveContext} />}
      {proxy && (
        <section className={styles.block}>
          <div className={styles.blockHead}>
            <div>
              <span className={styles.kicker}>Demand proxy</span>
              <h2>Schedule pressure</h2>
            </div>
          </div>
          <div className={styles.metrics}>
            <Metric label="Affected departures" value={displayNumber(number(proxy.affected_departures))} />
            <Metric label="Share of schedule" value={`${displayNumber(number(proxy.share_pct))}%`} />
            <Metric label="Formula" value={string(proxy.formula) || "—"} note="Deterministic calculation" />
          </div>
        </section>
      )}
      {metricBlock && (
        <section className={styles.block}>
          <div className={styles.blockHead}>
            <div>
              <span className={styles.kicker}>Operational snapshot</span>
              <h2>Covered schedule</h2>
            </div>
          </div>
          <div className={styles.metrics}>
            <Metric label="Covered departures" value={displayNumber(number(metricBlock.reported_departures))} />
            <Metric
              label="Delayed departures"
              value={`${displayNumber(number(metricBlock.departure_delay_rate_pct))}%`}
            />
            <Metric label="Cancellations" value={`${displayNumber(number(metricBlock.cancellation_rate_pct))}%`} />
          </div>
          {expansionComponents && (
            <>
              <p className={styles.componentKicker}>0–100 score components</p>
              <div className={styles.metrics}>
                <Metric label="Growth" value={displayScore(expansionComponents.passenger_growth)} />
                <Metric label="Delay" value={displayScore(expansionComponents.departure_delay)} />
                <Metric label="Cancel" value={displayScore(expansionComponents.cancellation)} />
                <Metric label="Activity" value={displayScore(expansionComponents.activity_scale)} />
              </div>
            </>
          )}
        </section>
      )}
      {longHaul && (
        <section className={styles.block}>
          <div className={styles.blockHead}>
            <div>
              <span className={styles.kicker}>Route mix</span>
              <h2>Long-haul share</h2>
            </div>
          </div>
          <div className={styles.metrics}>
            <Metric label="Long-haul departures" value={displayNumber(number(longHaul.long_haul_departures))} />
            <Metric label="Covered departures" value={displayNumber(number(longHaul.covered_route_departures))} />
            <Metric label="Share" value={`${displayNumber(number(longHaul.long_haul_share_pct))}%`} />
          </div>
        </section>
      )}
      {!recognized && (
        <div className={styles.unsupported}>
          This response did not include a supported evidence visualization. The narrative is preserved, but no values
          were inferred.
        </div>
      )}
      <section className={styles.provenance} aria-labelledby="source-heading">
        <div className={styles.provenanceHead}>
          <div>
            <span className={styles.kicker}>Provenance &amp; freshness</span>
            <h2 id="source-heading">Source register</h2>
          </div>
          <span>{observationWindow}</span>
        </div>
        {sources.length ? (
          <div className={styles.sources}>
            {sources.map((source) => {
              const safeUrl = /^https?:\/\//i.test(source.url || "") ? source.url : undefined;
              return safeUrl ? (
                <a href={safeUrl} target="_blank" rel="noreferrer" key={source.id}>
                  <span>
                    <strong>{source.name}</strong>
                    <small>Observed {source.observed || "date not provided"}</small>
                  </span>
                  <ArrowSquareOut size={16} />
                </a>
              ) : (
                <span className={styles.source} key={source.id}>
                  <span>
                    <strong>{source.name}</strong>
                    <small>Observed {source.observed || "date not provided"}</small>
                  </span>
                </span>
              );
            })}
          </div>
        ) : (
          <p className={styles.noSources}>No source links were supplied with this evidence block.</p>
        )}
      </section>
      {assumptions.length > 0 && (
        <div className={styles.assumptions}>
          <strong>Assumptions and caveats</strong>
          <ul>
            {assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </div>
      )}
    </AnimatedDisclosure>
  );
}
