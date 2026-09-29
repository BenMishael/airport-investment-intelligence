import type { NextConfig } from "next";

const apiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const scriptSources =
  process.env.NODE_ENV === "development" ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.PLAYWRIGHT_DIST_DIR || ".next",
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "header", key: "host", value: "127.0.0.1:3000" }],
        destination: "http://localhost:3000/",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "header", key: "host", value: "127.0.0.1:3000" }],
        destination: "http://localhost:3000/:path*",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src ${scriptSources}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${apiOrigin} ${supabaseOrigin}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
