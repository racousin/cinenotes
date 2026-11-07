// Runs in the page's MAIN world so it can read Netflix's own data model (falcor pathEvaluator).
// Answers window.postMessage requests from ranking.js with { id: { title, year, isSeries } }.
(() => {
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.nfr !== 'meta-req') return;
    const { reqId, ids } = e.data;
    const out = {};
    try {
      const pe = window.netflix?.appContext?.state?.pathEvaluator;
      if (pe) {
        for (let i = 0; i < ids.length; i += 50) {
          const chunk = ids.slice(i, i + 50).map(Number);
          const r = await pe.get(['videos', chunk, ['title', 'releaseYear', 'summary']]);
          const videos = r?.json?.videos || {};
          for (const id of chunk) {
            const v = videos[id];
            if (!v) continue;
            out[id] = {
              title: v.title || null,
              year: v.releaseYear || null,
              isSeries: v.summary?.type === 'show' ? true : v.summary?.type === 'movie' ? false : null,
            };
          }
        }
      }
    } catch (err) {
      console.warn('[nfr] meta lookup failed', err);
    }
    window.postMessage({ nfr: 'meta-res', reqId, data: out }, '*');
  });
})();
