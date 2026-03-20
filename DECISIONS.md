# Decisions Log

_A record of meaningful choices made during this project, with reasoning._

---

## March 15, 2026 — Netlify for hosting (not Vercel, Cloudflare Pages, etc.)
**Decision:** Use Netlify for hosting with auto-deploy from GitHub
**Why:** Mason already had a Netlify account with SchuhBox Media team and another project (thevaluechange.com) deployed there. Sticking with Netlify means one dashboard for all projects, and the free tier covers everything needed (125k function invocations/month, Netlify Blobs for caching).

## March 15, 2026 — GoDaddy DNS: A record + CNAME (not Netlify DNS)
**Decision:** Keep DNS at GoDaddy and point records manually rather than transferring nameservers to Netlify DNS
**Why:** Mason already manages multiple domains on GoDaddy. Keeping DNS there is simpler for his workflow. GoDaddy doesn't support ALIAS/ANAME records, so we use the fallback: A record `@` → `75.2.60.5` and CNAME `www` → `solutions-thoughts-ideas.netlify.app`. Trade-off: no full CDN benefits on the apex domain, but acceptable for this project's scale.

## March 15, 2026 — Server-side AI search via Netlify Functions (not client-side)
**Decision:** Move Claude API calls from the browser to Netlify Functions
**Why:** v1 required each user to enter their own Anthropic API key for custom searches — a huge friction point. By running the API call server-side, Mason provides the API key once as an environment variable, and users just search. Also enables caching (same query = no API cost) and trending tracking. Trade-off: Mason pays for API usage, but caching makes this very affordable (~$5-10/month).

## March 15, 2026 — Claude Sonnet (not Haiku) for search generation
**Decision:** Use `claude-sonnet-4-20250514` for generating topic analyses
**Why:** Educational content quality matters — Sonnet produces more nuanced, balanced multi-perspective analysis than Haiku. At ~$0.01-0.05 per uncached search with aggressive caching, costs stay within Mason's $5-10/month budget. Can revisit if costs spike. Would change this if: monthly costs exceed $20 consistently.

## March 15, 2026 — Netlify Blobs for caching and trending data (not Redis, DynamoDB, etc.)
**Decision:** Use Netlify Blobs as the persistence layer for both cached analyses and trending data
**Why:** Netlify Blobs is free, requires zero configuration, is built into the platform, and supports JSON read/write. No need for an external database service. Potential downside: no complex querying (have to list all blobs and filter in code for trending), but with <1000 topics this is fine. Would change this if: the trending calculation becomes too slow with thousands of entries.

## March 15, 2026 — Google News RSS for live headlines (not NewsAPI, GNews, etc.)
**Decision:** Use Google News RSS feeds for topic-specific live headlines
**Why:** Completely free, no API key needed, no rate limits for reasonable usage, good coverage across sources. Trade-off: less control over article selection vs. a paid news API, and RSS parsing is slightly fragile. Would change this if: Google blocks or rate-limits RSS access.

## March 15, 2026 — Trending threshold: 2+ searches to appear
**Decision:** Only show topics in the Trending tab after they've been searched at least twice
**Why:** Prevents single one-off searches from cluttering the trending section. A topic needs at least one repeat visitor to signal genuine community interest. This can be adjusted as traffic grows.

## March 15, 2026 — Time-decay scoring for trending (24h=10x, 7d=3x, 30d=1x)
**Decision:** Weight recent searches more heavily in the trending score
**Why:** A topic searched 50 times last month but zero times this week should rank below a topic searched 5 times today. The 10x/3x/1x decay curve means trending reflects current interest, not just total lifetime volume. Plus a log2 bonus for total count to give popular topics a baseline.

