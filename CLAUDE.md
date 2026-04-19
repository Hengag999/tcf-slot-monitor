# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TCF Slot Monitor checks availability of TCF Canada (Test de Connaissance du Français) exam slots across Canadian test centres. Each city has an independent scraper under `scripts/scrapers/`.

## Commands

Run a single scraper (dry-run):
```bash
npx tsx scripts/scrapers/toronto.ts
npx tsx scripts/scrapers/calgary.ts
# etc.
```

No test framework is configured yet.

## Architecture

Each scraper file in `scripts/scrapers/` follows the same pattern:
- Exports a `Slot` interface and a `scrape{City}(): Promise<Slot[]>` function
- Includes a `process.argv[1]` guard at the bottom for standalone dry-run execution
- Returns only slots that are **currently available/bookable** (empty array = nothing open)

### Scraping strategies by city

| City | Platform | Technique |
|------|----------|-----------|
| **Toronto** | Alliance Française CM API + Active Communities API | JSON API calls; fetches session list then confirms each slot isn't "Full" (concurrency-capped at 5) |
| **Calgary** | Oncord CMS (static HTML) | Fetches page, checks absence of "Sorry" marker, extracts booking links via regex |
| **Vancouver** | Oncord CMS (embedded JSON) | Parses `<oncord-combobox>` options from inline `<script type="application/json">` |
| **Halifax** | AEC platform (`afhalifax.aec.app`) | Extracts public API key from page HTML, then calls examinations API |
| **Ottawa** | AEC platform (`afottawa.aec.app`) | Same as Halifax; queries two exam type endpoints (IDs 5 and 79) |
| **Ashton** | WordPress/Elementor form (`ashtontesting.ca`) | Parses radio buttons in `tcf-radio-picker` div; skips `disabled` / "(FULL)" entries |
| **North York** | GBLC API (`api.gblc.ca`) | Calls test-schedules endpoint with `has_available_seats=true`; returns sessions with open seats |
| **Victoria** | Oncord CMS (embedded JSON) | Parses `<oncord-combobox>` options after the "Date (Please choose)" label; drops empty-value placeholder and any label matching `/sold out\|complet\|full/i` |
| **Edmonton** | Oncord CMS (embedded JSON) | Parses `<oncord-combobox>` options after the "choose your session" label; sold-out sessions remain listed with `(Sold out)` suffix, so the same negative-match filter drops them |

### Key patterns

- Halifax and Ottawa share the same AEC platform structure — the API key is public but may rotate with platform updates.
- Each city defines its own `Slot` interface locally (not shared across scrapers).
- Toronto is the only city that distinguishes exam types: "E-TCF Canada" (computer-based) vs "P-TCF Canada" (paper-based).
