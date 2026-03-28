# Solutions, Thoughts & Ideas — Claude Code Project Guide

## What This Is
A public educational web app at **solutionsthoughtsideas.com** that helps people understand every side of complex conflicts and policy debates — with AI-powered search, live news, community-driven trending topics, and automated content generation. Hosted on Netlify, code on GitHub.

## Quick Start
```bash
# Clone the repo
git clone https://github.com/masonawolfe/solutions-thoughts-ideas.git
cd solutions-thoughts-ideas

# Install dependencies (for Netlify Functions)
npm install

# Local development with Netlify CLI
npx netlify dev
# → Opens at http://localhost:8888

# Deploy (auto-deploys on push to main)
git push origin main
```

**Environment variable required:** `ANTHROPIC_API_KEY` must be set in Netlify (Site configuration → Environment variables) for the search function to work.

## Architecture

```
/
├── index.html                    # Entire frontend — HTML/CSS/JS in one file (~190KB), PWA-enabled
├── netlify.toml                  # Netlify config: publish dir, functions dir, CORS headers
├── package.json                  # Dependencies: @anthropic-ai/sdk, @netlify/blobs, @sentry/node, @upstash/redis
├── manifest.json                 # PWA manifest (app name, icons, theme color)
├── sw.js                         # Service worker — offline cache, API response caching
├── icon-192.svg                  # PWA app icon (SVG, STI lettermark)
├── CLAUDE.md                     # This file
├── PROJECT_CONTEXT.md            # Goals, constraints, stakeholders, strategic vision
├── SESSION_LOG.md                # What's been done each session
├── NEXT_ACTIONS.md               # Current task queue
├── DECISIONS.md                  # Architectural decisions with reasoning
├── SETUP.md                      # Terminal quickstart guide
└── netlify/
    └── functions/
        ├── search.js             # POST — Claude API + context pipeline + Blobs cache + trending + Upstash rate limiter + Sentry
        ├── trending.js           # GET — Top topics by recency-weighted score
        ├── news.js               # GET ?topic=X — Google News RSS headlines
        ├── daily-seed.js         # Scheduled (8AM UTC) — world-state refresh + topic seeding + stale refresh + Sentry
        ├── flag-outdated.js      # POST — community staleness flagging (3 flags = cache clear)
        ├── featured.js           # GET — returns the featured topics list from Blobs
        ├── seed-featured.js      # POST — manually trigger featured topics generation (ADMIN_SECRET required)
        ├── seed.js               # POST — manually trigger topic pre-generation (ADMIN_SECRET required)
        ├── clear-cache.js        # POST — manually clear cached analyses (ADMIN_SECRET required)
        ├── suggest.js            # POST — user topic suggestions (rate limited 3/day/IP)
        └── sentry-init.js        # Shared Sentry initialization module
```

**Tech stack:** Single HTML file (no framework, no build tools) + Netlify Functions (Node.js serverless) + Claude Haiku 4.5 (Anthropic) + Netlify Blobs (free KV cache) + Google News RSS (free headlines) + Cloudflare Web Analytics + Upstash Redis (rate limiting, code ready) + Sentry (error monitoring, code ready).

**No build step.** The HTML file is served as-is. Netlify Functions are bundled with esbuild at deploy time.

## Key Patterns

### Frontend (index.html)
- Everything is in one file: HTML structure, CSS styles, JavaScript logic
- Featured topics defined in CONFLICTS array (card metadata only — all analysis comes from API)
- Dark mode toggle with warm charcoal-brown palette (not cold blue-gray)
- Navigation is hash-based: `renderGrid()` for homepage, `showDetail(d)` for topic detail view
- Search calls `go(title)` which POSTs to `/.netlify/functions/search`
- Homepage has Featured/Trending tabs — toggle via `homepageMode` variable
- "Outdated?" button on topic detail pages triggers community staleness flagging
- "Did You Know" cards on homepage — currently display-only, not clickable (known issue, see below)
- Topic data structure: `{ title, sides[], keyDates[], situation, gameTheory, resolutionPaths[], discussionGuide, organizations, actions, quickTake, pullQuote, didYouKnow, sources[], statusAssessment, disagreementType, geography, safeImageQuery, ... }`
- Side colors use CSS classes `sc1` through `sc6`
- Conflict Status badges: colored by category (active-crisis=red, frozen=blue, deadlock=amber, shifting=orange, resolution=green) with trajectory arrows
- Interactive maps: Leaflet.js + OpenStreetMap (light) / CartoDB Dark Matter (dark), 2-4 markers per topic
- Conflict images: Wikimedia Commons API, client-side fetch with content safety filter + license check

