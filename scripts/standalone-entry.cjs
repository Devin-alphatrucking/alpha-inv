// Entry point for the deployed standalone bundle.
//
// In the monorepo the Next.js server lives at apps/web/server.js inside
// `.next/standalone`. CI copies THIS file to `.next/standalone/server.js`, so
// the host start command stays exactly: node .next/standalone/server.js
//
// It also loads a `.env` file if one exists (the standalone server does not
// load env files for you), then starts the real server. Variables already set
// by the host/panel always win over the file.
const fs = require("fs");
const path = require("path");

function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

// Where the old layout kept .env, plus the new nested locations.
const candidates = [
  path.join(process.cwd(), ".env"), // directory the host started us from
  path.join(__dirname, ".env"), // .next/standalone/.env
  path.join(__dirname, "..", "..", ".env"), // deploy root (parent of .next)
  path.join(__dirname, "apps", "web", ".env"),
];
for (const file of candidates) {
  if (loadEnvFile(file)) {
    console.log(`[standalone-entry] loaded env from ${file}`);
    break;
  }
}

require("./apps/web/server.js");
