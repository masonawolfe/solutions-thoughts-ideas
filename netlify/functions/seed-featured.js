// Seed featured list from existing cached analyses + trending data
// Lightweight — no Claude calls, just reads existing blobs
import { getStore } from "@netlify/blobs";

const MIN_FEATURED = 8;

export default async function handler(req) {
  try {
    const cache = getStore("analysis-cache");
    const trending = getStore("trending");
    const featured = getStore("featured");

    const now = Date.now();
    const candidates = [];

    // Pull all trending topics and score them
    const trendList = await trending.list();
    const scored = [];

    for (const { key } of trendList.blobs) {
      try {
        const td = await trending.get(key, { type: "json" });
        if (!td) continue;
        const searches = (td.recentSearches || []).filter(t => now - t < 30 * 24 * 60 * 60 * 1000);
        let score = 0;
        searches.forEach(t => {
          const age = now - t;
          if (age < 24 * 60 * 60 * 1000) score += 10;
          else if (age < 7 * 24 * 60 * 60 * 1000) score += 3;
          else score += 1;
        });
        score += Math.log2((td.count || 0) + 1) * 2;
        scored.push({ key, title: td.title, score });
      } catch (e) {}
    }

    scored.sort((a, b) => b.score - a.score);

    // For each top topic, pull its cached analysis for card metadata
    for (const t of scored) {
      if (candidates.length >= 12) break;
      try {
        const cached = await cache.get(t.key, { type: "json" });
        if (cached && cached.situation) {
          candidates.push({
            key: t.key,
            title: cached.title || t.title,
            intensity: cached.intensity || 'medium',
            summary: cached.summary || '',
            tags: cached.tags || [],
            readTime: cached.readTime || 7,
            score: t.score
          });
        }
      } catch (e) {}
    }

    // Save featured list
    const data = {
      topics: candidates.slice(0, 12),
      updatedAt: new Date().toISOString()
    };
    await featured.setJSON('featured-list', data);

    return new Response(JSON.stringify({ ok: true, count: candidates.length, topics: candidates.map(c => c.title) }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
