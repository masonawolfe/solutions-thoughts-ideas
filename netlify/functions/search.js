// Search function: AI-powered topic analysis with caching + trending tracking
import { getStore } from "@netlify/blobs";
import { Sentry } from "./sentry-init.js";

const YEAR = new Date().getFullYear();
const DATE = new Date().toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'});

const USER_PROMPT = (title, worldContext) => `You are a nonpartisan analyst. Analyze "${title}" as of ${DATE}.

CURRENT WORLD CONTEXT (use this as ground truth for current facts — do NOT contradict it):
${worldContext}

Return ONLY raw JSON (no markdown):
{"isValidTopic":true,"invalidReason":"","title":"","isWedge":false,"intensity":"high","region":"","sensitivity":null,"summary":"","tags":[],"readTime":7,"lastVerified":"${DATE}","keyDates":[{"date":"","event":""}],"situation":"","sides":[{"name":"","coreBeliefs":"","keyFigures":"","c":"sc1"}],"importantDistinction":"","missingVoices":"","powerBrokers":[{"name":"","description":""}],"gameTheory":"","keyLeaders":[{"name":"","role":"","stake":""}],"resolutionPaths":[{"title":"","description":""}],"historicalPrecedent":"","quickTake":"","pullQuote":"","didYouKnow":"","discussionGuide":{"ageNote":"Ages 14+","starters":[],"values":"","redFlags":"","activity":""},"organizations":[{"name":"","what":"","tag":"","url":""}],"actions":[{"icon":"","title":"","desc":"","links":[{"text":"","url":""}]}],"sources":[{"id":1,"text":"","org":"","url":"","date":"${YEAR}"}]}
Requirements: 3 sides, 4 power brokers, 4 key leaders with FULL NAMES, 3 resolution paths, 3 organizations with URLs, 3 actions with emoji icons and URLs, 5 sources. keyDates MUST span the FULL history of the conflict — from its origins through every major escalation, turning point, and agreement up to the most recent 2025-2026 events. Include 8-12 key dates minimum. The CURRENT WORLD CONTEXT above is for grounding recent facts only — do NOT limit your historical analysis to recent headlines. Be concise but historically comprehensive. didYouKnow MUST be a single surprising, complete sentence under 130 characters — a self-contained fact that lands without needing more context. intensity MUST be calibrated: "critical" = active armed conflict or imminent crisis with casualties, "high" = major active political/social conflict with frequent escalation, "medium" = ongoing policy debate or simmering tension, "low" = largely resolved or theoretical disagreement. Most topics should NOT be "high" — use the full range.`;

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

async function buildContext(contextStore, topic) {
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

function cacheKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Basic content filter — blocks slurs, explicit content, and nonsense
const BLOCKED_PATTERNS = [
  /\b(fuck|shit|ass|bitch|cunt|dick|cock|pussy|nigger|faggot|retard|whore|slut)\b/i,
  /\b(porn|hentai|xxx|nude|naked|nsfw)\b/i,
  /(.)\1{5,}/, // repeated chars like "aaaaaaa"
  /^[^a-zA-Z]*$/, // no letters at all
];

function isBlockedInput(title) {
  return BLOCKED_PATTERNS.some(p => p.test(title));
}

// Rate limiter: Upstash Redis (persistent across cold starts) with in-memory fallback
import { Redis } from "@upstash/redis";

const RATE_MAX = 5;
const RATE_WINDOW_SEC = 60;

let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

// Fallback in-memory limiter (used when Upstash not configured)
const rateLimitsMemory = new Map();

async function isRateLimited(ip) {
  if (redis) {
    try {
      const key = `rate:${ip}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, RATE_WINDOW_SEC);
      return count > RATE_MAX;
    } catch (e) {
      console.error('[RATE_LIMIT] Redis error, falling back to memory:', e.message);
    }
  }
  // In-memory fallback
  const now = Date.now();
  const entry = rateLimitsMemory.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_SEC * 1000) {
    rateLimitsMemory.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX;
}

async function callClaude(apiKey, title, worldContext) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: USER_PROMPT(title, worldContext) }]
    })
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 402 || res.status === 429) {
      const tag = res.status === 429 ? '[RATE_LIMIT]' : '[CREDITS]';
      console.error(`${tag} Claude API returned ${res.status}`);
      throw new Error('Our analysis engine is temporarily unavailable. Please try again later.');
    }
    throw new Error(`Claude API ${res.status}`);
  }
  return res.json();
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: { 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    });
  }
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    // Rate limit by IP
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('client-ip') || 'unknown';
    if (await isRateLimited(ip)) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please wait a minute.' }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
      });
    }

    const { title } = await req.json();
    if (!title || title.length < 3) return new Response(JSON.stringify({ error: 'Title too short' }), { status: 400 });
    if (title.length > 200) return new Response(JSON.stringify({ error: 'Title too long' }), { status: 400 });
    if (isBlockedInput(title)) {
      return new Response(JSON.stringify({ isValidTopic: false, invalidReason: 'Please search for a real conflict or policy topic.' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
      });
    }

    const key = cacheKey(title);
    const cache = getStore("analysis-cache");
    const trending = getStore("trending");

    // Check cache — expire after 7 days, or if missing timestamp (pre-TTL), or if empty content
    const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    let cached = null;
    try { cached = await cache.get(key, { type: "json" }); } catch (e) {}
    if (cached) {
      const isStale = !cached._cachedAt || (Date.now() - cached._cachedAt > CACHE_TTL_MS);
      const isEmpty = !cached.situation && (!cached.sides || cached.sides.length === 0);
      if (isStale || isEmpty) cached = null; // regenerate
    }

    // Track in trending
    try {
      let td = null;
      try { td = await trending.get(key, { type: "json" }); } catch (e) {}
      const now = Date.now();
      if (td) {
        td.count += 1; td.lastSearched = now;
        td.recentSearches = [...(td.recentSearches || []), now].filter(t => now - t < 30*24*60*60*1000).slice(-1000);
      } else {
        td = { title, count: 1, firstSearched: now, lastSearched: now, recentSearches: [now] };
      }
      await trending.setJSON(key, td);
    } catch (e) {}

    if (cached) {
      return new Response(JSON.stringify({ ...cached, _cached: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500 });

    // Build current world context: world-state blob + topic-specific headlines
    const contextStore = getStore("context");
    const worldContext = await buildContext(contextStore, title);

    const msg = await callClaude(apiKey, title, worldContext);
    const raw = msg.content.map(b => b.text || '').join('');
    let clean = raw.replace(/```json|```/g, '').trim();
    const fi = clean.indexOf('{'), li = clean.lastIndexOf('}');
    if (fi >= 0 && li >= 0) clean = clean.slice(fi, li + 1);
    const p = JSON.parse(clean);

    if (p.isValidTopic === false) {
      return new Response(JSON.stringify({ isValidTopic: false, invalidReason: p.invalidReason || 'Not recognized.' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
      });
    }

    const result = {
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

    try { await cache.setJSON(key, { ...result, _cachedAt: Date.now() }); } catch (e) {}

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
    });
  } catch (e) {
    console.error('Search error:', e);
    if (Sentry) { Sentry.captureException(e); await Sentry.flush(2000).catch(() => {}); }
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
    });
  }
}
