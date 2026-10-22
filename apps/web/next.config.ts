import path from "path";
import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

// Monorepo: keep ONE .env at the repo root (apps/web has none of its own).
loadEnvConfig(path.join(__dirname, "../.."));

const nextConfig: NextConfig = {
  // Produces a self-contained `.next/standalone` server (server.js + traced
  // deps). CI builds it, the host only runs it — no build or full install
  // needed on the server.
  output: "standalone",
  // Trace files from the repo root so workspace packages (@alpha/db) and
  // hoisted node_modules are included in the standalone bundle. This nests
  // the server at .next/standalone/apps/web/server.js (CI adds a root shim).
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@alpha/db"],
  // Allow Cloudflare Tunnel hosts to load Next.js client JS in development.
  // Without this, the tunnel page gets HTML but no JS → form falls back to GET
  // and auth appears to "bounce" back to /login.
  allowedDevOrigins: [
    "match-sbjct-measure-sue.trycloudflare.com",
    "*.trycloudflare.com",
  ],
};

export default nextConfig;
