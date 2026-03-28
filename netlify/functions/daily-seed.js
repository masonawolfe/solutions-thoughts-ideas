// Daily cron: seed new topics from headlines + refresh stale trending analyses + maintain world-state context
import { getStore } from "@netlify/blobs";
import { Sentry } from "./sentry-init.js";

const YEAR = new Date().getFullYear();
const DATE = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const WORLD_STATE_PROMPT = (headlines) => `Based on these current news headlines from ${DATE}, extract key current world facts. Return ONLY raw JSON (no markdown):
{"asOf":"${DATE}","headsOfState":[{"country":"","leader":"","title":""}],"activeConflicts":[""],"recentEvents":[""],"majorPolicyChanges":[""]}
Include: US president, UK PM, French president, German chancellor, Russian president, Chinese president, Ukrainian president, Iranian supreme leader, Israeli PM, and any other relevant leaders mentioned in headlines. List 5-10 active conflicts and 5-10 recent major events/policy changes. Be factual and concise.
Headlines:
${headlines}`;

const ANALYSIS_PROMPT = (title, worldContext) => `You are a nonpartisan analyst. Analyze "${title}" as of ${DATE}.

CURRENT WORLD CONTEXT (use this as ground truth for current facts — do NOT contradict it):
${worldContext}

Return ONLY raw JSON (no markdown):
{"isValidTopic":true,"invalidReason":"","title":"","isWedge":false,"intensity":"high","region":"","sensitivity":null,"summary":"","tags":[],"readTime":7,"lastVerified":"${DATE}","statusAssessment":{"category":"","reasoning":"","trajectory":""},"disagreementType":{"primary":"","secondary":"","explanation":""},"geography":{"center":[0,0],"zoom":5,"markers":[{"name":"","lat":0,"lng":0,"role":""}]},"safeImageQuery":"","keyDates":[{"date":"","event":""}],"situation":"","sides":[{"name":"","coreBeliefs":"","keyFigures":"","c":"sc1"}],"importantDistinction":"","missingVoices":"","powerBrokers":[{"name":"","description":""}],"gameTheory":"","keyLeaders":[{"name":"","role":"","stake":""}],"resolutionPaths":[{"title":"","description":""}],"historicalPrecedent":"","quickTake":"","pullQuote":"","didYouKnow":"","discussionGuide":{"ageNote":"Ages 14+","starters":[],"values":"","redFlags":"","activity":""},"organizations":[{"name":"","what":"","tag":"","url":""}],"actions":[{"icon":"","title":"","desc":"","links":[{"text":"","url":""}]}],"sources":[{"id":1,"text":"","org":"","url":"","date":"${YEAR}"}]}
Requirements: 3 sides, 4 power brokers, 4 key leaders with FULL NAMES, 3 resolution paths, 3 organizations with URLs, 3 actions with emoji icons and URLs, 5 sources. keyDates MUST span the FULL history of the conflict — from its origins through every major escalation, turning point, and agreement up to the most recent 2025-2026 events. Include 8-12 key dates minimum. The CURRENT WORLD CONTEXT above is for grounding recent facts only — do NOT limit your historical analysis to recent headlines. Be concise but historically comprehensive. didYouKnow MUST be a single surprising, complete sentence under 130 characters — a self-contained fact that lands without needing more context. intensity MUST be calibrated: "critical" = active armed conflict or imminent crisis with casualties, "high" = major active political/social conflict with frequent escalation, "medium" = ongoing policy debate or simmering tension, "low" = largely resolved or theoretical disagreement. Most topics should NOT be "high" — use the full range. statusAssessment MUST reflect the CURRENT state as of today, not the historical arc. category MUST be one of: active-crisis, frozen-conflict, policy-deadlock, shifting-ground, resolution-trajectory. trajectory MUST be one of: escalating, stable, de-escalating. disagreementType primary MUST be one of: resource-allocation, identity-values, sovereignty-territory, institutional-power, rights-freedoms, security-threat. secondary is optional (use "" if none). geography MUST include center coordinates [lat, lng], zoom level (3=continent, 5=region, 8=city), and 2-4 markers with name, lat, lng, and role (capital, flashpoint, border, institution, etc). For policy debates center on the relevant country. safeImageQuery MUST be a Wikimedia Commons search term that returns relevant, non-graphic images suitable for an educational platform. Prefer landmarks, institutions, diplomatic events, maps, flags, leaders at podiums. NEVER suggest terms that could return images of violence, casualties, or graphic content.`;

