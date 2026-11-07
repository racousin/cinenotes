// Ranking panel: collects every title card on the page, fetches ratings, lists them sorted.
(() => {
  const CONCURRENCY = 3;
  const alive = () => !!globalThis.chrome?.runtime?.id;
  const items = new Map(); // netflixId -> { id, title, data, status }
  const queue = [];
  let running = 0;
  let panel, listEl, statusEl;
  let sortKey = 'avg';
  let typeFilter = 'all';

  const SORTS = {
    avg: { label: 'Moyenne de toutes les notes', get: (d) => avgScore(d) },
    spect: { label: 'AlloCiné Spectateurs', get: (d) => d?.allocine?.spectators },
    press: { label: 'AlloCiné Presse', get: (d) => d?.allocine?.press },
    imdb: { label: 'IMDb', get: (d) => d?.imdb?.rating },
    rt: { label: 'Rotten Tomatoes', get: (d) => d?.rt?.critics },
  };

  // Everything on a 0–100 scale, averaged over the ratings that exist.
  function avgScore(d) {
    if (!d) return null;
    const vals = [
      d.allocine?.spectators != null && d.allocine.spectators * 20,
      d.allocine?.press != null && d.allocine.press * 20,
      d.imdb?.rating != null && d.imdb.rating * 10,
      d.rt?.critics != null && d.rt.critics,
    ].filter((v) => v !== false);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  // ---------- Collect title cards ----------
  function collect() {
    const newIds = [];
    document.querySelectorAll('a[href*="jbv="], a[href*="/watch/"], a[href*="/title/"]').forEach((a) => {
      const id = (a.getAttribute('href').match(/(?:jbv=|\/watch\/|\/title\/)(\d+)/) || [])[1];
      if (!id || items.has(id)) return;
      if (a.closest('.nfr-panel')) return;
      const card = a.closest('.title-card, .slider-item, .ptrack-content, [class*="title-card"]') || a;
      const title = (
        a.getAttribute('aria-label') ||
        card.querySelector('.fallback-text')?.textContent ||
        card.querySelector('img[alt]')?.getAttribute('alt') ||
        ''
      ).trim();
      if (!title) return;
      items.set(id, { id, title, year: null, isSeries: null, data: null, status: 'pending' });
      newIds.push(id);
    });
    if (newIds.length) {
      renderList();
      // Ask Netflix's own data model (netflix-meta.js) for year + film/series, then fetch ratings.
      fetchMeta(newIds).then((meta) => {
        for (const id of newIds) {
          const m = meta[id];
          const item = items.get(id);
          if (m) {
            item.year = m.year;
            item.isSeries = m.isSeries;
          }
          queue.push(id);
        }
        pump();
        renderList();
      });
    }
  }

  let metaReq = 0;
  function fetchMeta(ids) {
    return new Promise((resolve) => {
      const reqId = `nfr${++metaReq}`;
      const onMsg = (e) => {
        if (e.source !== window || e.data?.nfr !== 'meta-res' || e.data.reqId !== reqId) return;
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(e.data.data || {});
      };
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve({});
      }, 5000);
      window.addEventListener('message', onMsg);
      window.postMessage({ nfr: 'meta-req', reqId, ids }, '*');
    });
  }

  function pump() {
    while (running < CONCURRENCY && queue.length) {
      if (!alive()) return shutdown();
      const item = items.get(queue.shift());
      running++;
      try {
        chrome.runtime.sendMessage({ type: 'getRatings', query: { title: item.title, year: item.year, isSeries: item.isSeries } }, (data) => {
          running--;
          item.data = globalThis.chrome?.runtime?.lastError || data?.error ? null : data;
          item.status = 'done';
          scheduleRender();
          pump();
        });
      } catch (e) {
        running--;
        return shutdown();
      }
    }
    updateStatus();
  }

  // ---------- Panel UI ----------
  let renderTimer;
  const scheduleRender = () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderList, 250);
  };

  const fmt = (v, d = 1) => (v == null ? '–' : Number(v).toFixed(d).replace('.', ','));

  function updateStatus() {
    if (!statusEl) return;
    const done = [...items.values()].filter((i) => i.status === 'done').length;
    statusEl.textContent =
      done < items.size
        ? `Chargement des notes… ${done}/${items.size}`
        : `${items.size} titres · faites défiler la page Netflix pour en ajouter d'autres`;
  }

  function renderList() {
    if (!listEl) return;
    updateStatus();
    const get = SORTS[sortKey].get;
    const rows = [...items.values()]
      .filter((i) => {
        if (typeFilter === 'all') return true;
        const s = i.isSeries ?? i.data?.allocine?.isSeries;
        return typeFilter === 'series' ? s === true : s === false;
      })
      .sort((a, b) => (get(b.data) ?? -1) - (get(a.data) ?? -1));

    listEl.textContent = '';
    rows.forEach((item, idx) => {
      const d = item.data;
      const row = document.createElement('a');
      row.className = 'nfr-row';
      row.href = `/browse?jbv=${item.id}`;
      const cell = (cls, txt, title) => {
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = txt;
        if (title) s.title = title;
        return s;
      };
      const avg = avgScore(d);
      row.append(
        cell('nfr-rank', item.status === 'done' ? String(idx + 1) : '…'),
        cell('nfr-name', item.title, item.title),
        cell('nfr-n nfr-ac', fmt(d?.allocine?.spectators), 'AlloCiné Spectateurs /5'),
        cell('nfr-n nfr-ac', fmt(d?.allocine?.press), 'AlloCiné Presse /5'),
        cell('nfr-n nfr-im', fmt(d?.imdb?.rating), 'IMDb /10'),
        cell('nfr-n nfr-rtc', d?.rt?.critics != null ? `${d.rt.critics}%` : '–', 'Rotten Tomatoes'),
        cell('nfr-n nfr-avg', avg != null ? String(Math.round(avg)) : '–', 'Moyenne /100')
      );
      listEl.append(row);
    });
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'nfr-panel';

    const head = document.createElement('div');
    head.className = 'nfr-panel-head';
    const h = document.createElement('strong');
    h.textContent = '★ Classement';
    const close = document.createElement('button');
    close.textContent = '✕';
    close.onclick = togglePanel;
    head.append(h, close);

    const controls = document.createElement('div');
    controls.className = 'nfr-controls';
    const sortSel = document.createElement('select');
    Object.entries(SORTS).forEach(([k, v]) => sortSel.add(new Option(`Trier : ${v.label}`, k)));
    sortSel.value = sortKey;
    sortSel.onchange = () => {
      sortKey = sortSel.value;
      renderList();
    };
    const typeSel = document.createElement('select');
    [['all', 'Films & séries'], ['movies', 'Films'], ['series', 'Séries']].forEach(([k, l]) => typeSel.add(new Option(l, k)));
    typeSel.onchange = () => {
      typeFilter = typeSel.value;
      renderList();
    };
    controls.append(sortSel, typeSel);

    const cols = document.createElement('div');
    cols.className = 'nfr-row nfr-cols';
    ['#', 'Titre', 'Spect.', 'Presse', 'IMDb', 'RT', 'Moy.'].forEach((t, i) => {
      const s = document.createElement('span');
      s.className = ['nfr-rank', 'nfr-name'][i] || 'nfr-n';
      s.textContent = t;
      cols.append(s);
    });

    statusEl = document.createElement('div');
    statusEl.className = 'nfr-status';
    listEl = document.createElement('div');
    listEl.className = 'nfr-list';

    panel.append(head, controls, statusEl, cols, listEl);
    document.body.append(panel);
  }

  let observer;
  function togglePanel() {
    if (panel) {
      panel.remove();
      panel = listEl = statusEl = null;
      observer?.disconnect();
      return;
    }
    buildPanel();
    collect();
    renderList();
    // Keep picking up new cards while the user scrolls / opens rows.
    let t;
    observer = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(collect, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  let placeTimer;
  function shutdown() {
    observer?.disconnect();
    panel?.remove();
    fab.remove();
    clearInterval(placeTimer);
    queue.length = 0;
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'toggleRanking') {
      togglePanel();
      sendResponse({ ok: true });
    }
  });

  const fab = document.createElement('button');
  fab.className = 'nfr-fab';
  fab.textContent = '★ Classer';
  fab.title = 'Classer les titres de cette page par note';
  fab.onclick = togglePanel;

  // Put the button in Netflix's top bar, just left of the search icon.
  // Falls back to the bottom-right corner if the bar isn't found. Netflix redraws the bar, so re-check.
  function placeFab() {
    if (!alive()) return shutdown();
    const search = document.querySelector('[data-uia="tutorial+target-search"]');
    if (search?.parentElement) {
      if (fab.nextSibling !== search) search.parentElement.insertBefore(fab, search);
      fab.classList.add('nfr-fab-nav');
    } else if (!fab.isConnected || fab.classList.contains('nfr-fab-nav')) {
      fab.classList.remove('nfr-fab-nav');
      document.body.append(fab);
    }
  }
  placeTimer = setInterval(placeFab, 1500);
  placeFab();
})();
