// Seed function: pre-generate featured topics by calling search endpoint
// Hit /.netlify/functions/seed?key=<SEED_KEY> to generate all 8 featured topics

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

export default async function handler(req, context) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret || !key || key !== adminSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const force = url.searchParams.get('force') === 'true';
  const siteUrl = process.env.URL || 'https://solutionsthoughtsideas.com';
  const results = [];

  for (const title of FEATURED_TOPICS) {
    try {
      const res = await fetch(`${siteUrl}/.netlify/functions/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });

      if (res.ok) {
        const data = await res.json();
        results.push({ title, status: data._cached ? 'cached' : 'generated', hasData: !!data.title });
      } else {
        const err = await res.text();
        results.push({ title, status: 'error', error: err.slice(0, 200) });
      }
    } catch (e) {
      results.push({ title, status: 'error', error: e.message });
    }
  }

  return new Response(JSON.stringify({ seeded: results }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}
