import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import process from "node:process";

const root = join(process.cwd(), "public", "assets");
const strict = process.argv.includes("--strict");
const limits = {
  "maps/us-airports-network.svg": 150_000,
  "textures/runway-grid.svg": 30_000,
  "motion/route-network.json": 180_000,
  "motion/evidence-scan.json": 90_000,
  "motion/result-resolve.json": 60_000,
};
const forbiddenSvg = [
  /<!DOCTYPE/i,
  /<script/i,
  /<foreignObject/i,
  /(?:href|src)\s*=\s*["']https?:/i,
  /@import/i,
  /url\s*\(\s*["']?https?:/i,
];
const allowedStatuses = new Set(["placeholder", "review", "ready"]);

function inspectLottie(value, findings = { expressions: 0, remote: 0, embedded: 0, images: 0 }) {
  if (!value || typeof value !== "object") return findings;
  for (const [key, child] of Object.entries(value)) {
    if (key === "x" && typeof child === "string" && child.trim()) findings.expressions += 1;
    if (typeof child === "string") {
      if (/^https?:\/\//i.test(child)) findings.remote += 1;
      if (/^data:image/i.test(child)) findings.embedded += 1;
      if (key === "p" && /\.(?:png|jpe?g|gif|webp|svg)(?:\?|$)/i.test(child)) findings.images += 1;
    }
    inspectLottie(child, findings);
  }
  return findings;
}
const errors = [];
const warnings = [];
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
if (!Array.isArray(manifest.assets)) errors.push("manifest.json must contain an assets array.");

for (const entry of manifest.assets ?? []) {
  for (const field of ["id", "file", "type", "status", "intendedUse"])
    if (!entry[field]) errors.push(`${entry.id || "unknown"}: missing ${field}.`);
  if (!allowedStatuses.has(entry.status)) errors.push(`${entry.id}: unsupported status ${entry.status}.`);
  if (strict && entry.status !== "ready") errors.push(`${entry.file}: strict validation requires ready status.`);
  if (entry.file.includes("..") || entry.file.startsWith("/")) errors.push(`${entry.id}: unsafe file path.`);
  const path = join(root, entry.file);
  let file;
  try {
    file = await stat(path);
  } catch {
    file = null;
  }
  if (!file) {
    if (entry.status === "ready" || strict) errors.push(`${entry.file}: required file is missing.`);
    else warnings.push(`${entry.file}: awaiting approved asset.`);
    continue;
  }
  const limit = limits[entry.file];
  if (limit && file.size > limit) errors.push(`${entry.file}: ${file.size} bytes exceeds ${limit}.`);
  const content = await readFile(path, "utf8");
  if (extname(path) === ".svg" && forbiddenSvg.some((rule) => rule.test(content)))
    errors.push(`${entry.file}: contains forbidden SVG content.`);
  if (extname(path) === ".json") {
    let animation;
    try {
      animation = JSON.parse(content);
    } catch {
      errors.push(`${entry.file}: invalid JSON.`);
      continue;
    }
    const findings = inspectLottie(animation);
    if (Object.values(findings).some(Boolean))
      errors.push(`${entry.file}: contains expressions or external/embedded assets.`);
    if (entry.status !== "ready") warnings.push(`${entry.file}: technically valid but awaiting license approval.`);
  }
  if (entry.status === "ready") {
    for (const field of ["sourceUrl", "creator", "license", "attribution", "acquiredAt", "dimensions"])
      if (!entry[field]) errors.push(`${entry.id}: ready asset missing ${field}.`);
  }
  if (entry.sizeBytes !== file.size) {
    errors.push(`${entry.file}: manifest size ${entry.sizeBytes} does not match ${file.size} bytes.`);
  }
}

for (const warning of warnings) console.warn(`Asset warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`Asset error: ${error}`);
  process.exit(1);
}
console.log(`Validated ${manifest.assets.length} asset records${strict ? " in strict mode" : ""}.`);
