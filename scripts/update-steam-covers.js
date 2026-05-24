const fs = require('fs/promises');
const path = require('path');

const root = path.resolve(__dirname, '..');
const libraryPath = path.join(root, 'library.json');
const coversPath = path.join(root, 'steam-covers.json');

const steamOverrides = {
  'baulders gate': { appid: 1086940, name: "Baldur's Gate 3" },
  'psychonauts 1': { appid: 3830, name: 'Psychonauts' },
  'psyconauts 1': { appid: 3830, name: 'Psychonauts' },
  'portal 1': { appid: 400, name: 'Portal' },
  'witness': { appid: 210970, name: 'The Witness' },
  'skyrim': { appid: 489830, name: 'The Elder Scrolls V: Skyrim Special Edition' },
  'city game studio': { appid: 726840, name: 'City Game Studio' },
  'dyson sphere progam': { appid: 1366540, name: 'Dyson Sphere Program' },
  'pheonix point': { appid: 839770, name: 'Phoenix Point' },
  'colonyship': { appid: 648410, name: 'Colony Ship: A Post-Earth Role Playing Game' },
  'drg survivor': { appid: 2321470, name: 'Deep Rock Galactic: Survivor' },
  'horizonm zero dawn': { appid: 1151640, name: 'Horizon Zero Dawn Complete Edition' },
  'dishonoured 1': { appid: 205100, name: 'Dishonored' },
  'dishonoured 2': { appid: 403640, name: 'Dishonored 2' },
  'half life 1': { appid: 70, name: 'Half-Life' },
  'osiris new dawn': { appid: 402710, name: 'Osiris: New Dawn' },
  'borderlands pre sequal': { appid: 261640, name: 'Borderlands: The Pre-Sequel' },
  'norwoord suite': { appid: 696480, name: 'The Norwood Suite' },
  'superhot mcd': { appid: 690040, name: 'SUPERHOT: MIND CONTROL DELETE' },
  'battleblock theatre': { appid: 238460, name: 'BattleBlock Theater' },
  'trucking simulator 2': { appid: 227300, name: 'Euro Truck Simulator 2' },
  'farming simulator 2015': { appid: 313160, name: 'Farming Simulator 15' },
  'farming simulator 2017': { appid: 447020, name: 'Farming Simulator 17' },
  'farming simulator 2019': { appid: 787860, name: 'Farming Simulator 19' },
  'evoland 1': { appid: 233470, name: 'Evoland' },
};

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
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
}

function steamAkamaiHeaderUrl(appid) {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'LeonsGameReviews/1.0',
    },
  });
  if (!response.ok) throw new Error(`Steam returned ${response.status}`);
  return response.json();
}

async function imageExists(url) {
  if (!url) return false;
  try {
    let response = await fetch(url, { method: 'HEAD' });
    if (response.ok) return true;
    if (response.status !== 405 && response.status !== 403) return false;

    response = await fetch(url, { headers: { range: 'bytes=0-0' } });
    return response.ok;
  } catch {
    return false;
  }
}

async function getAppDetails(appid) {
  const data = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`);
  const details = data && data[String(appid)];
  return details && details.success ? details.data : null;
}

async function resolveSteamGame(appid, fallbackName) {
  const details = await getAppDetails(appid);
  const candidates = [
    details && details.header_image,
    steamHeaderUrl(appid),
    steamAkamaiHeaderUrl(appid),
  ].filter(Boolean);

  for (const url of candidates) {
    if (await imageExists(url)) {
      return {
        appid,
        name: (details && details.name) || fallbackName,
        url,
        verified: true,
      };
    }
  }

  return null;
}

async function repairCoverEntry(entry) {
  if (!entry || !entry.appid) return entry || null;
  if (entry.verified && await imageExists(entry.url)) return entry;
  const repaired = await resolveSteamGame(entry.appid, entry.name);
  return repaired || null;
}

async function lookupSteamGame(title) {
  const term = encodeURIComponent(title || '');
  if (!term) return null;

  const searches = [
    async () => {
      const data = await fetchJson(`https://store.steampowered.com/api/storesearch/?term=${term}&l=english&cc=us`);
      return (Array.isArray(data.items) ? data.items : []).map(item => ({
        appid: item.id,
        name: item.name,
        url: steamHeaderUrl(item.id),
        score: scoreTitle(title, item.name),
      }));
    },
    async () => {
      const data = await fetchJson(`https://steamcommunity.com/actions/SearchApps/${term}`);
      return (Array.isArray(data) ? data : []).map(item => ({
        appid: Number(item.appid),
        name: item.name,
        url: steamHeaderUrl(item.appid),
        score: scoreTitle(title, item.name),
      }));
    },
  ];

  for (const search of searches) {
    try {
      const best = (await search()).sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 20 && best.appid) {
        return await resolveSteamGame(best.appid, best.name);
      }
    } catch (error) {
      console.warn(`Steam lookup failed for "${title}": ${error.message}`);
    }
  }

  return null;
}

async function readExistingCovers() {
  try {
    return JSON.parse(await fs.readFile(coversPath, 'utf8'));
  } catch {
    return { version: 1, generatedAt: null, covers: {} };
  }
}

async function main() {
  const library = JSON.parse(await fs.readFile(libraryPath, 'utf8'));
  const games = Array.isArray(library.games) ? library.games : [];
  const output = await readExistingCovers();
  output.version = 1;
  output.covers = output.covers && typeof output.covers === 'object' ? output.covers : {};

  let added = 0;
  for (const game of games) {
    const key = normalizeTitle(game.title);
    if (!key) continue;

    if (steamOverrides[key]) {
      const override = steamOverrides[key];
      output.covers[key] = await resolveSteamGame(override.appid, override.name);
      console.log(`= ${game.title} -> ${override.name} (${override.appid})`);
      continue;
    }

    if (output.covers[key]) {
      const repaired = await repairCoverEntry(output.covers[key]);
      if (repaired) {
        output.covers[key] = repaired;
        continue;
      }
    }

    const result = await lookupSteamGame(game.title);
    if (result) {
      output.covers[key] = {
        appid: result.appid,
        name: result.name,
        url: result.url,
      };
      added++;
      console.log(`+ ${game.title} -> ${result.name} (${result.appid})`);
    } else {
      output.covers[key] = null;
      console.log(`- ${game.title}`);
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  output.generatedAt = new Date().toISOString();
  await fs.writeFile(coversPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${coversPath} (${added} new covers).`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
