// Seed featured list from existing cached analyses + trending data
// Lightweight — no Claude calls, just reads existing blobs
import { getStore } from "@netlify/blobs";

export default async function handler(req) {
  try {
    const cache = getStore("analysis-cache");
    const trending = getStore("trending");
    const featured = getStore("featured");

    const now = Date.now();
    const candidates = [];
    const tidbits = [];

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
          // Use the SHORT trending title (original search term), not the long AI-generated title
          const shortTitle = t.title;
          // Keep summary under 100 chars for card display
          let summary = cached.summary || '';
          if (summary.length > 120) summary = summary.slice(0, 117) + '...';

          candidates.push({
            key: t.key,
            title: shortTitle,
            intensity: cached.intensity || 'medium',
            summary,
            tags: (cached.tags || []).slice(0, 3),
            readTime: cached.readTime || 7
          });

          // Collect didYouKnow for tidbits
          if (cached.didYouKnow) {
            tidbits.push({ topic: shortTitle, text: cached.didYouKnow });
          }
        }
      } catch (e) {}
    }

    // Save featured list with tidbits
    const data = {
      topics: candidates.slice(0, 12),
      tidbits: tidbits.slice(0, 24),
      updatedAt: new Date().toISOString()
    };
    await featured.setJSON('featured-list', data);

    return new Response(JSON.stringify({ ok: true, count: candidates.length, tidbitsCount: tidbits.length, topics: candidates.map(c => c.title) }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
