import { defineConfig } from "@playwright/test";

const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    env: {
      ...inheritedEnvironment,
      PLAYWRIGHT_DIST_DIR: ".next-playwright",
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:8000",
      NEXT_PUBLIC_SUPABASE_URL: "https://visual-test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "visual-test-anon-key",
    },
  },
  projects: [
    { name: "phone-375", use: { browserName: "chromium", viewport: { width: 375, height: 812 } } },
    { name: "tablet-768", use: { browserName: "chromium", viewport: { width: 768, height: 1024 } } },
    { name: "laptop-1024", use: { browserName: "chromium", viewport: { width: 1024, height: 768 } } },
    { name: "desktop-1440", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
  ],
});