## March 16, 2026 — Switch from Claude Sonnet to Claude Haiku 4.5
**Decision:** Use Claude Haiku 4.5 instead of Sonnet for search generation
**Why:** Faster responses (critical with Netlify's 30-second function timeout), significantly cheaper per query (~$0.005-0.01 vs $0.01-0.05), and quality is sufficient for the structured analysis format. Also switched from Anthropic SDK to raw fetch for faster cold starts. Would change this if: analysis quality degrades noticeably or users complain about depth.

## March 16, 2026 — 7-day cache TTL (not indefinite)
**Decision:** Add a 7-day TTL to cached analyses instead of caching indefinitely
**Why:** Indefinite caching meant analyses about fast-moving topics (US-Iran, Ukraine) would never update. 7 days balances freshness with cost — popular topics get refreshed weekly, unpopular ones regenerate only when someone searches them again. The daily-seed cron also proactively refreshes trending top 20 topics older than 7 days.

## March 16, 2026 — Community flagging threshold: 3 flags to invalidate cache
**Decision:** Require 3 user flags before clearing a topic's cache
**Why:** A threshold of 1 would let a single user force an API call (potential abuse). A threshold of 3 requires multiple people to agree something is stale before triggering a regeneration. Low enough to be responsive for fast-moving situations, high enough to prevent gaming. Counter resets after each refresh.

## March 16, 2026 — Warm charcoal-brown dark mode (not cold blue-gray)
**Decision:** Redesign dark mode using warm tones (#1b1916, #242120, #2e2a27) instead of cold blue-grays (#1a1d23, #22262e, #2a2e37)
**Why:** Light mode has a warm, earthy palette (creamy backgrounds, deep navy, warm rust/gold accents). The original dark mode went cold and blue-gray with neon-ish accents — felt like a generic developer theme, not a complement to the light design. New palette: "same personality, lights turned low." Accents are deeper/richer versions of light-mode colors instead of neon.

## March 16, 2026 — Fresh-Eyes strategy supersedes v1 and v2
**Decision:** STI_Strategy_FreshEyes_March2026.docx replaces both the original ambitious strategy and the 1-hour playbook as the definitive strategic document
**Why:** The original (v1) assumed 5-8 hrs/week and was too ambitious. The playbook (v2) was calibrated to time constraints but lacked competitive research and financial modeling. The fresh-eyes version (v3) combines real competitive data (AllSides $5.7M, Ground News 40+ employees, The Flip Side 237K subs), the Beehiiv cross-promotion opportunity (The Audible already exists), and a three-phase roadmap with revenue tables — all calibrated to 1-2 hrs/week. Would update if: significant competitive landscape changes or Mason's time availability shifts.

## March 16, 2026 — Beehiiv for newsletter (not Substack)
**Decision:** Use Beehiiv instead of Substack for the weekly newsletter
**Why:** STI's newsletter is an automated content engine repackaging AI-generated analysis, not a personal essay series. Beehiiv's growth tools (built-in referral program, recommendations network for cross-promotion, boost marketplace) run passively — critical when the time budget is ~50 min/week. Mason already has a Beehiiv account with "The Audible" (DownfieldOS football newsletter) — creating STI as a second publication enables free automatic cross-promotion via Beehiiv's recommendation network. Substack's advantage is its reader app and literary community, which matters more for personal brand building. Beehiiv's free tier includes unlimited subscribers and custom domains. Would change this if: Substack's discovery network becomes significantly stronger for policy/news content.

## March 16, 2026 — Three-phase monetization strategy
**Decision:** Free → institutional licensing → API + grants (no ads)
**Why:** Advertising creates a structural conflict with the platform's mission (balanced understanding vs. engagement optimization). Every credible competitor (AllSides, Ground News, The Flip Side) has deliberately minimized ad dependence. Institutional buyers (schools, newsrooms, nonprofits) represent the strongest revenue path and align with the mission. The automated nonprofit strategy report angle is the most fundable for grants (Knight, MacArthur). Full analysis in STI_Strategic_Advisory_March2026.docx.

## March 17, 2026 — Context pipeline over static fact-injection
**Decision:** Build a two-component context pipeline (auto-refreshing world-state blob + per-query topic headlines) rather than hardcoding current facts or using a static corrections list
**Why:** Mason pushed back on band-aid fixes ("I feel like we need a more systemic fix vs a few band aid solutions"). Hardcoding facts (like "The US president is X") would require manual updates and wouldn't scale to the hundreds of facts that change. The pipeline is zero-maintenance: daily-seed.js refreshes the world-state blob from Google News each morning, and every search query fetches topic-specific headlines at query time. Cost is negligible (~$0.005/day for the world-state call). The prompt explicitly tells Claude to use headlines for grounding only, not to limit historical analysis — this prevents the recency bias that initially truncated key dates timelines. Would change this if: a more authoritative structured data source (like a facts API) becomes available and affordable.

## March 17, 2026 — Single ADMIN_SECRET for all admin endpoints
**Decision:** Use one shared `ADMIN_SECRET` environment variable (set in Netlify) to protect all admin endpoints (clear-cache.js, seed.js, seed-featured.js) instead of per-endpoint keys or hardcoded defaults
**Why:** Security audit found that clear-cache.js had a hardcoded default key (`'sti-admin-2026'`) visible in the public GitHub repo, seed.js derived its fallback from the Anthropic API key (leaking partial key info), and seed-featured.js had no auth at all. A single strong secret in Netlify env vars is simple to manage, easy to rotate, and eliminates the risk of hardcoded secrets in source code. All three endpoints should require this key and reject requests if it's not set. Would change this if: the project adds multiple admin users who need different access levels (then move to JWT or Netlify Identity).

## March 18, 2026 — Free-tier infrastructure stack: Supabase + Upstash + Cloudflare + Sentry
**Decision:** Build the next layer of infrastructure on four free-tier services (Supabase for auth/database/comments, Upstash Redis for rate limiting, Cloudflare Web Analytics, Sentry for error monitoring) rather than building custom solutions, using paid services, or deferring infrastructure entirely.
**Why:** All four scale in place — same data, same endpoints, same connection strings, just billing thresholds when traffic grows. No migration risk. Supabase is Postgres underneath (exportable to any Postgres host if we ever outgrow it). Upstash Redis replaces the broken in-memory rate limiter. Cloudflare analytics is free forever with no usage cap. Sentry replaces manual log-digging. Total cost at current scale: $0. Total cost at thousands of users: ~$90-115/mo (Supabase $25 + Sentry $26 + Beehiiv $42 + Upstash pennies). Would change this if: a specific service's free tier becomes too restrictive, or if an all-in-one platform (like PlanetScale + Clerk + PostHog) offers a better bundled deal.

## March 18, 2026 — Supabase for comments (not Giscus)
**Decision:** Build threaded comments on Supabase Postgres instead of using Giscus (GitHub Discussions-based comments)
**Why:** Giscus is free and zero-maintenance, but it has a migration ceiling: comments are stored in GitHub Discussions, require GitHub login (limits audience), and exporting to a different system later means a real migration. Since we're already adding Supabase for auth and user data, building comments on the same Postgres database means we own the data from day one. No migration if we add moderation tools, paid tiers, or community features later. Slightly more code upfront (~1 hour extra vs. Giscus), but zero migration risk.

## March 17, 2026 — STI reframed as "conflict intelligence engine"
**Decision:** Position STI as a conflict intelligence engine, not a balanced news website
**Why:** The website is one delivery interface. The newsletter is another. An API could be another. The engine — the ability to generate structured, multi-perspective conflict analysis on any topic, grounded in current reality — is the actual asset. This reframe (from the fresh-eyes strategy) changes how every feature decision gets evaluated: "Does this make the engine better?" not "Does this make the website prettier?" Competitors (AllSides, Ground News) are media companies. STI is an intelligence company that happens to have a website.

## March 19, 2026 — Upstash Redis with in-memory fallback for rate limiting
**Decision:** Implement Upstash Redis as primary rate limiter with automatic in-memory fallback when env vars are not set
**Why:** The in-memory rate limiter resets on every cold start and doesn't share state across concurrent function instances, making it ineffective. Upstash Redis persists across all instances. The fallback pattern means the code works immediately without requiring Upstash credentials — degraded but functional. This avoids deploy-time failures and lets infrastructure be activated incrementally.

## March 19, 2026 — Netlify Blobs for topic suggestions (interim before Supabase)
**Decision:** Store topic suggestions in Netlify Blobs instead of waiting for Supabase
**Why:** The suggest-a-topic feature was ready to ship but Supabase wasn't set up yet. Blobs are already available at zero cost. The data model is simple (key-value with topic + timestamp). When Supabase lands, suggestions migrate to the `topic_suggestions` table and gain user association. Shipping now with Blobs beats waiting for perfect infrastructure.
