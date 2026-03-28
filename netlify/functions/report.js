// Nonprofit Strategy Report Generator
// POST /.netlify/functions/report { "orgName": "...", "orgMission": "...", "topic": "...", "region": "..." }
// Generates a localized strategic briefing for nonprofits and community orgs
import { getStore } from "@netlify/blobs";
import { Sentry } from "./sentry-init.js";

const DATE = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const REPORT_PROMPT = (orgName, orgMission, topic, region, worldContext, analysisContext) => `You are a nonprofit strategy consultant. Generate a strategic briefing for "${orgName}" regarding "${topic}"${region ? ' in ' + region : ''} as of ${DATE}.

Organization mission: ${orgMission}

CURRENT WORLD CONTEXT:
${worldContext}

${analysisContext ? 'EXISTING ANALYSIS OF THIS TOPIC:\n' + analysisContext + '\n' : ''}

Return ONLY raw JSON (no markdown):
{
  "reportTitle": "",
  "executiveSummary": "",
  "landscapeAnalysis": {
    "currentState": "",
    "keyStakeholders": [""],
    "recentDevelopments": [""],
    "localContext": ""
  },
  "strategicRecommendations": [
    {
      "priority": "high",
      "title": "",
      "rationale": "",
      "actions": [""],
      "timeline": "",
      "estimatedCost": ""
    }
  ],
  "fundingOpportunities": [
    {
      "source": "",
      "type": "",
      "relevance": "",
      "deadline": "",
      "url": ""
    }
  ],
  "partnershipOpportunities": [
    {
      "organization": "",
      "type": "",
      "synergy": ""
    }
  ],
  "riskAssessment": [
    {
      "risk": "",
      "likelihood": "",
      "mitigation": ""
    }
  ],
  "metrics": {
    "shortTerm": [""],
    "longTerm": [""]
  },
  "keyDates": [{"date": "", "event": "", "relevance": ""}],
  "bottomLine": ""
}

Requirements:
- 3-5 strategic recommendations ranked by priority (high/medium/low), each with concrete actions, timeline, and cost estimate
- 3+ funding opportunities with real organization names and URLs where possible
- 3+ partnership opportunities with specific org names
- 3+ risks with mitigation strategies
- All recommendations must be actionable by a small nonprofit (1-10 staff, <$500K budget)
- localContext must address the specific region if provided
- fundingOpportunities should include relevant foundations, government grants, and corporate programs
- Be specific and practical, not generic. Name real organizations, real programs, real deadlines where known.`;

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
  return worldState || `Today is ${DATE}. Use your most current knowledge.`;
}

function cacheKey(orgName, topic) {
  return ('report:' + orgName + ':' + topic).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: { 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
    });
  }

  try {
    const body = await req.json();
    const { orgName, orgMission, topic, region } = body;

    if (!orgName || orgName.length < 2) return new Response(JSON.stringify({ error: 'Organization name is required' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' } });
    if (!orgMission || orgMission.length < 10) return new Response(JSON.stringify({ error: 'Please describe your organization\'s mission (at least 10 characters)' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' } });
    if (!topic || topic.length < 3) return new Response(JSON.stringify({ error: 'Topic is required' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' } });

    // Rate limit: 3 reports per IP per day
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('client-ip') || 'unknown';
    const reportStore = getStore("reports");
    const dayKey = `rate:${ip}:${new Date().toISOString().slice(0, 10)}`;
    let dayCount = 0;
    try {
      const existing = await reportStore.get(dayKey, { type: "json" });
      if (existing) dayCount = existing.count || 0;
    } catch (e) {}
    if (dayCount >= 3) {
      return new Response(JSON.stringify({ error: 'You can generate up to 3 reports per day. Try again tomorrow!' }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
      });
    }

    // Check cache (7-day TTL)
    const key = cacheKey(orgName, topic);
    const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    let cached = null;
    try { cached = await reportStore.get(key, { type: "json" }); } catch (e) {}
    if (cached && cached._cachedAt && (Date.now() - cached._cachedAt < CACHE_TTL_MS)) {
      return new Response(JSON.stringify({ ...cached, _cached: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' } });

    // Build context
    const contextStore = getStore("context");
    const worldContext = await buildContext(contextStore, topic);

    // Check if we have an existing analysis for this topic
    const analysisCache = getStore("analysis-cache");
    const topicKey = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let analysisContext = '';
    try {
      const existing = await analysisCache.get(topicKey, { type: "json" });
      if (existing && existing.situation) {
        analysisContext = `Situation: ${existing.situation}\nSides: ${(existing.sides || []).map(s => s.name + ': ' + s.coreBeliefs).join('; ')}\nKey Leaders: ${(existing.keyLeaders || []).map(l => l.name + ' (' + l.role + ')').join(', ')}`;
      }
    } catch (e) {}

    // Generate report via Claude
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
        messages: [{ role: 'user', content: REPORT_PROMPT(orgName, orgMission, topic, region, worldContext, analysisContext) }]
      })
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 402 || res.status === 429) {
        throw new Error('Our report engine is temporarily unavailable. Please try again later.');
      }
      throw new Error(`Report generation failed (${res.status})`);
    }

    const msg = await res.json();
    const raw = msg.content.map(b => b.text || '').join('');
    let clean = raw.replace(/```json|```/g, '').trim();
    const fi = clean.indexOf('{'), li = clean.lastIndexOf('}');
    if (fi >= 0 && li >= 0) clean = clean.slice(fi, li + 1);
    const report = JSON.parse(clean);

    // Cache the report
    const result = { ...report, orgName, orgMission, topic, region: region || '', generatedAt: new Date().toISOString() };
    try { await reportStore.setJSON(key, { ...result, _cachedAt: Date.now() }); } catch (e) {}

    // Increment rate counter
    await reportStore.setJSON(dayKey, { count: dayCount + 1 });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
    });
  } catch (e) {
    console.error('Report error:', e);
    if (Sentry) { try { Sentry.captureException(e); await Sentry.flush(2000); } catch (se) {} }
    return new Response(JSON.stringify({ error: e.message || 'Report generation failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
    });
  }
}
