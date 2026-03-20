# Next Actions

_The current task queue. Completed items get checked off or moved to the session log._

## Up Next — Free-Tier Infrastructure Stack
_All services below are free at current scale and scale in place (same data, same endpoints — just billing thresholds). No migration risk. Sequence matters: analytics first (measure everything after), then Supabase (foundation for auth + comments + rate limiting), then the rest._

### 1. Cloudflare Web Analytics — DONE
- [x] Created Cloudflare account (Masonawolfe@gmail.com)
- [x] Added solutionsthoughtsideas.com, got beacon token `d963cc6f3c2d475b805b65d6a3647ef2`
- [x] Beacon script added to index.html before `</body>`
- [x] Deployed — analytics collecting data now

### 2. Supabase — Auth + Database + Comments (~2-3 hrs)
- [ ] Create free Supabase project at supabase.com (name: `sti-prod`)
- [ ] Set up auth: enable email/password + Google OAuth sign-in
- [ ] Create database tables:
  - `users` — extends Supabase auth with profile data (display name, saved topics, preferences)
  - `comments` — topic_key, user_id, content, created_at, parent_id (for threading)
  - `topic_suggestions` — replaces the Blobs-based suggest-a-topic idea with a real table
- [ ] Create Row Level Security (RLS) policies: users can only edit their own comments, anyone can read
- [ ] Create a new Netlify Function `auth.js` — proxies Supabase auth (sign up, sign in, session refresh). Keeps Supabase keys server-side.
- [ ] Update index.html: replace the current email-only signup modal with real auth (sign up / sign in). Show user's name when logged in. Gate commenting behind auth.
- [ ] Replace the "Coming soon" discussion section with real threaded comments powered by Supabase. Logged-in users can post. Everyone can read.
- [ ] Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Netlify environment variables
- [ ] Add `SUPABASE_SERVICE_ROLE_KEY` to Netlify env vars (for server-side admin operations only — never expose to client)
- **Why now:** Owns user data from day one. Comments, saved topics, and paid tiers later are just feature flags on top of this. No migration needed — Supabase free tier is 500MB Postgres + 50K MAU, paid tier ($25/mo) just raises limits. Same database, same API, same connection strings.
- **Scales to:** 50K monthly active users on free tier. Paid at $25/mo removes limits. Postgres underneath means you can export and move to any host if needed.

### 3. Upstash Redis — Rate Limiting (CODE DONE, needs account + env vars)
- [x] `@upstash/redis` added to package.json
- [x] search.js: replaced in-memory rate limiter with Upstash Redis (INCR + EXPIRE pattern, `rate:{ip}` key, 60s TTL)
- [x] Graceful fallback: if Upstash env vars not set, falls back to in-memory limiter
- [ ] Create free Upstash account at upstash.com
- [ ] Create a Redis database (region: US East for lowest latency to Netlify)
- [ ] Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Netlify env vars
- **Status:** Rate limiting works now with in-memory fallback. Redis will activate as soon as env vars are set.

### 4. Sentry — Error Monitoring (CODE DONE, needs account + env var)
- [x] `@sentry/node` added to package.json
- [x] Created shared `sentry-init.js` module (initializes Sentry from SENTRY_DSN env var)
- [x] Sentry imported and integrated in search.js + daily-seed.js (catches + reports errors)
- [x] `withSentry()` wrapper exported for other functions
- [ ] Create free Sentry account at sentry.io
- [ ] Create a Node.js project (name: `sti-functions`)
- [ ] Add `SENTRY_DSN` to Netlify environment variables
- [ ] Set up alert rule: email Mason on any new error
- **Status:** Code deployed. Will start sending errors to Sentry as soon as DSN env var is set.

### 5. API Credit Exhaustion Handling — DONE
- [x] search.js `callClaude()`: checks 401/402/429, returns friendly user message, logs with `[CREDITS]`/`[RATE_LIMIT]` prefix
- [x] daily-seed.js `callClaude()`: same pattern, aborts cron on credit issues

