// Daily cron: seed new topics from headlines + refresh stale trending analyses + maintain world-state context
import { getStore } from "@netlify/blobs";

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
{"isValidTopic":true,"invalidReason":"","title":"","isWedge":false,"intensity":"high","region":"","sensitivity":null,"summary":"","tags":[],"readTime":7,"lastVerified":"${DATE}","keyDates":[{"date":"","event":""}],"situation":"","sides":[{"name":"","coreBeliefs":"","keyFigures":"","c":"sc1"}],"importantDistinction":"","missingVoices":"","powerBrokers":[{"name":"","description":""}],"gameTheory":"","keyLeaders":[{"name":"","role":"","stake":""}],"resolutionPaths":[{"title":"","description":""}],"historicalPrecedent":"","quickTake":"","pullQuote":"","didYouKnow":"","discussionGuide":{"ageNote":"Ages 14+","starters":[],"values":"","redFlags":"","activity":""},"organizations":[{"name":"","what":"","tag":"","url":""}],"actions":[{"icon":"","title":"","desc":"","links":[{"text":"","url":""}]}],"sources":[{"id":1,"text":"","org":"","url":"","date":"${YEAR}"}]}
Requirements: 3 sides, 4 power brokers, 4 key leaders with FULL NAMES, 3 resolution paths, 3 organizations with URLs, 3 actions with emoji icons and URLs, 5 sources. keyDates MUST span the FULL history of the conflict — from its origins through every major escalation, turning point, and agreement up to the most recent 2025-2026 events. Include 8-12 key dates minimum. The CURRENT WORLD CONTEXT above is for grounding recent facts only — do NOT limit your historical analysis to recent headlines. Be concise but historically comprehensive.`;

const EXTRACT_PROMPT = (headlines) => `From these news headlines, extract 3-5 major conflict or policy debate topics suitable for balanced multi-perspective analysis. Only pick substantive geopolitical conflicts or policy debates, not celebrity news or sports. Return ONLY a JSON array of short topic titles (2-5 words each):
${headlines}`;

function cacheKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function callClaude(apiKey, messages, maxTokens = 4096) {
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
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
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
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const log = [];

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
      const raw = await callClaude(apiKey, [{ role: 'user', content: EXTRACT_PROMPT(headlines) }], 256);
      let clean = raw.replace(/```json|```/g, '').trim();
      const fi = clean.indexOf('['), li = clean.lastIndexOf(']');
      if (fi >= 0 && li >= 0) clean = clean.slice(fi, li + 1);
      const topics = JSON.parse(clean);

      for (const title of topics.slice(0, 5)) {
        if (typeof title !== 'string' || title.length < 3) continue;
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

  return new Response(JSON.stringify({ ok: true, log, timestamp: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = {
  schedule: "0 8 * * *" // Run daily at 8 AM UTC
};
