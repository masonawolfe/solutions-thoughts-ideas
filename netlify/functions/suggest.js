// Suggest a Topic: stores user-submitted topic suggestions
// POST /.netlify/functions/suggest { "topic": "..." }
// Rate limited to 3 suggestions per IP per day
import { getStore } from "@netlify/blobs";

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      status: 204,
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
    const topic = (body.topic || '').trim();

    if (!topic || topic.length < 4 || topic.length > 200) {
      return new Response(JSON.stringify({ error: 'Topic must be between 4 and 200 characters.' }), {
        status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
      });
    }

    // Rate limit: 3 suggestions per IP per day
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('client-ip') || 'unknown';
    const suggestions = getStore("suggestions");
    const dayKey = `rate:${ip}:${new Date().toISOString().slice(0, 10)}`;

    let dayCount = 0;
    try {
      const existing = await suggestions.get(dayKey, { type: "json" });
      if (existing) dayCount = existing.count || 0;
    } catch (e) {}

    if (dayCount >= 3) {
      return new Response(JSON.stringify({ error: 'You can suggest up to 3 topics per day. Try again tomorrow!' }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
      });
    }

    // Store the suggestion
    const suggestionKey = `topic:${Date.now()}:${ip.replace(/[^a-zA-Z0-9]/g, '')}`;
    await suggestions.setJSON(suggestionKey, {
      topic,
      ip,
      submittedAt: new Date().toISOString()
    });

    // Increment daily rate counter
    await suggestions.setJSON(dayKey, { count: dayCount + 1 });

    return new Response(JSON.stringify({ ok: true, message: 'Thanks for your suggestion!' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://solutionsthoughtsideas.com' }
    });
  }
}
