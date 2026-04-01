# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running locally

```bash
node server.mjs        # starts dev server at http://localhost:3000
node test-api.mjs      # tests Google Sheets API connection directly
```

No package.json — zero npm dependencies. Everything uses Node.js built-ins.

## Architecture

This is a single-page application hosted on Vercel with Google Sheets as the database.

```
Browser → Vercel Edge Middleware (auth guard)
        → index.html (entire SPA — all views, logic, charts inline)
        → /api/data  (Vercel serverless fn → Google Sheets API)
```

**Auth flow:** User signs in with Google OAuth → `POST /api/auth` verifies the ID token against Google's tokeninfo endpoint → sets an HttpOnly session cookie → Edge middleware validates that cookie on every request and checks the email against a hardcoded whitelist in `middleware.js`.

**Data flow:** `index.html` calls `GET /api/data?action=getAll` on page load, which fetches all three sheet tabs in parallel and returns `{ influencers, deliverables, requests }`. Writes use `POST /api/data` with `{ action, data }`.

**Google Sheets auth:** `api/data.js` (and `server.mjs` for local dev) manually constructs a JWT from the hardcoded service account credentials, exchanges it for a Google OAuth access token, then calls the Sheets API v4 directly — no `googleapis` package.

## Key files

- `influenza-main/index.html` — entire frontend: all CSS, HTML views, and JS in one file (~1500 lines). State lives in module-level `let` vars (`influencers`, `deliverables`, `requests`). Views are toggled by `showView(name)`.
- `influenza-main/api/data.js` — Vercel serverless handler for all sheet reads/writes. Contains hardcoded service account private key (testing only).
- `influenza-main/middleware.js` — Vercel Edge middleware; hardcoded email whitelist at `ALLOWED_EMAILS`.
- `server.mjs` — local dev server (mirrors `api/data.js` logic); no Vercel needed.
- `test-api.mjs` — standalone script to verify Sheets API connectivity.

## Google Sheet

- **Sheet ID:** `11m1M_Y0SCmX5Lpp7wlVpgjIbDV8tiPdTweGZdiV_a-U`
- **Tabs used:** `Mapping Sheet` (influencers), `Overall tracking sheet` (deliverables), `Requests`
- **Service account:** `influenza@influenza-492010.iam.gserviceaccount.com` — must have at least Viewer access on the sheet.

## Column mappings

**Mapping Sheet** (cols A–O): S.No. | Influencer Name | Connect type | Platform(s) | Category | Page Link | Follower count | State | Language | Mail id | Phone No. | Affiliate ID | Discount Code | Order Total | Orders

**Overall tracking sheet** (cols A–AF): Sl.no | Influencer | Account Link | Follower Count | Category | Language | Asset | Status | Product | SKU IDs | Product Sent | Date of Custom Order | Date of Delivery | TAT | Scheduled Date | Scheduled Month | Date of Posting | Month of Posting | Manual Views | Links(YT) | [U] | [V] | Insta Links | IG Views | Influencer Cost | COGS | Cost to Kreo | Affiliate Link | Total Sale | Orders | Conversion Rate | Old vs repeat

> Columns U and V in the tracking sheet are still unconfirmed — mapped as `colU`/`colV` in parsers.

## Important constraints

- **Credentials are hardcoded** in `api/data.js` and `server.mjs` for the testing phase — do not commit to a public repo. Production plan is to move to Vercel environment variables.
- **Email whitelist** is hardcoded in both `middleware.js` and `api/auth.js` — both need updating when team changes.
- The `apps-script/` directory contains an unused Apps Script approach that was superseded by the direct Sheets API integration.