### Backend (Netlify Functions)
- **search.js**: Input validation (profanity filter, rate limiting 5/min/IP, length check, repeated char detection) → Netlify Blobs cache check (7-day TTL) → context pipeline (world-state blob + topic RSS headlines) → Claude Haiku generation → cache + trending tracking. Uses raw fetch instead of Anthropic SDK for faster cold starts. `max_tokens` set to 8192.
- **trending.js**: Lists all entries in "trending" Blobs store, scores each by recency-weighted search count (24h=10x, 7d=3x, 30d=1x) plus log2 volume bonus. Returns top 20.
- **news.js**: Fetches Google News RSS for a topic, parses XML with regex (no dependencies), returns up to 8 articles. Cached 15 minutes via Cache-Control header.
- **daily-seed.js**: Scheduled function (8AM UTC). Three-part job: (1) refreshes world-state context blob from headlines, (2) seeds 3-5 new topics from news, (3) sweeps top 20 trending topics and refreshes any with stale cache (>7 days). Also maintains a featured topics list in Blobs.
- **flag-outdated.js**: Accepts POST with topic key, increments flag counter in Blobs. At 3+ flags, clears the cache forcing regeneration on next visit. Resets counter after refresh.

### Context Pipeline (CRITICAL — solves knowledge cutoff)
Claude Haiku 4.5's training data cuts off at October 2025. Without grounding, analyses reference wrong presidents, miss 2026 events, and lose credibility. The context pipeline is a two-component system:

1. **World-state blob** (`context` store → `current-context` key): Auto-refreshed by daily-seed.js each morning. Asks Claude to extract structured facts from Google News headlines — heads of state, active conflicts, recent events, major policy changes. Stored as JSON. Zero manual maintenance.

2. **`buildContext(contextStore, topic)` / `buildWorldContext(contextStore, topic)`**: Runs before every Claude call (both in search.js and daily-seed.js). Pulls world-state blob + fetches 8-10 Google News RSS headlines specific to the search topic. Both injected as `CURRENT WORLD CONTEXT` section in the prompt.

The prompt explicitly instructs: "The CURRENT WORLD CONTEXT above is for grounding recent facts only — do NOT limit your historical analysis to recent headlines." This prevents the recency bias that was causing truncated key dates timelines.

**Important prompt constraints:**
- `keyDates` must span full conflict history (origins through 2025-2026), 8-12 minimum
- `didYouKnow` must be a single surprising sentence under 130 characters
- 4 key leaders must include FULL NAMES
- 3 sides, 4 power brokers, 3 resolution paths, 3 orgs with URLs, 3 actions, 5 sources
- `intensity` calibrated across full range: critical/high/medium/low with defined criteria

**Deployed prompt fields (Session 11):**
- `statusAssessment` — classifies current conflict state: active-crisis, frozen-conflict, policy-deadlock, shifting-ground, resolution-trajectory. Includes trajectory (escalating/stable/de-escalating) and reasoning. Rendered as colored badges in detail view.
- `disagreementType` — classifies fundamental nature of disagreement: resource-allocation, identity-values, sovereignty-territory, institutional-power, rights-freedoms, security-threat. Enables cross-topic pattern recognition. Rendered as teal pills.
- `geography` — center coordinates [lat, lng], zoom level, and 2-4 markers with key locations. Powers Leaflet.js interactive maps with dark/light tile switching.
- `safeImageQuery` — Claude-suggested Wikimedia Commons search term for non-graphic, CC-licensed images. Client-side fetcher with category blocklist and license verification.

### Caching Strategy
- AI responses cached in Netlify Blobs with 7-day TTL (auto-expire and regenerate)
- News headlines cached 15 min via HTTP Cache-Control
- Trending list cached 60 seconds via HTTP Cache-Control
- Cache keys are URL-slugified topic titles
- Community "outdated" flags can force early cache invalidation (3 flags = cleared)

### Trending Algorithm
- Topics appear after 2+ searches
- Score = sum of recency-weighted searches + log2(count+1)*2
- Searches in last 24h: 10 points each
- Searches in last 7d: 3 points each
- Searches in last 30d: 1 point each
- Keeps last 1000 timestamps per topic, drops anything older than 30 days

## Current Status

**Fully deployed and operational.** 10 Netlify Functions live (search, trending, news, daily-seed, flag-outdated, featured, seed, seed-featured, clear-cache, suggest). ANTHROPIC_API_KEY + ADMIN_SECRET set. Auto-deploys from GitHub main branch. Security hardened (CORS locked to production domain, admin endpoints require ADMIN_SECRET). All 12 panel UX issues resolved. Cloudflare Web Analytics live.

