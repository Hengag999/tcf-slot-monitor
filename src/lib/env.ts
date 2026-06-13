// Loads local secrets from .env.local (gitignored) into process.env.
//
// Imported for its side effect at the top of scripts/scrape-slots.ts, before any
// module reads process.env. dotenv does NOT override variables that are already
// set, so in GitHub Actions the repository secrets take precedence and the
// absent .env.local is a silent no-op (dotenv doesn't throw on a missing file).
// Individual scraper dry-runs don't import this — they only hit public pages and
// need no secrets.
//
// Expected format (.env.local), one KEY=value per line:
//   POSTGRES_URL=postgres://user:pass@host/db
//   DISCORD_WEBHOOK_TORONTO=https://discord.com/api/webhooks/...
// Quoted values are fine — dotenv strips surrounding quotes and trims whitespace,
// so no manual cleanup of the connection string is needed.

import { config } from "dotenv";

// quiet: suppress dotenv's per-run "injected env" banner — this runs on a
// 5-minute cron, so the line is just noise in the CI logs.
config({ path: ".env.local", quiet: true });
