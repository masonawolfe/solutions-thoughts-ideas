// Seed function: pre-generate featured topics by calling the search endpoint
// Hit /.netlify/functions/seed?key=<SEED_KEY> to generate all 8 featured topics
import { getStore } from "@netlify/blobs";

const FEATURED_TOPICS = [
  'Israel & Hamas',
  'Abortion rights',
  'Ukraine & Russia',
  'Sunni-Shia divide',
  'US immigration',
  'Climate policy',
  'Gun control',
  'US-Iran tensions'
];

function cacheKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default async function handler(req, context) {
  // Simple auth check
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const seedKey = process.env.SEED_KEY || process.env.ANTHROPIC_API_KEY?.slice(-8);

  if (!key || key !== seedKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Optional: regenerate even if cached
  const force = url.searchParams.get('force') === 'true';

  const cache = getStore("analysis-cache");
  const results = [];

  for (const title of FEATURED_TOPICS) {
    const ck = cacheKey(title);

    // Skip if already cached (unless force)
    if (!force) {
      try {
        const existing = await cache.get(ck, { type: "json" });
        if (existing) {
          results.push({ title, status: 'cached', key: ck });
          continue;
        }
      } catch (e) { /* not cached */ }
    }

    // Call the search function internally
    try {
      const origin = url.origin;
      const res = await fetch(`${origin}/.netlify/functions/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });

      if (res.ok) {
        const data = await res.json();
        results.push({ title, status: 'generated', key: ck, hasData: !!data.title });
      } else {
        const err = await res.text();
        results.push({ title, status: 'error', key: ck, error: err });
      }
    } catch (e) {
      results.push({ title, status: 'error', key: ck, error: e.message });
    }
  }

  return new Response(JSON.stringify({ seeded: results }, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
