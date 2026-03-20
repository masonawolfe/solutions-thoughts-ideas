# Solutions, Thoughts & Ideas

## Goal
Build a public educational platform — an "understanding engine" — that helps people understand every side of complex conflicts and policy debates using AI-powered analysis, live news, and community-driven trending. Monetize through institutional licensing (schools, newsrooms, nonprofits), premium features, and automated strategy reports for organizations that can't afford consultants.

## Background
Mason built a single-page HTML/CSS/JS app covering conflicts and policy debates. Each topic presents balanced, nonpartisan analysis with multiple perspectives, key dates, game theory, resolution paths, and sources. The app includes dark mode (warm charcoal-brown palette), user accounts, comments, sharing, and export features.

The platform has evolved through several phases:
- **v1 (static):** 8 hardcoded featured topics, manually written analysis
- **v2 (dynamic):** AI-powered search via Claude API, any topic on demand, cached with 7-day TTL
- **v3 (automated):** Daily cron job seeds new topics from news, community "outdated" flagging, search input guards, Claude Haiku for cost reduction

The competitive landscape includes AllSides ($33M valuation, 1,400+ outlet ratings), Ground News (50K+ sources), and The Flip Side (200K+ subscribers). STI's differentiation: on-demand AI generation of any topic (not limited by editorial staff), structured analytical framework (not just left-vs-right), and international/multi-sided conflict coverage.

## Constraints
- Budget: ~$5-10/month for AI API costs (Claude Haiku via Anthropic)
- Hosting: Netlify free tier (125k function invocations/month — hit this limit during testing)
- Domain: solutionsthoughtsideas.com (owned on GoDaddy)
- No build tools or frameworks — single HTML file + Netlify Functions
- Netlify Functions have a 30-second timeout on free tier
- Mason uses Cowork for strategy/planning and Claude Code for implementation

## Stakeholders
- Mason Wolfe (masonawolfe) — creator, owner
- SchuhBox Media — Netlify team account
- Target audiences: general public, educators/students, journalists/researchers, nonprofits

## Tech Stack
- **Frontend:** Single `index.html` file (HTML/CSS/JS, no framework) — PWA-enabled with service worker
- **Backend:** Netlify Functions (serverless Node.js) — 10 functions deployed
- **AI:** Claude Haiku 4.5 (Anthropic) via raw fetch (not SDK, for faster cold starts)
- **Caching:** Netlify Blobs (free, built-in KV store) with 7-day TTL
- **Rate Limiting:** Upstash Redis (code deployed, env vars pending) with in-memory fallback
- **Error Monitoring:** Sentry (code deployed, DSN pending)
- **Analytics:** Cloudflare Web Analytics (live, beacon token deployed)
- **News:** Google News RSS (free, no API key)
- **DNS:** GoDaddy → Netlify
- **Code:** GitHub repo `masonawolfe/solutions-thoughts-ideas`

## File Structure
```
/
├── index.html                    # Main app (frontend + card metadata + SEO + PWA)
├── netlify.toml                  # Netlify config (build, functions, CORS headers)
├── package.json                  # Dependencies (@anthropic-ai/sdk, @netlify/blobs, @sentry/node, @upstash/redis)
├── manifest.json                 # PWA manifest
├── sw.js                         # Service worker (offline cache + API caching)
└── netlify/
    └── functions/
        ├── search.js             # AI search + cache + trending + Upstash rate limiter + Sentry
        ├── trending.js           # Top topics by recency-weighted score
        ├── news.js               # Live headlines via Google News RSS
        ├── daily-seed.js         # Scheduled: seeds topics from news + refreshes stale + Sentry
        ├── flag-outdated.js      # Community staleness flagging
        ├── featured.js           # GET — returns featured topics list from Blobs
        ├── seed-featured.js      # POST — manually trigger featured topics generation (auth required)
        ├── seed.js               # POST — manually trigger topic pre-generation (auth required)
        ├── clear-cache.js        # POST — manually clear cached analyses (auth required)
        ├── suggest.js            # POST — user topic suggestions (rate limited 3/day/IP)
        └── sentry-init.js        # Shared Sentry initialization module
```

## Monetization Strategy (Three Phases)
- **Phase 1 (months 1-6):** Free. Build content library through organic search + daily cron. SEO. Newsletter. Target: 5,000 monthly visitors.
- **Phase 2 (months 6-12):** Education licenses ($500-2,000/yr/school), newsroom licenses ($200-500/mo), premium individual ($5-10/mo), nonprofit licenses ($1,000-5,000/yr). Target: $2,000 MRR.
- **Phase 3 (months 12-18):** White-label API, grant funding (Knight, MacArthur), multilingual support, automated nonprofit strategy reports. Target: $25,000-28,000/mo.

Full strategy document: `STI_Strategy_FreshEyes_March2026.docx` (supersedes all prior versions)

## Key Decisions (summary)
See DECISIONS.md for full rationale:
- Netlify Functions over Vercel/Cloudflare (already using Netlify)
- Claude Haiku 4.5 for search generation (switched from Sonnet for cost + speed)
- Raw fetch instead of Anthropic SDK (faster cold starts)
- Netlify Blobs for caching with 7-day TTL (auto-expire stale analyses)
- Google News RSS for live headlines (completely free, no API key)
- Warm charcoal-brown dark mode (not cold blue-gray)
- Community flagging threshold of 3 for cache invalidation

## Live URLs
- **Production:** https://solutions-thoughts-ideas.netlify.app
- **Custom domain:** https://solutionsthoughtsideas.com
- **GitHub:** https://github.com/masonawolfe/solutions-thoughts-ideas
