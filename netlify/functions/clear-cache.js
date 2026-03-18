// Admin utility: clear all cached analyses to force regeneration with updated context pipeline
// POST /.netlify/functions/clear-cache?key=<admin-secret>
// Or POST with body { "topics": ["us-iran-tensions", "ukraine-russia-war"] } to clear specific topics
import { getStore } from "@netlify/blobs";

export default async function handler(req) {
  // Simple admin auth via query param (set ADMIN_SECRET in Netlify env vars)
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret || key !== adminSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  const cache = getStore("analysis-cache");
  const log = [];

  try {
    let body = {};
    try { body = await req.json(); } catch (e) {}

    if (body.topics && Array.isArray(body.topics)) {
      // Clear specific topics
      for (const topic of body.topics) {
        try {
          await cache.delete(topic);
          log.push(`cleared: ${topic}`);
        } catch (e) {
          log.push(`error: ${topic} - ${e.message}`);
        }
      }
    } else {
      // Clear ALL cached analyses
      const list = await cache.list();
      for (const { key } of list.blobs) {
        try {
          await cache.delete(key);
          log.push(`cleared: ${key}`);
        } catch (e) {
          log.push(`error: ${key} - ${e.message}`);
        }
      }
    }
  } catch (e) {
    log.push(`fatal: ${e.message}`);
  }

  return new Response(JSON.stringify({ ok: true, log, timestamp: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
