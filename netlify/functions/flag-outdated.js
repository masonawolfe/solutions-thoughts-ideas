// Flag a topic as outdated — increments a counter in Blobs
import { getStore } from "@netlify/blobs";

function cacheKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    });
  }
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const { title } = await req.json();
    if (!title || title.length < 3) return new Response(JSON.stringify({ error: 'Title required' }), { status: 400 });

    const key = cacheKey(title);
    const flags = getStore("outdated-flags");

    let entry = null;
    try { entry = await flags.get(key, { type: "json" }); } catch (e) {}

    const now = Date.now();
    if (!entry) {
      entry = { title, count: 1, firstFlagged: now, lastFlagged: now };
    } else {
      entry.count += 1;
      entry.lastFlagged = now;
    }

    await flags.setJSON(key, entry);

    // If threshold reached (3+ flags), clear the analysis cache to force regeneration
    const THRESHOLD = 3;
    if (entry.count >= THRESHOLD) {
      const cache = getStore("analysis-cache");
      try { await cache.delete(key); } catch (e) {}
      // Reset flag count
      await flags.setJSON(key, { ...entry, count: 0, lastReset: now });
      return new Response(JSON.stringify({ flagged: true, refreshQueued: true, message: 'Thanks! This topic will be refreshed with current data.' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    return new Response(JSON.stringify({ flagged: true, refreshQueued: false, count: entry.count, threshold: THRESHOLD, message: `Flagged as outdated (${entry.count}/${THRESHOLD} needed to trigger refresh).` }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