const EXTRACT_PROMPT = (headlines) => `From these news headlines, extract 5-8 major conflict or policy debate topics suitable for balanced multi-perspective analysis. Only pick substantive geopolitical conflicts, policy debates, or social issues where reasonable people disagree. NOT celebrity news, sports, weather, or single-event stories without broader debate. Each topic must be an ongoing issue with multiple perspectives, not just breaking news. Return ONLY a JSON array of objects: [{"title":"2-5 word topic","reason":"one sentence why this is a substantive multi-sided debate","score":1-10}]. Score 10 = deeply divisive multi-perspective issue, 1 = not really debatable. Only include topics scoring 7+.
${headlines}`;

const VALIDATE_TOPIC = (title) => `Is "${title}" a substantive conflict or policy debate suitable for balanced multi-perspective analysis? It must be an issue where reasonable, informed people genuinely disagree — not a settled fact, trivial controversy, or single news event. Reply with ONLY raw JSON: {"valid":true/false,"reason":"one sentence"}`;

function cacheKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function callClaude(apiKey, messages, maxTokens = 8192) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages
    })
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 402 || res.status === 429) {
      const tag = res.status === 429 ? '[RATE_LIMIT]' : '[CREDITS]';
      console.error(`${tag} Claude API returned ${res.status} — daily seed aborting`);
      throw new Error(`[CREDITS] Claude API unavailable (${res.status})`);
    }
    throw new Error(`Claude API ${res.status}`);
  }
  const data = await res.json();
  return data.content.map(b => b.text || '').join('');
}

async function fetchHeadlines() {
  const res = await fetch('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en');
  if (!res.ok) return '';
  const xml = await res.text();
  const titles = [];
  const re = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = (m[1] || m[2] || '').trim();
    if (t && t !== 'Google News') titles.push(t);
  }
  return titles.slice(0, 20).join('\n');
}

async function fetchTopicHeadlines(topic) {
  try {
    const query = encodeURIComponent(topic);
    const res = await fetch(`https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`, {
      headers: { 'User-Agent': 'SolutionsThoughtsIdeas/2.0' }
    });
    if (!res.ok) return '';
    const xml = await res.text();
    const titles = [];
    const re = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const t = (m[1] || m[2] || '').trim();
      if (t && t !== 'Google News') titles.push(t);
    }
    return titles.slice(0, 8).join('\n');
  } catch (e) { return ''; }
}

async function buildWorldContext(contextStore, topic) {
  let worldState = '';
  try {
    const ctx = await contextStore.get('current-context', { type: 'json' });
    if (ctx) {
      worldState = `As of ${ctx.asOf}:\n`;
      worldState += `Heads of State: ${(ctx.headsOfState || []).map(h => `${h.leader} (${h.title}, ${h.country})`).join('; ')}\n`;
      worldState += `Active Conflicts: ${(ctx.activeConflicts || []).join('; ')}\n`;
      worldState += `Recent Events: ${(ctx.recentEvents || []).join('; ')}\n`;
      worldState += `Policy Changes: ${(ctx.majorPolicyChanges || []).join('; ')}`;
    }
  } catch (e) {}

  const topicHeadlines = await fetchTopicHeadlines(topic);
  if (topicHeadlines) {
    worldState += `\n\nLatest headlines about "${topic}":\n${topicHeadlines}`;
  }

  return worldState || `Today is ${DATE}. Use your most current knowledge.`;
}

async function generateAnalysis(apiKey, title, contextStore) {
  const worldContext = await buildWorldContext(contextStore, title);
  const raw = await callClaude(apiKey, [{ role: 'user', content: ANALYSIS_PROMPT(title, worldContext) }]);
  let clean = raw.replace(/```json|```/g, '').trim();
  const fi = clean.indexOf('{'), li = clean.lastIndexOf('}');
  if (fi >= 0 && li >= 0) clean = clean.slice(fi, li + 1);
  const p = JSON.parse(clean);
  if (p.isValidTopic === false) return null;
  return {
    title: p.title || title, isWedge: !!p.isWedge, intensity: p.intensity || 'medium',
    region: p.region || '', sensitivity: p.sensitivity || null, summary: p.summary || '',
    tags: p.tags || [], readTime: p.readTime || 7, lastVerified: p.lastVerified || '',
    statusAssessment: p.statusAssessment || null, disagreementType: p.disagreementType || null,
    geography: p.geography || null, safeImageQuery: p.safeImageQuery || '',
    keyDates: p.keyDates || [], situation: p.situation || '', sides: p.sides || [],
    importantDistinction: p.importantDistinction || '', missingVoices: p.missingVoices || '',
    powerBrokers: p.powerBrokers || [], gameTheory: p.gameTheory || '',
    keyLeaders: p.keyLeaders || [], resolutionPaths: p.resolutionPaths || [],
    historicalPrecedent: p.historicalPrecedent || '', quickTake: p.quickTake || '',
    pullQuote: p.pullQuote || '', didYouKnow: p.didYouKnow || '',
    discussionGuide: p.discussionGuide || null, organizations: p.organizations || [],
    actions: p.actions || [], sources: p.sources || []
  };
}

