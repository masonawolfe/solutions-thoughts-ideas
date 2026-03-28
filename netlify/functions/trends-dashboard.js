// Trend Intelligence Dashboard: detailed analytics on search patterns
// GET /.netlify/functions/trends-dashboard
// Returns enriched trending data with velocity, time-series, and category breakdowns
import { getStore } from "@netlify/blobs";

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: { 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
    });
  }

  try {
    const trending = getStore("trending");
    const cache = getStore("analysis-cache");
    const { blobs } = await trending.list();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const topics = [];
    let totalSearches = 0;
    let last24h = 0;
    let last7d = 0;

    for (const blob of blobs) {
      try {
        const data = await trending.get(blob.key, { type: "json" });
        if (!data || !data.count) continue;

        const searches = (data.recentSearches || []).filter(t => now - t < 30 * DAY);
        const h24 = searches.filter(t => now - t < DAY).length;
        const d7 = searches.filter(t => now - t < 7 * DAY).length;
        const d30 = searches.length;

        // Velocity: compare last 7d to prior 7d
        const thisWeek = searches.filter(t => now - t < 7 * DAY).length;
        const lastWeek = searches.filter(t => now - t >= 7 * DAY && now - t < 14 * DAY).length;
        const velocity = lastWeek === 0 ? (thisWeek > 0 ? 100 : 0) : Math.round(((thisWeek - lastWeek) / lastWeek) * 100);

        // Score (same as trending.js)
        let score = 0;
        searches.forEach(t => {
          const age = now - t;
          if (age < DAY) score += 10;
          else if (age < 7 * DAY) score += 3;
          else score += 1;
        });
        score += Math.log2(data.count + 1) * 2;

        // Time series: daily counts for last 14 days
        const daily = [];
        for (let i = 13; i >= 0; i--) {
          const dayStart = now - (i + 1) * DAY;
          const dayEnd = now - i * DAY;
          const count = searches.filter(t => t >= dayStart && t < dayEnd).length;
          const date = new Date(dayEnd).toISOString().slice(5, 10); // MM-DD
          daily.push({ date, count });
        }

        // Get cached analysis for category data
        let analysis = null;
        try { analysis = await cache.get(blob.key, { type: "json" }); } catch (e) {}

        totalSearches += data.count;
        last24h += h24;
        last7d += d7;

        topics.push({
          key: blob.key,
          title: data.title,
          score,
          count: data.count,
          h24, d7, d30,
          velocity,
          daily,
          firstSearched: data.firstSearched,
          lastSearched: data.lastSearched,
          // From analysis
          intensity: analysis?.intensity || 'medium',
          region: analysis?.region || '',
          statusCategory: analysis?.statusAssessment?.category || '',
          trajectory: analysis?.statusAssessment?.trajectory || '',
          disagreementType: analysis?.disagreementType?.primary || '',
          tags: analysis?.tags || []
        });
      } catch (e) {}
    }

    topics.sort((a, b) => b.score - a.score);

    // Aggregate stats
    const emerging = [...topics].sort((a, b) => b.velocity - a.velocity).filter(t => t.d7 >= 2).slice(0, 5);
    const byCategory = {};
    const byStatus = {};
    const byRegion = {};
    topics.forEach(t => {
      if (t.disagreementType) byCategory[t.disagreementType] = (byCategory[t.disagreementType] || 0) + 1;
      if (t.statusCategory) byStatus[t.statusCategory] = (byStatus[t.statusCategory] || 0) + 1;
      if (t.region) byRegion[t.region] = (byRegion[t.region] || 0) + 1;
    });

    return new Response(JSON.stringify({
      topics: topics.slice(0, 50),
      summary: {
        totalTopics: topics.length,
        totalSearches,
        last24h,
        last7d,
        emerging: emerging.map(t => ({ title: t.title, velocity: t.velocity, d7: t.d7 })),
        byCategory,
        byStatus,
        byRegion
      },
      generatedAt: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com',
        'Cache-Control': 'public, max-age=120'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
    });
  }
}