**Recent completions (Session 11):** Conflict Status Assessment badges (5 categories + trajectory arrows), Disagreement Type classification (6 types), interactive Leaflet.js maps with dark mode tiles, Wikimedia Commons images with content safety filter. All new fields added to Claude prompt and rendered in detail view. Leaflet CDN added with SRI integrity hashes.

**Earlier completions (Session 9):** Cloudflare Web Analytics deployed, Sentry + Upstash Redis code integrated (needs env vars), API credit exhaustion handling, Suggest a Topic feature, PWA support (manifest + service worker + offline caching), SEO meta tags, accessibility landmarks, error recovery UX.

## Infrastructure Status
| Service | Code | Account/Env Vars | Status |
|---------|------|-------------------|--------|
| Cloudflare Web Analytics | ✅ Beacon in HTML | ✅ Account created | **Live** |
| Upstash Redis (rate limiting) | ✅ In search.js | ⬜ Need account + env vars | Falls back to in-memory |
| Sentry (error monitoring) | ✅ In search.js + daily-seed.js | ⬜ Need account + DSN | Errors log to console only |
| Supabase (auth + comments) | ⬜ Not started | ⬜ Need account + env vars | Discussion shows "Coming soon" |
| Beehiiv (newsletter) | ⬜ Not started | ⬜ Need publication | No newsletter embed yet |

## Immediate Priority
1. **Set up Upstash + Sentry accounts** — Create accounts, paste env vars into Netlify. Code already deployed.
2. **Supabase** (~2-3 hrs) — Real auth, real comments, user database. Foundation for everything else.
3. **Beehiiv newsletter embed** (~1 hr) — When Mason is ready.

## Strategic Direction
STI is a **conflict intelligence engine**, not a balanced news website. The website is one delivery interface; the engine is the asset.

Three expansion paths:
- **Weekly newsletter via Beehiiv** — Repackage top trending topics as a weekly email digest. Cross-promote with Mason's existing "The Audible" newsletter (DownfieldOS). Beehiiv's recommendations network enables free automatic cross-promotion.
- **Trend intelligence / think tank layer** — Aggregated search data reveals what communities care about before mainstream media catches on.
- **Automated nonprofit strategy reports** — Localized strategic briefings for orgs that can't afford consultants. Strongest monetization and most fundable angle.

Full strategy: `STI_Strategy_FreshEyes_March2026.docx` (supersedes all prior strategy docs).
See NEXT_ACTIONS.md for full task queue.

## Domain & Hosting
- **GitHub repo:** `masonawolfe/solutions-thoughts-ideas` (public)
- **Netlify site:** `solutions-thoughts-ideas.netlify.app` (SchuhBox Media team)
- **Custom domain:** `solutionsthoughtsideas.com` (GoDaddy DNS)
- **DNS config:** A record `@` → `75.2.60.5`, CNAME `www` → `solutions-thoughts-ideas.netlify.app`
- Auto-deploys from GitHub main branch

## Budget
~$5-10/month for Claude API usage. Now using Claude Haiku 4.5 (cheaper than Sonnet). Aggressive caching with 7-day TTL keeps costs minimal — identical searches within the TTL window are free. Daily cron generates ~5 new topics/day at ~$0.005-0.01 each.

**Infrastructure costs at current scale:** $0 (all free tiers).
**Infrastructure costs at thousands of users:** ~$90-115/mo (Supabase $25 + Sentry $26 + Beehiiv $42 + Upstash pennies + Cloudflare free + Netlify $19).

## Environment Variables (Netlify)
| Variable | Purpose | Status |
|----------|---------|--------|
| `ANTHROPIC_API_KEY` | Claude Haiku 4.5 API access | ✅ Set |
| `ADMIN_SECRET` | Protects admin endpoints (clear-cache, seed, seed-featured) | ✅ Set |
| `SUPABASE_URL` | Supabase project URL | ⬜ Pending |
| `SUPABASE_ANON_KEY` | Supabase client-safe key (for auth flows) | ⬜ Pending |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key (server-side only, never expose) | ⬜ Pending |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis endpoint | ⬜ Pending |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token | ⬜ Pending |
| `SENTRY_DSN` | Sentry error reporting endpoint | ⬜ Pending |

## Owner
Mason Wolfe (masonawolfe) — masonawolfe@gmail.com
SchuhBox Media — Netlify team account

## Session Continuity
After each session, update:
- **SESSION_LOG.md** — what you did, what you discovered, current status
- **NEXT_ACTIONS.md** — check off completed items, add new ones
- **DECISIONS.md** — log any meaningful architectural or design choices with reasoning