export default async function handler(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'No API key' }), { status: 500 });

  const cache = getStore("analysis-cache");
  const trending = getStore("trending");
  const contextStore = getStore("context");
  const featured = getStore("featured");
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const MIN_FEATURED = 8;
  const log = [];
  const seededTopics = []; // track what we seed this run

  // --- PART 0: Refresh world-state context from today's headlines ---
  let headlines = '';
  try {
    headlines = await fetchHeadlines();
    if (headlines) {
      const wsRaw = await callClaude(apiKey, [{ role: 'user', content: WORLD_STATE_PROMPT(headlines) }], 1024);
      let wsClean = wsRaw.replace(/```json|```/g, '').trim();
      const wsFi = wsClean.indexOf('{'), wsLi = wsClean.lastIndexOf('}');
      if (wsFi >= 0 && wsLi >= 0) wsClean = wsClean.slice(wsFi, wsLi + 1);
      const worldState = JSON.parse(wsClean);
      worldState._updatedAt = Date.now();
      await contextStore.setJSON('current-context', worldState);
      log.push(`world-state: updated with ${(worldState.headsOfState || []).length} leaders, ${(worldState.activeConflicts || []).length} conflicts`);
    }
  } catch (e) {
    log.push(`world-state-error: ${e.message}`);
  }

  // --- PART 1: Seed new topics from headlines ---
  try {
    if (headlines) {
      const raw = await callClaude(apiKey, [{ role: 'user', content: EXTRACT_PROMPT(headlines) }], 1024);
      let clean = raw.replace(/```json|```/g, '').trim();
      const fi = clean.indexOf('['), li = clean.lastIndexOf(']');
      if (fi >= 0 && li >= 0) clean = clean.slice(fi, li + 1);
      const topics = JSON.parse(clean);

      // Sort by score descending, take top 5
      const sorted = topics.filter(t => t && t.title && (t.score || 0) >= 7).sort((a, b) => (b.score || 0) - (a.score || 0));

      for (const topicObj of sorted.slice(0, 5)) {
        const title = typeof topicObj === 'string' ? topicObj : topicObj.title;
        if (!title || title.length < 3) continue;
        const key = cacheKey(title);

        // Skip if already cached and fresh
        let existing = null;
        try { existing = await cache.get(key, { type: "json" }); } catch (e) {}
        if (existing && existing._cachedAt && (Date.now() - existing._cachedAt < CACHE_TTL_MS)) {
          log.push(`skip-fresh: ${title}`);
          continue;
        }

        try {
          const result = await generateAnalysis(apiKey, title, contextStore);
          if (result) {
            await cache.setJSON(key, { ...result, _cachedAt: Date.now() });
            // Seed trending entry so it appears
            const now = Date.now();
            let td = null;
            try { td = await trending.get(key, { type: "json" }); } catch (e) {}
            if (td) {
              td.count += 1; td.lastSearched = now;
              td.recentSearches = [...(td.recentSearches || []), now].filter(t => now - t < 30 * 24 * 60 * 60 * 1000).slice(-1000);
            } else {
              td = { title, count: 2, firstSearched: now, lastSearched: now, recentSearches: [now, now] };
            }
            await trending.setJSON(key, td);
            seededTopics.push({ key, title, intensity: result.intensity, summary: result.summary, tags: result.tags, readTime: result.readTime });
            log.push(`seeded: ${title}`);
          }
        } catch (e) {
          log.push(`seed-error: ${title} - ${e.message}`);
        }
      }
    }
  } catch (e) {
    log.push(`headlines-error: ${e.message}`);
  }

  // --- PART 2: Refresh stale trending topics ---
  try {
    // Get trending entries by listing the store
    const trendList = await trending.list();
    const now = Date.now();
    const scored = [];

    for (const { key } of trendList.blobs) {
      try {
        const td = await trending.get(key, { type: "json" });
        if (!td || td.count < 2) continue;
        const searches = (td.recentSearches || []).filter(t => now - t < 30 * 24 * 60 * 60 * 1000);
        let score = 0;
        searches.forEach(t => {
          const age = now - t;
          if (age < 24 * 60 * 60 * 1000) score += 10;
          else if (age < 7 * 24 * 60 * 60 * 1000) score += 3;
          else score += 1;
        });
        score += Math.log2(td.count + 1) * 2;
        scored.push({ key, title: td.title, score });
      } catch (e) {}
    }

    scored.sort((a, b) => b.score - a.score);
    const top20 = scored.slice(0, 20);

    for (const { key, title } of top20) {
      let existing = null;
      try { existing = await cache.get(key, { type: "json" }); } catch (e) {}
      if (existing && existing._cachedAt && (Date.now() - existing._cachedAt < CACHE_TTL_MS)) {
        continue; // still fresh
      }

      try {
        const result = await generateAnalysis(apiKey, title, contextStore);
        if (result) {
          await cache.setJSON(key, { ...result, _cachedAt: Date.now() });
          log.push(`refreshed: ${title}`);
        }
      } catch (e) {
        log.push(`refresh-error: ${title} - ${e.message}`);
      }
    }
  } catch (e) {
    log.push(`trending-refresh-error: ${e.message}`);
  }

  // --- PART 3: Build featured topics list (always maintain at least MIN_FEATURED) ---
  try {
    // Gather candidates: seeded topics + top trending with cached analyses
    const featuredCandidates = [...seededTopics];
    const seededKeys = new Set(seededTopics.map(t => t.key));

    // Pull top trending topics that have cached analyses
    const trendList = await trending.list();
    const now = Date.now();
    const trendScored = [];
    for (const { key } of trendList.blobs) {
      if (seededKeys.has(key)) continue; // already included
      try {
        const td = await trending.get(key, { type: "json" });
        if (!td || td.count < 1) continue;
        const searches = (td.recentSearches || []).filter(t => now - t < 30 * 24 * 60 * 60 * 1000);
        let score = 0;
        searches.forEach(t => {
          const age = now - t;
          if (age < 24 * 60 * 60 * 1000) score += 10;
          else if (age < 7 * 24 * 60 * 60 * 1000) score += 3;
          else score += 1;
        });
        score += Math.log2(td.count + 1) * 2;
        trendScored.push({ key, title: td.title, score });
      } catch (e) {}
    }
    trendScored.sort((a, b) => b.score - a.score);

    // Fill from trending
    for (const t of trendScored) {
      if (featuredCandidates.length >= MIN_FEATURED) break;
      try {
        const cached = await cache.get(t.key, { type: "json" });
        if (cached && cached.situation) {
          featuredCandidates.push({
            key: t.key, title: cached.title || t.title,
            intensity: cached.intensity || 'medium', summary: cached.summary || '',
            tags: cached.tags || [], readTime: cached.readTime || 7
          });
        }
      } catch (e) {}
    }

    // If still under MIN_FEATURED, generate more from headlines
    if (featuredCandidates.length < MIN_FEATURED && headlines) {
      const existingKeys = new Set(featuredCandidates.map(t => t.key));
      const moreRaw = await callClaude(apiKey, [{ role: 'user', content: `From these news headlines, extract ${MIN_FEATURED - featuredCandidates.length} additional conflict or policy debate topics NOT in this list: ${[...existingKeys].join(', ')}. Return ONLY a JSON array of short topic titles:\n${headlines}` }], 256);
      let moreClean = moreRaw.replace(/```json|```/g, '').trim();
      const mfi = moreClean.indexOf('['), mli = moreClean.lastIndexOf(']');
      if (mfi >= 0 && mli >= 0) moreClean = moreClean.slice(mfi, mli + 1);
      try {
        const moreTopics = JSON.parse(moreClean);
        for (const title of moreTopics) {
          if (featuredCandidates.length >= MIN_FEATURED) break;
          if (typeof title !== 'string' || title.length < 3) continue;
          const key = cacheKey(title);
          if (existingKeys.has(key)) continue;
          try {
            const result = await generateAnalysis(apiKey, title, contextStore);
            if (result) {
              await cache.setJSON(key, { ...result, _cachedAt: Date.now() });
              const tnow = Date.now();
              await trending.setJSON(key, { title, count: 2, firstSearched: tnow, lastSearched: tnow, recentSearches: [tnow, tnow] });
              featuredCandidates.push({ key, title: result.title || title, intensity: result.intensity, summary: result.summary, tags: result.tags, readTime: result.readTime });
              log.push(`featured-fill: ${title}`);
            }
          } catch (e) { log.push(`featured-fill-error: ${title} - ${e.message}`); }
        }
      } catch (e) { log.push(`featured-fill-parse-error: ${e.message}`); }
    }

    // Save featured list
    await featured.setJSON('featured-list', {
      topics: featuredCandidates.slice(0, 12),
      updatedAt: new Date().toISOString()
    });
    log.push(`featured: ${featuredCandidates.length} topics saved`);
  } catch (e) {
    log.push(`featured-error: ${e.message}`);
  }

  return new Response(JSON.stringify({ ok: true, log, timestamp: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = {
  schedule: "0 8 * * *" // Run daily at 8 AM UTC
};
