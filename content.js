// Content script: detects titles in Netflix preview / detail modals and injects ratings.
(() => {
  const BADGE_CLASS = 'nfr-ratings';
  // False once the extension is reloaded/removed while this tab stays open (orphaned script).
  const alive = () => !!globalThis.chrome?.runtime?.id;

  const MODAL_SELECTORS = [
    '.previewModal--container', // hover mini-modal + detail modal
    '.detail-modal',
    '[data-uia="modal-motion-container-DETAIL_MODAL"]',
  ].join(',');

  const text = (el) => (el?.textContent || '').trim();

  function extractInfo(root) {
    let title =
      root.querySelector('.previewModal--player-titleTreatment-logo')?.getAttribute('alt') ||
      root.querySelector('img[class*="titleTreatment"]')?.getAttribute('alt') ||
      root.querySelector('.previewModal--boxart')?.getAttribute('alt') ||
      text(root.querySelector('.about-header strong')) ||
      text(root.querySelector('[data-uia="title-info-title"], h1.title-title'));
    if (!title) return null;
    title = title.trim();

    const yearText = text(root.querySelector('.year, [data-uia="videoMetadata--year"], [data-uia="item-year"]'));
    const year = parseInt((yearText.match(/\d{4}/) || [])[0], 10) || null;

    const meta = text(root.querySelector('.videoMetadata--container, .duration, [data-uia="videoMetadata--container"]'));
    let isSeries = null;
    if (/saison|season|épisode|episode|partie|parts?\b|volume|série limitée|limited series/i.test(meta)) isSeries = true;
    else if (/\bséries?\b|\bseries\b/i.test(meta)) isSeries = true;
    else if (/\bfilm\b|\bmovie\b|\d+\s*h\s*\d*|\d+\s*min/i.test(meta)) isSeries = false;
    if (root.querySelector('.episodeSelector, [data-uia="episode-selector"]')) isSeries = true;

    return { title, year, isSeries };
  }

  function insertionPoint(root) {
    const meta = root.querySelector('.videoMetadata--container, [data-uia="videoMetadata--container"]');
    if (meta) return { parent: meta.parentElement, before: meta.nextSibling };
    const info = root.querySelector('.previewModal--info, .previewModal--detailsMetadata-left');
    if (info) return { parent: info, before: info.firstChild };
    return { parent: root, before: root.firstChild };
  }

  const fmt = (v, digits = 1) => (v == null ? '–' : Number(v).toFixed(digits).replace('.', ','));

  function chip({ href, cls, label, value, title }) {
    const a = document.createElement(href ? 'a' : 'span');
    a.className = `nfr-chip ${cls}`;
    if (href) {
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.addEventListener('click', (e) => e.stopPropagation());
    }
    if (title) a.title = title;
    const l = document.createElement('b');
    l.textContent = label;
    const v = document.createElement('span');
    v.textContent = value;
    a.append(l, v);
    return a;
  }

  function render(box, data) {
    box.textContent = '';
    if (!data || data.error) {
      box.append(chip({ cls: 'nfr-muted', label: 'Notes', value: 'indisponibles' }));
      return;
    }
    const { allocine: ac, imdb, rt } = data;
    if (ac) {
      box.append(
        chip({ href: ac.url, cls: 'nfr-allocine', label: 'AlloCiné Presse', value: `${fmt(ac.press)}/5`, title: 'Note presse AlloCiné' }),
        chip({ href: ac.url, cls: 'nfr-allocine', label: 'Spectateurs', value: `${fmt(ac.spectators)}/5`, title: 'Note spectateurs AlloCiné' })
      );
    }
    if (imdb) {
      box.append(
        chip({
          href: imdb.url,
          cls: 'nfr-imdb',
          label: 'IMDb',
          value: imdb.rating != null ? `${fmt(imdb.rating)}/10` : data.hasOmdbKey ? '–' : '↗',
          title: imdb.votes ? `${imdb.votes} votes` : data.hasOmdbKey ? 'IMDb' : 'Ajoutez une clé OMDb dans les options pour voir la note',
        })
      );
      if (imdb.metascore != null) {
        box.append(chip({ cls: 'nfr-mc', label: 'Metacritic', value: String(imdb.metascore) }));
      }
    }
    if (rt) {
      box.append(
        chip({
          href: rt.url,
          cls: 'nfr-rt',
          label: rt.certified ? '🍅 Certified' : rt.critics != null && rt.critics < 60 ? '🟢 RT' : '🍅 RT',
          value: rt.critics != null ? `${rt.critics}%` : '–',
          title: 'Tomatometer (critiques)',
        })
      );
    }
    if (!box.childElementCount) box.append(chip({ cls: 'nfr-muted', label: 'Notes', value: 'introuvables' }));
  }

  function processModal(root) {
    const info = extractInfo(root);
    if (!info) return;
    const sig = `${info.title}|${info.year || ''}|${info.isSeries ?? ''}`;
    let box = root.querySelector(`.${BADGE_CLASS}`);
    if (box && box.dataset.sig === sig) return;
    if (!box) {
      box = document.createElement('div');
      box.className = BADGE_CLASS;
      const { parent, before } = insertionPoint(root);
      parent.insertBefore(box, before);
    }
    box.dataset.sig = sig;
    box.textContent = '';
    box.append(chip({ cls: 'nfr-muted', label: 'Notes', value: '…' }));

    if (!alive()) return shutdown();
    try {
      chrome.runtime.sendMessage({ type: 'getRatings', query: info }, (data) => {
        if (globalThis.chrome?.runtime?.lastError) data = { error: chrome.runtime.lastError.message };
        if (box.isConnected && box.dataset.sig === sig) render(box, data);
      });
    } catch (e) {
      // "Extension context invalidated": the extension was reloaded; this tab needs a refresh.
      shutdown();
    }
  }

  let scheduled = false;
  function scan() {
    scheduled = false;
    document.querySelectorAll(MODAL_SELECTORS).forEach((m) => {
      // Skip nested matches (detail-modal inside previewModal--container).
      if (m.parentElement?.closest(MODAL_SELECTORS)) return;
      processModal(m);
    });
    // Public title pages (netflix.com/title/123)
    const titlePage = document.querySelector('[data-uia="title-info-title"]');
    if (titlePage) processModal(titlePage.closest('section, main, div') || document.body);
  }

  const mo = new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      setTimeout(scan, 300);
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  function shutdown() {
    mo.disconnect();
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach((b) => b.remove());
  }
  scan();
})();
