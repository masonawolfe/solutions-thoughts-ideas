// News function: Fetches live headlines for a topic via Google News RSS
// Completely free - no API key needed

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
    const url = new URL(req.url);
    const topic = url.searchParams.get('topic');
    if (!topic) {
      return new Response(JSON.stringify({ error: 'Missing topic parameter' }), { status: 400 });
    }

    // Google News RSS feed - free, no key needed
    const query = encodeURIComponent(topic);
    const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

    const rssResp = await fetch(rssUrl, {
      headers: { 'User-Agent': 'SolutionsThoughtsIdeas/2.0' }
    });

    if (!rssResp.ok) {
      throw new Error(`RSS fetch failed: ${rssResp.status}`);
    }

    const xml = await rssResp.text();

    // Simple XML parsing for RSS items (no dependency needed)
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
      const itemXml = match[1];

      const getTag = (tag) => {
        const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's');
        const m = itemXml.match(r);
        return m ? m[1].trim() : '';
      };

      const title = getTag('title');
      const link = getTag('link');
      const pubDate = getTag('pubDate');
      const source = getTag('source');

      if (title && link) {
        items.push({
          title: decodeEntities(title),
          link,
          source: decodeEntities(source) || 'News',
          pubDate: pubDate ? new Date(pubDate).toISOString() : null,
          timeAgo: pubDate ? getTimeAgo(new Date(pubDate)) : ''
        });
      }
    }

    return new Response(JSON.stringify({ articles: items, topic }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=900' // Cache for 15 minutes
      }
    });

  } catch (e) {
    console.error('News error:', e);
    return new Response(JSON.stringify({ articles: [], error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '');
}

function getTimeAgo(date) {
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
