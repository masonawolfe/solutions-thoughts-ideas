// Search function: AI-powered topic analysis with caching + trending tracking
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a nonpartisan educational analyst. Present every topic fairly without bias. Use current officeholders' full names. Return ONLY raw JSON.`;

const USER_PROMPT = (title) => `Analyze "${title}" as of ${new Date().toLocaleDateString('en-US', {month:'long',year:'numeric'})}. Return raw JSON only (no markdown/fences):
{"isValidTopic":true,"invalidReason":"","title":"","isWedge":false,"intensity":"high|medium|low","region":"","sensitivity":"or null","summary":"one line","tags":["",""],"readTime":7,"lastVerified":"${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}","keyDates":[{"date":"","event":""}],"situation":"para1\\npara2","sides":[{"name":"","coreBeliefs":"","keyFigures":"","c":"sc1"}],"importantDistinction":"","missingVoices":"","powerBrokers":[{"name":"","description":""}],"gameTheory":"","keyLeaders":[{"name":"FULL NAME","role":"current title","stake":""}],"resolutionPaths":[{"title":"","description":""}],"historicalPrecedent":"","quickTake":"2-3 sentences","pullQuote":"one sentence","didYouKnow":"surprising fact","discussionGuide":{"ageNote":"Recommended for ages 14+","starters":["?","?","?"],"values":"","redFlags":"","activity":""},"organizations":[{"name":"","what":"","tag":"","url":"https://"}],"actions":[{"icon":"emoji","title":"","desc":"","links":[{"text":"","url":"https://"}]}],"sources":[{"id":1,"text":"","org":"","url":"https://","date":"${new Date().getFullYear()}"}]}
Give 3-4 sides, 4-6 power brokers, 3-5 key leaders (FULL NAMES of current officeholders), 3-4 resolution paths, 3 organizations, 3-4 actions with emoji icons and real URLs, 5-8 sources. Side colors: sc1-sc6.`;

function cacheKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default async function handler(req, context) {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { title } = await req.json();
    if (!title || title.length < 3) {
      return new Response(JSON.stringify({ error: 'Title too short' }), { status: 400 });
    }

    const key = cacheKey(title);
    const cache = getStore("analysis-cache");
    const trending = getStore("trending");

    let cached = null;
    try { cached = await cache.get(key, { type: "json" }); } catch (e) {}

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
    } catch (e) { console.error('Trending error:', e); }

    if (cached) {
      return new Response(JSON.stringify({ ...cached, _cached: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500 });
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT(title) }]
    });

    const raw = message.content.map(b => b.text || '').join('');
    let clean = raw.replace(/```json|```/g, '').trim();
    const fi = clean.indexOf('{'), li = clean.lastIndexOf('}');
    if (fi >= 0 && li >= 0) clean = clean.slice(fi, li + 1);

    const p = JSON.parse(clean);

    if (p.isValidTopic === false) {
      return new Response(JSON.stringify({ isValidTopic: false, invalidReason: p.invalidReason || 'Not a recognized topic.' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const result = {
      title: p.title || title, isWedge: !!p.isWedge, intensity: p.intensity || 'medium',
      region: p.region || '', sensitivity: p.sensitivity || null, summary: p.summary || '',
      tags: Array.isArray(p.tags) ? p.tags : [], readTime: p.readTime || 7,
      lastVerified: p.lastVerified || '', keyDates: Array.isArray(p.keyDates) ? p.keyDates : [],
      situation: p.situation || '', sides: Array.isArray(p.sides) ? p.sides : [],
      importantDistinction: p.importantDistinction || '', missingVoices: p.missingVoices || '',
      powerBrokers: Array.isArray(p.powerBrokers) ? p.powerBrokers : [],
      gameTheory: p.gameTheory || '', keyLeaders: Array.isArray(p.keyLeaders) ? p.keyLeaders : [],
      resolutionPaths: Array.isArray(p.resolutionPaths) ? p.resolutionPaths : [],
      historicalPrecedent: p.historicalPrecedent || '', quickTake: p.quickTake || '',
      pullQuote: p.pullQuote || '', didYouKnow: p.didYouKnow || '',
      discussionGuide: p.discussionGuide || null,
      organizations: Array.isArray(p.organizations) ? p.organizations : [],
      actions: Array.isArray(p.actions) ? p.actions : [],
      sources: Array.isArray(p.sources) ? p.sources : []
    };

    try { await cache.setJSON(key, result); } catch (e) { console.error('Cache write error:', e); }

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
