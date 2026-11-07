// Service worker: fetches ratings from AlloCiné, Rotten Tomatoes, IMDb (via OMDb).
const CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 days
const CACHE_VERSION = 'v2';
const inFlight = new Map();

const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');

const decodeHtml = (s) =>
  (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

async function fetchText(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// Score how well a candidate matches the Netflix title.
function matchScore({ titles, year, isSeries, index }, query) {
  const q = norm(query.title);
  let score = 0;
  const ts = titles.map(norm).filter(Boolean);
  const close = (t) => (t.startsWith(q) || q.startsWith(t)) && Math.min(t.length, q.length) / Math.max(t.length, q.length) >= 0.7;
  if (ts.includes(q)) score += 10;
  else if (ts.some(close)) score += 2;
  // Different title (e.g. "Amélie" for the French title): only the top result, only if year + type agree.
  else if (index === 0 && !query.strict) score -= 6;
  else return -Infinity;

  if (query.isSeries != null && isSeries != null) score += query.isSeries === isSeries ? 4 : -4;

  if (query.year && year) {
    const d = query.year - year;
    if (query.isSeries && !query.yearIsStart) {
      // Netflix shows the latest season year; the series started on or before it.
      if (d >= 0) score += 2;
      else if (d < -1) score -= 3;
    } else if (Math.abs(d) <= 1) score += 4;
    else if (Math.abs(d) > 3) score -= 4;
  }
  return score - index * 0.3;
}

function pickBest(cands, query) {
  let best = null;
  let bestScore = -Infinity;
  cands.forEach((c, index) => {
    const s = matchScore({ ...c, index }, query);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  });
  return bestScore > 0 ? best : null;
}

// ---------- AlloCiné ----------
async function allocine(query) {
  const url = `https://www.allocine.fr/_/autocomplete/${encodeURIComponent(query.title)}`;
  const json = JSON.parse(await fetchText(url));
  const cands = (json.results || [])
    .filter((r) => !r.sponsored && (r.entity_type === 'movie' || r.entity_type === 'series'))
    .map((r) => ({
      id: r.entity_id,
      isSeries: r.entity_type === 'series',
      titles: [r.label, r.original_label, ...(r.text_search_data || [])],
      originalTitle: r.original_label || r.label,
      year: parseInt(r.data?.year || (r.data?.first_release || '').slice(0, 4), 10) || null,
    }));
  const best = pickBest(cands, query);
  if (!best) return null;

  const pageUrl = best.isSeries
    ? `https://www.allocine.fr/series/ficheserie_gen_cserie=${best.id}.html`
    : `https://www.allocine.fr/film/fichefilm_gen_cfilm=${best.id}.html`;
  const html = await fetchText(pageUrl);

  const out = { url: pageUrl, press: null, spectators: null, originalTitle: best.originalTitle, year: best.year, isSeries: best.isSeries };
  const re = /class="rating-item"[\s\S]{0,1200}?stareval-note"[^>]*>([^<]*)/g;
  let m;
  while ((m = re.exec(html))) {
    const label = (m[0].match(/rating-title[^>]*>\s*([^<]+)/) || [])[1] || '';
    const val = parseFloat(m[1].replace(',', '.'));
    if (isNaN(val)) continue;
    if (/presse/i.test(label) && out.press == null) out.press = val;
    else if (/spectateur/i.test(label) && out.spectators == null) out.spectators = val;
  }
  return out;
}

// ---------- Rotten Tomatoes ----------
async function rottenTomatoes(query) {
  const url = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(query.title)}`;
  const html = await fetchText(url);
  const rows = html.split('<search-page-media-row').slice(1);
  const cands = rows.map((chunk) => {
    const attr = (n) => (chunk.match(new RegExp(`${n}="([^"]*)"`)) || [])[1] || '';
    const href = (chunk.match(/href="(https:\/\/www\.rottentomatoes\.com\/(?:m|tv)\/[^"]+)"/) || [])[1] || '';
    const alt = decodeHtml((chunk.match(/alt="([^"]*)"/) || [])[1] || '');
    return {
      url: href,
      isSeries: href.includes('/tv/'),
      titles: [alt],
      year: parseInt(attr('release-year') || attr('start-year'), 10) || null,
      score: attr('tomatometer-score') ? parseInt(attr('tomatometer-score'), 10) : null,
      certified: attr('tomatometer-is-certified') === 'true',
    };
  }).filter((c) => c.url);
  const best = pickBest(cands, query);
  if (!best) return null;
  const out = { url: best.url, critics: best.score, certified: best.certified };
  if (out.critics == null) {
    // Series rows in search have no score: read it from the show page.
    try {
      const page = await fetchText(best.url);
      const obj = (page.match(/"criticsScore":\{[^}]*\}/) || [])[0] || '';
      const score = obj.match(/"score":"(\d+)"/) || obj.match(/"scorePercent":"(\d+)%"/);
      if (score) {
        out.critics = parseInt(score[1], 10);
        out.certified = /"certified":true/.test(obj);
      }
    } catch (e) {
      console.warn('RT page failed', e);
    }
  }
  return out;
}

