(function () {
  const state = { objects: [], scanning: false };
  const scanAllState = { results: [], selected: new Set(), filter: '' };
  const els = {};

  function $(id) { return document.getElementById(id); }

  function send(type, payload) {
    return chrome.runtime.sendMessage({ type, ...payload });
  }

  function bestSelector(selectors) {
    return selectors.id || selectors.dataTestId || selectors.name || selectors.css || selectors.xpath || '';
  }

  function renderObjects() {
    const list = els.objectList;
    list.innerHTML = '';
    els.objectEmpty.classList.toggle('visible', state.objects.length === 0);

    state.objects.forEach((obj) => {
      const li = document.createElement('li');
      li.className = 'item-card';
      const bestSelectorText = bestSelector(obj.selectors);
      li.innerHTML = `
        <div class="item-card-row">
          <span class="item-title"></span>
          <span class="item-actions">
            <button data-action="rename" title="Rename">✎</button>
            <button data-action="delete" title="Delete">🗑</button>
          </span>
        </div>
        <span class="item-sub"></span>
        <span class="item-sub"></span>
      `;
      li.querySelector('.item-title').textContent = obj.name;
      const subs = li.querySelectorAll('.item-sub');
      subs[0].textContent = `selector: ${bestSelectorText}`;
      subs[1].textContent = obj.pageUrlPattern;
      li.querySelector('[data-action="rename"]').addEventListener('click', async () => {
        const name = prompt('New Object Name:', obj.name);
        if (!name) return;
        obj.name = name;
        await send('SP_RENAME_OBJECT', { objectId: obj.id, name });
        renderObjects();
      });
      li.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm(`Delete object "${obj.name}"?`)) return;
        await send('SP_DELETE_OBJECT', { objectId: obj.id });
        state.objects = state.objects.filter((o) => o.id !== obj.id);
        renderObjects();
      });
      list.appendChild(li);
    });
  }

  // ---------------- Scan All ----------------

  function matchesFilter(candidate, filter) {
    if (!filter) return true;
    const haystack = `${candidate.name} ${candidate.tagName} ${candidate.selectors.text || ''}`.toLowerCase();
    return haystack.includes(filter);
  }

  function updateScanAllControls() {
    const visibleIndexes = scanAllState.results
      .map((_, i) => i)
      .filter((i) => matchesFilter(scanAllState.results[i], scanAllState.filter));
    const visibleSelectedCount = visibleIndexes.filter((i) => scanAllState.selected.has(i)).length;
    els.scanAllSelectAllCb.checked = visibleIndexes.length > 0 && visibleSelectedCount === visibleIndexes.length;
    els.scanAllCount.textContent = String(scanAllState.selected.size);
    els.btnScanAllAdd.disabled = scanAllState.selected.size === 0;
  }

  function renderScanAllList() {
    const list = els.scanAllList;
    list.innerHTML = '';
    const filter = scanAllState.filter;
    const visible = scanAllState.results
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => matchesFilter(candidate, filter));

    els.scanAllEmpty.classList.toggle('visible', visible.length === 0);

    visible.forEach(({ candidate, index }) => {
      const li = document.createElement('li');
      li.className = 'item-card scan-all-item';
      li.innerHTML = `
        <div class="item-card-row">
          <input type="checkbox" class="scan-all-cb" />
          <span class="item-title"></span>
        </div>
        <span class="item-sub"></span>
      `;
      li.querySelector('.item-title').textContent = `${candidate.name} (${candidate.tagName})`;
      li.querySelector('.item-sub').textContent = `selector: ${bestSelector(candidate.selectors)}`;
      const cb = li.querySelector('.scan-all-cb');
      cb.checked = scanAllState.selected.has(index);
      cb.addEventListener('change', () => {
        if (cb.checked) scanAllState.selected.add(index);
        else scanAllState.selected.delete(index);
        updateScanAllControls();
      });
      li.addEventListener('mouseenter', () => {
        send('SP_HIGHLIGHT_ELEMENT', { selectors: candidate.selectors });
      });
      li.addEventListener('mouseleave', () => {
        send('SP_UNHIGHLIGHT_ELEMENT');
      });
      list.appendChild(li);
    });

    updateScanAllControls();
  }

  function openScanAllPanel() {
    els.scanAllPanel.classList.remove('hidden');
  }

  function closeScanAllPanel() {
    els.scanAllPanel.classList.add('hidden');
    send('SP_UNHIGHLIGHT_ELEMENT');
    scanAllState.results = [];
    scanAllState.selected = new Set();
    scanAllState.filter = '';
    els.scanAllFilter.value = '';
  }

  async function runScanAll() {
    els.btnScanAll.disabled = true;
    els.btnScanAll.textContent = 'Scanning...';
    try {
      const data = await send('SP_SCAN_ALL');
      scanAllState.results = (data && data.objects) || [];
      scanAllState.selected = new Set();
      renderScanAllList();
      openScanAllPanel();
    } finally {
      els.btnScanAll.disabled = false;
      els.btnScanAll.textContent = 'Scan All';
    }
  }

  async function addSelectedScannedObjects() {
    const entries = Array.from(scanAllState.selected).map((i) => scanAllState.results[i]);
    if (entries.length === 0) return;
    await send('SP_ADD_SCANNED_OBJECTS', { entries });
    closeScanAllPanel();
  }

  function setScanning(on) {
    state.scanning = on;
    els.btnScanToggle.textContent = on ? 'Stop Scan' : 'Start Scan';
    els.btnScanToggle.classList.toggle('btn-primary', !on);
    els.btnScanToggle.classList.toggle('btn-danger', on);
  }

  function wireEvents() {
    els.btnScanToggle.addEventListener('click', async () => {
      setScanning(!state.scanning);
      await send(state.scanning ? 'SP_START_SCAN' : 'SP_STOP_SCAN');
    });

    els.btnCopyId.addEventListener('click', async () => {
      await navigator.clipboard.writeText(chrome.runtime.id);
      els.btnCopyId.textContent = 'Đã copy!';
      setTimeout(() => { els.btnCopyId.textContent = 'Copy'; }, 1200);
    });

    els.btnScanAll.addEventListener('click', runScanAll);
    els.btnScanAllClose.addEventListener('click', closeScanAllPanel);
    els.btnScanAllAdd.addEventListener('click', addSelectedScannedObjects);

    els.scanAllFilter.addEventListener('input', () => {
      scanAllState.filter = els.scanAllFilter.value.trim().toLowerCase();
      renderScanAllList();
    });

    els.scanAllSelectAllCb.addEventListener('change', () => {
      const filter = scanAllState.filter;
      const visibleIndexes = scanAllState.results
        .map((_, i) => i)
        .filter((i) => matchesFilter(scanAllState.results[i], filter));
      if (els.scanAllSelectAllCb.checked) {
        visibleIndexes.forEach((i) => scanAllState.selected.add(i));
      } else {
        visibleIndexes.forEach((i) => scanAllState.selected.delete(i));
      }
      renderScanAllList();
    });

    // Export objects as JSON
    els.btnExportObjects.addEventListener('click', () => {
      const data = {
        version: '1.0',
        type: 'objects',
        exportedAt: new Date().toISOString(),
        objects: state.objects,
      };
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `imt-s4hana-objects-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Import objects from JSON file
    els.btnImportObjects.addEventListener('click', () => {
      els.importObjectsFileInput.click();
    });

    els.importObjectsFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const data = JSON.parse(ev.target.result);

          if (!data.version || !data.objects || !Array.isArray(data.objects)) {
            alert('Invalid objects export file.');
            return;
          }

          const mode = prompt(
            `Import ${data.objects.length} Objects\n\n` +
            `Enter mode:\n` +
            `  merge  - Add to existing objects (default)\n` +
            `  replace - Replace ALL existing objects`,
            'merge'
          );

          if (mode === null) return;

          const isReplace = mode === 'replace';

          if (isReplace && !confirm('This will REPLACE all existing objects. Continue?')) return;

          // Update state
          state.objects = isReplace ? [...data.objects] : [...state.objects, ...data.objects];

          // Persist to extension storage
          await send('SP_SAVE_ALL_OBJECTS', { objects: state.objects });

          renderObjects();
          alert(`Successfully imported ${data.objects.length} objects!`);
        } catch (err) {
          alert(`Failed to parse file: ${err.message}`);
        }

        els.importObjectsFileInput.value = '';
      };
      reader.readAsText(file);
    });

    // Delete all objects
    els.btnDeleteAllObjects.addEventListener('click', async () => {
      if (!confirm('Delete all objects?\n\nThis will permanently delete all objects in the Object Repository.')) return;

      state.objects = [];
      await send('SP_SAVE_ALL_OBJECTS', { objects: [] });
      renderObjects();
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'EVT_OBJECT_ADDED') {
      if (!state.objects.some((o) => o.id === message.entry.id)) state.objects.push(message.entry);
      renderObjects();
    }
  });

  async function init() {
    Object.assign(els, {
      extId: $('ext-id'),
      btnCopyId: $('btn-copy-id'),
      objectList: $('object-list'),
      objectEmpty: $('object-empty'),
      btnScanToggle: $('btn-scan-toggle'),
      btnScanAll: $('btn-scan-all'),
      scanAllPanel: $('scan-all-panel'),
      btnScanAllClose: $('btn-scan-all-close'),
      scanAllFilter: $('scan-all-filter'),
      scanAllSelectAllCb: $('scan-all-select-all-cb'),
      scanAllCount: $('scan-all-count'),
      scanAllList: $('scan-all-list'),
      scanAllEmpty: $('scan-all-empty'),
      btnScanAllAdd: $('btn-scan-all-add'),
      btnExportObjects: $('btn-export-objects'),
      btnImportObjects: $('btn-import-objects'),
      importObjectsFileInput: $('import-objects-file-input'),
      btnDeleteAllObjects: $('btn-delete-all-objects'),
    });

    els.extId.textContent = chrome.runtime.id;
    wireEvents();

    const data = await send('SP_GET_OBJECTS');
    state.objects = data.objects || [];
    renderObjects();
  }

  init();
})();
