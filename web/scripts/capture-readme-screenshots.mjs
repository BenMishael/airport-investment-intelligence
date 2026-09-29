import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectRoot = path.dirname(webRoot);
const outDir = path.join(projectRoot, "media/photos");
const email = process.env.README_CAPTURE_EMAIL || "reviewer@example.com";
const origin = "http://localhost:3000/";

fs.mkdirSync(outDir, { recursive: true });

function generateOtp() {
  const script = path.join(projectRoot, ".playwright-mcp/qa/gen_otp.py");
  return execFileSync("python3", [script, email], { encoding: "utf8" }).trim();
}

async function hideReviewChrome(page) {
  await page.addStyleTag({
    content: 'button[aria-label="Open Next.js Dev Tools"], nextjs-portal { display: none !important; }',
  }).catch(() => undefined);
  await page.locator("header span").evaluateAll((nodes) =>
    nodes.forEach((node) => {
      if ((node.textContent || "").includes("@")) {
        node.textContent = "authorized user";
        node.removeAttribute("title");
      }
    }),
  );
}

async function shot(page, name, { fullPage = false } = {}) {
  await hideReviewChrome(page);
  const target = path.join(outDir, name);
  await page.screenshot({ path: target, fullPage, animations: "disabled" });
  console.log("wrote", path.relative(projectRoot, target));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(20_000);

await page.goto(origin, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Light theme" }).click();
await shot(page, "01-signin-desktop.png", { fullPage: true });

await page.getByLabel("Email address").fill(email);
await page.getByRole("button", { name: "Send sign-in code" }).click();
await page.getByLabel("Eight-digit code").waitFor({ timeout: 30_000 });
const code = generateOtp();
await page.getByLabel("Eight-digit code").fill(code);
await page.getByRole("button", { name: "Open workspace" }).click();
await page.getByRole("heading", { name: "See airport opportunity in context." }).waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "New analysis" }).first().click();
await page.getByRole("heading", { name: "Questions built for this evidence set" }).waitFor();
await shot(page, "03-workspace-empty-desktop.png");

await page
  .getByRole("region", { name: "Airport analysis conversation" })
  .getByRole("button", { name: /New England are strong candidates/ })
  .click();
await page.getByRole("heading", { name: "Opportunity score" }).waitFor({ timeout: 90_000 });
await page.getByRole("heading", { name: "Opportunity score" }).scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await shot(page, "04-ranking-desktop.png");

await page.setViewportSize({ width: 375, height: 812 });
await page.getByRole("heading", { name: "Opportunity score" }).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot(page, "05-ranking-mobile.png");

await page.getByRole("button", { name: "Open analysis history" }).click();
await page.getByRole("dialog", { name: "Saved analyses" }).waitFor();
await page.waitForTimeout(400);
await shot(page, "06-history-drawer-mobile.png");

await page.getByRole("dialog", { name: "Saved analyses" }).getByRole("button", { name: "New analysis" }).click();
await page.getByRole("heading", { name: "Questions built for this evidence set" }).waitFor();
await shot(page, "07-workspace-empty-mobile.png");

await page.getByRole("button", { name: "Sign out" }).click();
await page.getByRole("heading", { name: "Airport intelligence, by invitation." }).waitFor();
await shot(page, "02-signin-mobile.png", { fullPage: true });

await browser.close();