// ---------- IMDb (+ OMDb for the rating) ----------
async function imdb(query, omdbKey) {
  const q = query.title.toLowerCase();
  const url = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(q)}.json`;
  const json = JSON.parse(await fetchText(url));
  const cands = (json.d || [])
    .filter((d) => /^tt/.test(d.id) && /^(movie|tvMovie|tvSeries|tvMiniSeries)$/.test(d.qid || ''))
    .map((d) => ({
      id: d.id,
      titles: [d.l],
      year: d.y || null,
      isSeries: /tvSeries|tvMiniSeries/.test(d.qid),
    }));
  const best = pickBest(cands, query);
  if (!best) return null;
  const out = { url: `https://www.imdb.com/title/${best.id}/`, rating: null, votes: null, metascore: null };

  if (omdbKey) {
    try {
      const o = JSON.parse(await fetchText(`https://www.omdbapi.com/?i=${best.id}&apikey=${encodeURIComponent(omdbKey)}`));
      if (o.Response === 'True') {
        out.rating = parseFloat(o.imdbRating) || null;
        out.votes = o.imdbVotes && o.imdbVotes !== 'N/A' ? o.imdbVotes : null;
        out.metascore = parseInt(o.Metascore, 10) || null;
        const rt = (o.Ratings || []).find((r) => r.Source === 'Rotten Tomatoes');
        if (rt) out.rtFallback = parseInt(rt.Value, 10);
      }
    } catch (e) {
      console.warn('OMDb failed', e);
    }
  }
  return out;
}

async function settle(p) {
  try {
    return await p;
  } catch (e) {
    console.warn(e);
    return null;
  }
}

async function getRatings(query) {
  const key = `${CACHE_VERSION}|${norm(query.title)}|${query.year || ''}|${query.isSeries ?? ''}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.t < CACHE_TTL) return cached.data;
  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    const { omdbKey } = await chrome.storage.sync.get('omdbKey');
    const ac = await settle(allocine(query));

    // Netflix FR often shows the French title: use AlloCiné's original title for English sites.
    const intlQuery = { ...query };
    if (ac) {
      intlQuery.title = ac.originalTitle || query.title;
      intlQuery.year = ac.year || query.year;
      intlQuery.yearIsStart = !!ac.year;
      intlQuery.isSeries = ac.isSeries;
    }
    if (!ac) intlQuery.strict = true; // no AlloCiné anchor: require real title matches
    let [rt, im] = await Promise.all([settle(rottenTomatoes(intlQuery)), settle(imdb(intlQuery, omdbKey))]);
    // Retry each site with the Netflix title (e.g. "Seven" when AlloCiné says "Se7en").
    if (intlQuery.title !== query.title) {
      const strictQ = { ...intlQuery, title: query.title, strict: true };
      [rt, im] = await Promise.all([
        rt ? rt : settle(rottenTomatoes(strictQ)),
        im ? im : settle(imdb(strictQ, omdbKey)),
      ]);
    }
    if (rt && rt.critics == null && im?.rtFallback != null) rt.critics = im.rtFallback;
    if (!rt && im?.rtFallback != null) rt = { url: null, critics: im.rtFallback };

    const data = { allocine: ac, rt, imdb: im, hasOmdbKey: !!omdbKey };
    await chrome.storage.local.set({ [key]: { t: Date.now(), data } });
    return data;
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'getRatings') {
    getRatings(msg.query).then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg?.type === 'clearCache') {
    chrome.storage.local.clear().then(() => sendResponse({ ok: true }));
    return true;
  }
});
