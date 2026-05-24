const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 4173);

function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreTitle(query, candidate) {
  const q = normalizeTitle(query);
  const c = normalizeTitle(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.startsWith(q) || q.startsWith(c)) return 80;
  if (c.includes(q) || q.includes(c)) return 60;

  const qWords = new Set(q.split(' ').filter(Boolean));
  const cWords = new Set(c.split(' ').filter(Boolean));
  let overlap = 0;
  for (const word of qWords) {
    if (cWords.has(word)) overlap++;
  }
  return overlap ? 20 + overlap * 8 : 0;
}

function steamHeaderUrl(appid) {
  return appid
    ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`
    : null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'accept': 'application/json',
      'user-agent': 'LeonsGameReviews/1.0',
    },
  });
  if (!response.ok) throw new Error(`Steam returned ${response.status}`);
  return response.json();
}

async function lookupSteamCover(title) {
  const term = encodeURIComponent(title || '');
  if (!term) return null;

  const data = await fetchJson(`https://store.steampowered.com/api/storesearch/?term=${term}&l=english&cc=us`);
  const items = Array.isArray(data.items) ? data.items : [];
  const best = items
    .map(item => ({ item, score: scoreTitle(title, item.name) }))
    .sort((a, b) => b.score - a.score)[0];

  if (best && best.score >= 20) {
    return steamHeaderUrl(best.item.id) || best.item.tiny_image || null;
  }

  const communityData = await fetchJson(`https://steamcommunity.com/actions/SearchApps/${term}`);
  const communityItems = Array.isArray(communityData) ? communityData : [];
  const communityBest = communityItems
    .map(item => ({ item, score: scoreTitle(title, item.name) }))
    .sort((a, b) => b.score - a.score)[0];

  return communityBest && communityBest.score >= 20
    ? steamHeaderUrl(communityBest.item.appid)
    : null;
}

async function serveFile(requestPath, response) {
  const pathname = decodeURIComponent(requestPath === '/' ? '/index.html' : requestPath);
  const fullPath = path.resolve(root, `.${pathname}`);
  if (!fullPath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  const data = await fs.readFile(fullPath);
  const ext = path.extname(fullPath).toLowerCase();
  const contentType = ext === '.html'
    ? 'text/html; charset=utf-8'
    : ext === '.json'
      ? 'application/json; charset=utf-8'
      : 'application/octet-stream';

  response.writeHead(200, { 'content-type': contentType });
  response.end(data);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `127.0.0.1:${port}`}`);

    if (url.pathname === '/steam-cover') {
      const title = url.searchParams.get('title') || '';
      const coverUrl = await lookupSteamCover(title);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ url: coverUrl }));
      return;
    }

    await serveFile(url.pathname, response);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Leon's Game Reviews is running at http://127.0.0.1:${port}/`);
});
