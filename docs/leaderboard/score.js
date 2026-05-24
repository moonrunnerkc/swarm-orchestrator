// Vanilla JS for the public leaderboard. No build step, no CDN. Loads
// the real-corpus headline straight from
// `../../benchmarks/real-corpus/scores/latest.json` and renders:
//   - header: overall precision / recall / F1, score-file timestamp,
//     pinned detector versions
//   - per-detector table, sortable by F1 (click any column header)
//
// The synthetic regression sidebar (data.json) loads in parallel; both
// the real-baseline.json fallback and data.json are optional so older
// deploys that lack one or the other still render the parts they have.

(() => {
  const HEAD_PRECISION = document.getElementById('head-precision');
  const HEAD_RECALL = document.getElementById('head-recall');
  const HEAD_F1 = document.getElementById('head-f1');
  const HEAD_META = document.getElementById('head-meta');
  const PER_DETECTOR_TBODY = document.querySelector('#per-detector-table tbody');
  const PER_DETECTOR_HEAD = document.querySelector('#per-detector-table thead');

  let perDetectorRows = [];
  let sortKey = 'f1';
  let sortDir = -1; // descending

  function fmtPct(x, digits = 3) {
    if (x === null || x === undefined || Number.isNaN(x)) return '—';
    return Number(x).toFixed(digits);
  }
  function fmtInt(x) {
    if (x === null || x === undefined) return '—';
    return String(x);
  }

  function renderHeader(snapshot) {
    const a = snapshot.aggregate;
    HEAD_PRECISION.textContent = fmtPct(a.overallPrecision);
    HEAD_RECALL.textContent = fmtPct(a.overallRecall);
    HEAD_F1.textContent = fmtPct(a.overallF1);
    const versions = Object.entries(snapshot.detectorVersions || {})
      .map(([n, v]) => `${n}@${v}`)
      .join(', ');
    HEAD_META.textContent =
      `Generated ${snapshot.generatedAt} · scored=${a.totalScored} (broken=${a.totalBrokenLabeled}, ` +
      `clean=${a.totalCleanLabeled}) · ` +
      `versions: ${versions}`;
  }

  function renderTable() {
    const rows = perDetectorRows.slice().sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * sortDir;
    });
    PER_DETECTOR_TBODY.innerHTML = '';
    for (const d of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td><code>${d.detector}</code></td>` +
        `<td class="num">${fmtInt(d.truePositive)}</td>` +
        `<td class="num">${fmtInt(d.falsePositive)}</td>` +
        `<td class="num">${fmtInt(d.trueNegative)}</td>` +
        `<td class="num">${fmtInt(d.falseNegative)}</td>` +
        `<td class="num">${fmtPct(d.precision)}</td>` +
        `<td class="num">${fmtPct(d.recall)}</td>` +
        `<td class="num"><strong>${fmtPct(d.f1)}</strong></td>`;
      PER_DETECTOR_TBODY.appendChild(tr);
    }
  }

  function attachSortHandlers() {
    const ths = PER_DETECTOR_HEAD.querySelectorAll('th[data-sort]');
    ths.forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (key === sortKey) sortDir *= -1;
        else {
          sortKey = key;
          sortDir = -1;
        }
        ths.forEach((other) => other.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
        renderTable();
      });
    });
  }

  function loadRealCorpus() {
    return fetch('../../benchmarks/real-corpus/scores/latest.json')
      .then((r) => {
        if (!r.ok) throw new Error('latest.json HTTP ' + r.status);
        return r.json();
      })
      .then((snapshot) => {
        perDetectorRows = snapshot.perDetector || [];
        renderHeader(snapshot);
        renderTable();
      })
      .catch((err) => {
        HEAD_META.textContent = 'Failed to load real-corpus scores: ' + err.message;
      });
  }

  // Optional: synthetic regression sidebar. Same shape as the
  // weekly-refreshed data.json so the existing cron keeps working.
  function loadSynthetic() {
    return fetch('./data.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const meta = document.getElementById('synthetic-meta');
        if (meta) {
          const versions = Object.entries(data.detectorVersions || {})
            .map(([n, v]) => `${n}@${v}`)
            .join(', ');
          meta.textContent =
            `Synthetic generated ${data.generatedAt} · ${data.corpusSize} cases · versions: ${versions}`;
        }
        fillSimpleTable('synthetic-per-agent', data.perAgent || [], 'agent');
        fillSimpleTable('synthetic-per-category', data.perCategory || [], 'category');
      })
      .catch(() => {
        /* synthetic data is optional */
      });
  }

  function fillSimpleTable(id, rows, keyName) {
    const tbody = document.querySelector('#' + id + ' tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    rows
      .slice()
      .sort((a, b) => b.caught / Math.max(b.total, 1) - a.caught / Math.max(a.total, 1))
      .forEach((r) => {
        const rate = r.total === 0 ? 0 : r.caught / r.total;
        const tr = document.createElement('tr');
        tr.innerHTML =
          `<td><code>${r[keyName]}</code></td>` +
          `<td class="num">${r.total}</td>` +
          `<td class="num">${r.caught}</td>` +
          `<td class="num">${(rate * 100).toFixed(1)}%</td>`;
        tbody.appendChild(tr);
      });
  }

  attachSortHandlers();
  loadRealCorpus();
  loadSynthetic();
})();