### 6. Beehiiv Newsletter Integration (~1 hr)
- [ ] Create STI publication on Beehiiv (Mason already has an account with "The Audible")
- [ ] Embed Beehiiv signup form on the homepage (above or below the grid) and on topic detail pages (after the analysis)
- [ ] Set up cross-promotion via Beehiiv's recommendations network between STI and The Audible
- [ ] Replace the current email signup modal with the Beehiiv embed (or wire the modal to POST to Beehiiv's API)
- **Scales to:** Unlimited subscribers on free tier. Paid at $42/mo adds automations, A/B testing, custom domains. Same subscriber list, same dashboard.

### 7. Suggest a Topic Feature — DONE
- [x] Homepage form: text input + submit button below the topic grid
- [x] `suggest.js` Netlify Function: stores suggestions in Netlify Blobs (will migrate to Supabase when ready)
- [x] Rate limited: 3 suggestions per IP per day via Blobs counter
- [ ] (Future) Migrate to Supabase `topic_suggestions` table when Supabase is set up
- [ ] (Future) Associate suggestions with logged-in user_id

### 8. PWA Support — DONE
- [x] `manifest.json` created (app name, dark mode theme color, icon placeholders)
- [x] `sw.js` service worker: caches shell + previously viewed topics, network-first for API, offline fallback message
- [x] Service worker registered in index.html
- [x] `<link rel="manifest">` + `<meta name="theme-color">` added to `<head>`
- [ ] (Future) Create actual 192x192 and 512x512 app icons (currently placeholders)

## Backlog — Strategic
- [ ] **Weekly newsletter content via Beehiiv** — After the embed is live (step 6), set up a weekly email digest repackaging the top 3-5 trending topics. The daily-seed cron already generates the content — just needs repackaging. Weekly frequency fits "understanding, not breaking news" positioning.
- [ ] **Trend intelligence / think tank layer** — Mine aggregated search trending data to identify what communities care about before it hits mainstream media. Build a dashboard or periodic report.
- [ ] **Automated nonprofit/charity strategy reports** — AI-generated strategic briefings for local nonprofits. Same Claude call, more specific prompt. Strongest monetization angle.
- [ ] **Nonprofit pricing tier** — Low-cost institutional license ($50-200/mo) for nonprofits and community orgs. With Supabase auth in place, this becomes a feature flag on user roles.
- [ ] **Grant/foundation outreach** — Apply to Knight Foundation, MacArthur Foundation, Google News Initiative, Democracy Fund.
- [ ] Add more featured topics based on trending data

## Completed
- [x] Deploy static v1 to GitHub → Netlify → GoDaddy
- [x] Fix repo description typo
- [x] Design v2 architecture (Netlify Functions + Claude API + caching + RSS)
- [x] Build search.js, trending.js, news.js Netlify Functions
- [x] Update index.html for dynamic search, trending, live news
- [x] Create netlify.toml and package.json
- [x] Initialize project context files
- [x] Push v2 files to GitHub
- [x] Set ANTHROPIC_API_KEY in Netlify environment variables
- [x] Trigger redeploy with env var — 3 functions deployed, site live
- [x] Add 7-day cache TTL to search.js (analyses auto-expire)
- [x] Build daily-seed.js cron job (seeds topics from news + refreshes stale trending)
- [x] Build flag-outdated.js + frontend "Outdated?" button (community staleness flagging)
- [x] Dark mode redesign (warm charcoal-brown palette)
- [x] Search input guards (profanity filter, rate limiting, length check)
- [x] Verify end-to-end: search, news, trending all working
- [x] Switch to Claude Haiku for cost reduction
- [x] Context pipeline: world-state blob + topic RSS headlines grounding all analyses
- [x] Fix prompt regression: key dates now span full conflict history (8-12 dates)
- [x] didYouKnow constraint: single sentence under 130 characters
- [x] max_tokens bumped to 8192
- [x] Synthetic user panel conducted (5 personas, 12 issues identified)
- [x] Project files updated for Claude Code handoff
- [x] Dynamic homepage: featured topics from trending data + seed-featured endpoint
- [x] Security: removed hardcoded admin keys, added ADMIN_SECRET auth to all admin endpoints
- [x] Security: tightened CORS from wildcard to production domain only
- [x] Security: set ADMIN_SECRET env var in Netlify
- [x] Mobile responsive: grids collapse to 1 column on ≤420px, touch targets 44px min
- [x] Discussion section: replaced mock commenting with "Coming soon" notice
- [x] SEO: Open Graph, Twitter Card, JSON-LD structured data, meta description, canonical URL
- [x] Accessibility: ARIA landmarks (banner, main, search), skip-nav, semantic HTML
- [x] Error recovery: friendly messages with retry + back-to-topics buttons
- [x] Social sharing: already built (Twitter, Facebook, LinkedIn, copy-link modal)
- [x] DYK card clicks: already working with go() handlers
- [x] Sign-up modal: already has value proposition copy
- [x] Loading progress: already has staged messages
- [x] News headlines: working for all tested topics
- [x] Intensity calibration: prompt already includes full-range definitions
- [x] Header title clickable to return home
- [x] Cloudflare Web Analytics: account created, beacon deployed (token d963cc6f3c2d475b805b65d6a3647ef2)
- [x] Sentry: @sentry/node added, sentry-init.js shared module, integrated in search.js + daily-seed.js
- [x] Upstash Redis: @upstash/redis added, search.js rate limiter rewritten with Redis + in-memory fallback
- [x] API credit exhaustion: 401/402/429 handling in search.js + daily-seed.js with friendly messages
- [x] Suggest a Topic: suggest.js function + homepage form, 3/day/IP rate limit via Blobs
- [x] PWA: manifest.json, sw.js service worker, offline cached topics
- [x] ADMIN_SECRET set in Netlify (cryptographic random, 64-char hex)
