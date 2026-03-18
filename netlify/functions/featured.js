// Featured topics endpoint: returns curated topics for the homepage
import { getStore } from "@netlify/blobs";

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' } });
  }

  try {
    const featured = getStore("featured");
    const data = await featured.get('featured-list', { type: 'json' });

    if (!data || !data.topics || data.topics.length === 0) {
      return new Response(JSON.stringify({ topics: [], updatedAt: null }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ topics: [], error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
