// Search function: AI-powered topic analysis with caching + trending tracking
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a nonpartisan educational analyst for "Solutions, Thoughts & Ideas" — a platform helping people understand every side of complex conflicts and policy debates. Present every topic fairly without political bias. Be thorough but concise. Always use current, up-to-date information including current officeholders and leaders.`;

const USER_PROMPT = (title) => `Analyze: "${title}"

Return ONLY raw JSON (no markdown, no code fences):
{
  "isValidTopic": true,
  "invalidReason": "",
  "title": "Proper title for this topic",
  "isWedge": false,
  "intensity": "high",
  "region": "Region or scope",
  "sensitivity": "Brief sensitivity note if needed, or null",
  "summary": "One-line summary for card display",
  "tags": ["Tag1", "Tag2"],
  "readTime": 7,
  "lastVerified": "${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}",
  "keyDates": [{"date": "Year", "event": "What happened"}],
  "situation": "Paragraph 1\\nParagraph 2",
  "sides": [{"name": "Side name", "coreBeliefs": "What they believe", "keyFigures": "Key people", "c": "sc1"}],
  "importantDistinction": "Key nuance people miss",
  "missingVoices": "Perspectives often left out",
  "powerBrokers": [{"name": "Entity", "description": "Their role"}],
  "gameTheory": "Strategic dynamics paragraph",
  "keyLeaders": [{"name": "Full name of current officeholder", "role": "Their current title", "stake": "What they want and why"}],
  "resolutionPaths": [{"title": "Path name", "description": "How it works"}],
  "historicalPrecedent": "Similar historical situations",
  "quickTake": "2-3 sentence accessible summary for someone new to this topic",
  "pullQuote": "One pithy sentence that captures the core tension",
  "didYouKnow": "One surprising fact about this topic",
  "discussionGuide": {
    "ageNote": "Recommended for ages 14+",
    "starters": ["Discussion question 1?", "Discussion question 2?", "Discussion question 3?"],
    "values": "What values are in tension in this debate",
    "redFlags": "Warning signs of oversimplification or bias to watch for",
    "activity": "A hands-on activity to deepen understanding"
  },
  "organizations": [
    {"name": "Org name", "what": "What they do", "tag": "Category", "url": "https://example.org"}
  ],
  "actions": [
    {"icon": "emoji", "title": "Action title", "desc": "Brief description", "links": [{"text": "Link text", "url": "https://example.org"}]}
  ],
  "sources": [
    {"id": 1, "text": "What this source covers", "org": "Publisher name", "url": "https://example.org", "date": "${new Date().getFullYear()}"}
  ]
}

Important:
- Use CURRENT officeholders and leaders with their full names (e.g., the actual current US President, not a generic placeholder)
- Provide 3-5 key leaders, 3-5 sides, 4-6 power brokers, 3-4 resolution paths
- Provide 3-4 organizations with real, working URLs
- Provide 3-4 action items with real, working URLs to relevant organizations
- Provide 5-8 sources from major outlets with real URLs
- Use emojis for action icons (📖, ✊, 🗳️, 📢, etc.)
- Assign side colors as "sc1", "sc2", "sc3", "sc4" etc.
- All information must be current as of ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;

function cacheKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default async function handler(req, context) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
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

    // Check cache first
    const cache = getStore("analysis-cache");
    const trending = getStore("trending");

    let cached = null;
    try {
      cached = await cache.get(key, { type: "json" });
    } catch (e) { /* not cached */ }

    // Track this search in trending (regardless of cache hit)
    try {
      let trendData = null;
      try {
        trendData = await trending.get(key, { type: "json" });
      } catch (e) { /* new topic */ }

      const now = Date.now();
      if (trendData) {
        trendData.count += 1;
        trendData.lastSearched = now;
        // Keep recent timestamps for decay calculation (last 30 days)
        trendData.recentSearches = [...(trendData.recentSearches || []), now]
          .filter(t => now - t < 30 * 24 * 60 * 60 * 1000)
          .slice(-1000);
      } else {
        trendData = {
          title: title,
          count: 1,
          firstSearched: now,
          lastSearched: now,
          recentSearches: [now]
        };
      }
      await trending.setJSON(key, trendData);
    } catch (e) {
      console.error('Trending track error:', e);
    }

    if (cached) {
      return new Response(JSON.stringify({ ...cached, _cached: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Generate with Claude API
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500 });
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 5000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT(title) }]
    });

    const raw = message.content.map(b => b.text || '').join('');
    let clean = raw.replace(/```json|```/g, '').trim();
    const fi = clean.indexOf('{'), li = clean.lastIndexOf('}');
    if (fi >= 0 && li >= 0) clean = clean.slice(fi, li + 1);

    const parsed = JSON.parse(clean);

    if (parsed.isValidTopic === false) {
      return new Response(JSON.stringify({ isValidTopic: false, invalidReason: parsed.invalidReason || 'Not a recognized topic.' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Normalize the response
    const result = {
      title: parsed.title || title,
      isWedge: !!parsed.isWedge,
      intensity: parsed.intensity || 'medium',
      region: parsed.region || '',
      sensitivity: parsed.sensitivity || null,
      summary: parsed.summary || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      readTime: parsed.readTime || 7,
      lastVerified: parsed.lastVerified || '',
      keyDates: Array.isArray(parsed.keyDates) ? parsed.keyDates : [],
      situation: parsed.situation || '',
      sides: Array.isArray(parsed.sides) ? parsed.sides : [],
      importantDistinction: parsed.importantDistinction || '',
      missingVoices: parsed.missingVoices || '',
      powerBrokers: Array.isArray(parsed.powerBrokers) ? parsed.powerBrokers : [],
      gameTheory: parsed.gameTheory || '',
      keyLeaders: Array.isArray(parsed.keyLeaders) ? parsed.keyLeaders : [],
      resolutionPaths: Array.isArray(parsed.resolutionPaths) ? parsed.resolutionPaths : [],
      historicalPrecedent: parsed.historicalPrecedent || '',
      quickTake: parsed.quickTake || '',
      pullQuote: parsed.pullQuote || '',
      didYouKnow: parsed.didYouKnow || '',
      discussionGuide: parsed.discussionGuide || null,
      organizations: Array.isArray(parsed.organizations) ? parsed.organizations : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources : []
    };

    // Cache the result (persists indefinitely)
    try {
      await cache.setJSON(key, result);
    } catch (e) {
      console.error('Cache write error:', e);
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e) {
    console.error('Search error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
