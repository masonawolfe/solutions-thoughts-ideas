// Trending function: Returns top topics by search popularity with time decay
import { getStore } from "@netlify/blobs";

export default async function handler(req, context) {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      }
    });
  }

  try {
    const trending = getStore("trending");
    const cache = getStore("analysis-cache");

    // List all trending entries
    const { blobs } = await trending.list();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const scored = [];

    for (const blob of blobs) {
      try {
        const data = await trending.get(blob.key, { type: "json" });
        if (!data) continue;

        // Score = recent searches weighted by recency
        // Searches in last 24h count 10x, last 7d count 3x, last 30d count 1x
        const recentSearches = data.recentSearches || [];
        let score = 0;
        for (const ts of recentSearches) {
          const age = now - ts;
          if (age < DAY) score += 10;
          else if (age < 7 * DAY) score += 3;
          else score += 1;
        }

        // Bonus for total volume
        score += Math.log2(data.count + 1) * 2;

        // Try to get cached analysis for card data
        let cardData = null;
        try {
          cardData = await cache.get(blob.key, { type: "json" });
        } catch (e) { /* no cached analysis */ }

        scored.push({
          key: blob.key,
          title: data.title,
          score,
          count: data.count,
          lastSearched: data.lastSearched,
          // Card display data from cached analysis
          summary: cardData?.summary || '',
          intensity: cardData?.intensity || 'medium',
          tags: cardData?.tags || [],
          readTime: cardData?.readTime || 7,
          region: cardData?.region || '',
          isWedge: cardData?.isWedge || false
        });
      } catch (e) {
        console.error('Error reading trending entry:', blob.key, e);
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Return top 20
    const top = scored.slice(0, 20);

    return new Response(JSON.stringify({ topics: top, totalTracked: scored.length }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60' // Cache for 1 minute
      }
    });

  } catch (e) {
    console.error('Trending error:', e);
    return new Response(JSON.stringify({ topics: [], error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
