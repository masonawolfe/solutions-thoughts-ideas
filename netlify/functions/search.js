// Search function: AI-powered topic analysis with caching + trending tracking
import { getStore } from "@netlify/blobs";

const YEAR = new Date().getFullYear();
const DATE = new Date().toLocaleDateString('en-US', {month:'long',year:'numeric'});

const USER_PROMPT = (title) => `You are a nonpartisan analyst. Analyze "${title}" as of ${DATE}. Use FULL NAMES of current officeholders. Return ONLY raw JSON (no markdown):
{"isValidTopic":true,"invalidReason":"","title":"","isWedge":false,"intensity":"high","region":"","sensitivity":null,"summary":"","tags":[],"readTime":7,"lastVerified":"${DATE}","keyDates":[{"date":"","event":""}],"situation":"","sides":[{"name":"","coreBeliefs":"","keyFigures":"","c":"sc1"}],"importantDistinction":"","missingVoices":"","powerBrokers":[{"name":"","description":""}],"gameTheory":"","keyLeaders":[{"name":"","role":"","stake":""}],"resolutionPaths":[{"title":"","description":""}],"historicalPrecedent":"","quickTake":"","pullQuote":"","didYouKnow":"","discussionGuide":{"ageNote":"Ages 14+","starters":[],"values":"","redFlags":"","activity":""},"organizations":[{"name":"","what":"","tag":"","url":""}],"actions":[{"icon":"","title":"","desc":"","links":[{"text":"","url":""}]}],"sources":[{"id":1,"text":"","org":"","url":"","date":"${YEAR}"}]}
Requirements: 3 sides, 4 power brokers, 4 key leaders with FULL NAMES, 3 resolution paths, 3 organizations with URLs, 3 actions with emoji icons and URLs, 5 sources. Be concise.`;

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

// In-memory rate limiter (per function instance — resets on cold start, good enough for basic protection)
const rateLimits = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 5;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimits.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_MAX) return true;
  return false;
}

async function callClaude(apiKey, title) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: USER_PROMPT(title) }]
    })
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  return res.json();
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    });
  }
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    // Rate limit by IP
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('client-ip') || 'unknown';
    if (isRateLimited(ip)) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please wait a minute.' }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const { title } = await req.json();
    if (!title || title.length < 3) return new Response(JSON.stringify({ error: 'Title too short' }), { status: 400 });
    if (title.length > 200) return new Response(JSON.stringify({ error: 'Title too long' }), { status: 400 });
    if (isBlockedInput(title)) {
      return new Response(JSON.stringify({ isValidTopic: false, invalidReason: 'Please search for a real conflict or policy topic.' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
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
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500 });

    const msg = await callClaude(apiKey, title);
    const raw = msg.content.map(b => b.text || '').join('');
    let clean = raw.replace(/```json|```/g, '').trim();
    const fi = clean.indexOf('{'), li = clean.lastIndexOf('}');
    if (fi >= 0 && li >= 0) clean = clean.slice(fi, li + 1);
    const p = JSON.parse(clean);

    if (p.isValidTopic === false) {
      return new Response(JSON.stringify({ isValidTopic: false, invalidReason: p.invalidReason || 'Not recognized.' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    console.error('Search error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
