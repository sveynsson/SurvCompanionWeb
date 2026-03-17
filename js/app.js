/**
 * Main Application Controller for SurvCompanion Web
 */
const App = (() => {
  let _currentProject = null;
  let _editingPoint = null;
  let _photoSlotTarget = 0;
  const _photoBlobs = {}; // slot -> { blob, mimeType, fileName }
  const _photoURLs = {};  // slot -> objectURL (for display, must be revoked)
  let _saving = false;    // debounce guard
  let _formDirty = false; // unsaved changes tracking
  let _allPoints = [];    // cached points for filtering/pagination
  let _filteredPoints = []; // after filter applied
  let _currentPage = 0;
  const PAGE_SIZE = 25;

  // ==================== INITIALIZATION ====================

  async function init() {
    try {
      await DB.open();
      const persisted = await DB.requestPersistentStorage();
      if (!persisted) {
        console.warn('Persistent storage not granted — data may be evicted by browser');
      }

      // Check CDN dependencies loaded
      if (typeof JSZip === 'undefined') {
        console.error('JSZip not loaded — export will not work');
      }
      if (typeof proj4 === 'undefined') {
        console.warn('proj4 not loaded — GK coordinate transform unavailable');
      }

      // Warn before leaving with unsaved form data
      window.addEventListener('beforeunload', (e) => {
        if (_formDirty) {
          e.preventDefault();
          e.returnValue = '';
        }
      });

      await showProjects();
    } catch (e) {
      console.error('Init failed:', e);
      showToast('Datenbankfehler: ' + e.message, 'error');
    }
  }

  // ==================== VIEW MANAGEMENT ====================

  function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  // ==================== PROJECTS ====================

  async function showProjects() {
    _currentProject = null;
    showView('view-projects');
    try {
      const projects = await DB.getAllProjects();
      const list = document.getElementById('project-list');
      const empty = document.getElementById('no-projects');

      if (projects.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'flex';
        return;
      }
      empty.style.display = 'none';

      projects.sort((a, b) => new Date(b.angelegt) - new Date(a.angelegt));

      let html = '';
      for (const proj of projects) {
        const points = await DB.getPointsByProject(proj.projektNummer);
        const date = new Date(proj.angelegt).toLocaleDateString('de-DE');
        html += `
          <div class="list-item" onclick="App.selectProject('${_escAttr(proj.projektNummer)}')">
            <div class="list-item-content">
              <div class="list-item-title">${_escHtml(proj.bezeichnung || proj.projektNummer)}</div>
              <div class="list-item-subtitle">${_escHtml(proj.projektNummer)} &middot; ${date}</div>
            </div>
            <span class="list-item-badge">${points.length}</span>
            <div class="list-item-actions">
              <button class="icon-btn" onclick="event.stopPropagation();App.confirmDeleteProject('${_escAttr(proj.projektNummer)}')" title="Löschen">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </div>
          </div>`;
      }
      list.innerHTML = html;
    } catch (e) {
      console.error('showProjects failed:', e);
      showToast('Fehler beim Laden der Projekte', 'error');
    }
  }

  function showNewProjectDialog() {
    const html = `
      <h3>Neues Projekt</h3>
      <div class="form-group">
        <label for="d-projNr">Projektnummer *</label>
        <input type="text" id="d-projNr" placeholder="z.B. P2026-001" autofocus>
      </div>
      <div class="form-group">
        <label for="d-projBez">Bezeichnung</label>
        <input type="text" id="d-projBez" placeholder="Projektname">
      </div>
      <div class="form-group">
        <label for="d-projErsteller">Ersteller</label>
        <input type="text" id="d-projErsteller" placeholder="Name">
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="App.closeDialog()">Abbrechen</button>
        <button class="btn btn-primary" onclick="App.createProject()">Anlegen</button>
      </div>`;
    showDialog(html);
    setTimeout(() => document.getElementById('d-projNr')?.focus(), 100);
  }

  async function createProject() {
    const nr = document.getElementById('d-projNr').value.trim();
    if (!nr) { showToast('Projektnummer erforderlich', 'error'); return; }

    const existing = await DB.getProject(nr);
    if (existing) { showToast('Projekt existiert bereits', 'error'); return; }

    const ersteller = document.getElementById('d-projErsteller').value.trim();

    await DB.saveProject({
      projektNummer: nr,
      bezeichnung: document.getElementById('d-projBez').value.trim() || nr,
      ersteller,
      angelegt: new Date().toISOString(),
    });
    closeDialog();
    showToast('Projekt angelegt', 'success');
    await showProjects();
  }

  async function selectProject(projektNummer) {
    _currentProject = projektNummer;
    await showPoints();
  }

  async function confirmDeleteProject(projektNummer) {
    const points = await DB.getPointsByProject(projektNummer);
    const photos = await DB.getPhotosByProject(projektNummer);
    const html = `
      <h3>Projekt löschen?</h3>
      <p class="confirm-text">
        Projekt <strong>${_escHtml(projektNummer)}</strong> mit
        <strong>${points.length}</strong> Punkten und
        <strong>${photos.length}</strong> Fotos wird unwiderruflich gelöscht.
      </p>
      <p class="warning-text">Diese Aktion kann nicht rückgängig gemacht werden!</p>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="App.closeDialog()">Abbrechen</button>
        <button class="btn btn-danger" onclick="App.doDeleteProject('${_escAttr(projektNummer)}')">Löschen</button>
      </div>`;
    showDialog(html);
  }

  async function doDeleteProject(projektNummer) {
    try {
      await DB.deleteProject(projektNummer);
      // Clean up presets for this project
      localStorage.removeItem(`sc_presets_${projektNummer}`);
      closeDialog();
      showToast('Projekt gelöscht', 'success');
      await showProjects();
    } catch (e) {
      console.error('Delete project failed:', e);
      showToast('Löschen fehlgeschlagen: ' + e.message, 'error');
    }
  }

  // ==================== PRESETS ====================

  function _getPresets() {
    if (!_currentProject) return {};
    try {
      const raw = localStorage.getItem(`sc_presets_${_currentProject}`);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function savePresets() {
    if (!_currentProject) return;
    const presets = {
      strecke: document.getElementById('p-strecke')?.value?.trim() || '',
      art: document.getElementById('p-art')?.value || '',
      gicCode: document.getElementById('p-gicCode')?.value?.trim() || '',
      erfasser: document.getElementById('p-erfasser')?.value?.trim() || '',
      targetVorhanden: document.getElementById('p-targetVorhanden')?.checked || false,
    };
    localStorage.setItem(`sc_presets_${_currentProject}`, JSON.stringify(presets));
    _updatePresetsSummary(presets);
  }

  function _loadPresets() {
    const presets = _getPresets();
    document.getElementById('p-strecke').value = presets.strecke || '';
    document.getElementById('p-art').value = presets.art || '';
    document.getElementById('p-gicCode').value = presets.gicCode || '';
    document.getElementById('p-targetVorhanden').checked = !!presets.targetVorhanden;

    // Erfasser: use preset if set, otherwise fall back to project ersteller
    if (presets.erfasser) {
      document.getElementById('p-erfasser').value = presets.erfasser;
    } else {
      // Auto-fill from project ersteller on first load
      DB.getProject(_currentProject).then(proj => {
        if (proj?.ersteller && !document.getElementById('p-erfasser').value) {
          document.getElementById('p-erfasser').value = proj.ersteller;
          savePresets();
        }
      }).catch(() => {});
    }
    _updatePresetsSummary(presets);
  }

  function _updatePresetsSummary(presets) {
    const parts = [];
    if (presets.strecke) parts.push('Str. ' + presets.strecke);
    if (presets.art) parts.push(Models.displayName(Models.PunktArt, presets.art));
    if (presets.erfasser) parts.push(presets.erfasser);
    if (presets.targetVorhanden) parts.push('Target');
    document.getElementById('presets-summary').textContent = parts.join(' | ');
  }

  function togglePresets() {
    document.getElementById('presets-panel').classList.toggle('expanded');
  }

  // ==================== POINTS LIST ====================

  async function showPoints() {
    showView('view-points');
    _formDirty = false;

    try {
      const proj = await DB.getProject(_currentProject);
      document.getElementById('points-title').textContent = proj?.bezeichnung || _currentProject;

      // Load presets
      _loadPresets();

      _allPoints = await DB.getPointsByProject(_currentProject);

      // Sort: imported-offen first, then by date descending
      _allPoints.sort((a, b) => {
        const aOffen = a.importStatus === 'offen' ? 0 : 1;
        const bOffen = b.importStatus === 'offen' ? 0 : 1;
        if (aOffen !== bOffen) return aOffen - bOffen;
        return new Date(b.erfassungsdatum) - new Date(a.erfassungsdatum);
      });

      _currentPage = 0;
      applyFilters();
    } catch (e) {
      console.error('showPoints failed:', e);
      showToast('Fehler beim Laden der Punkte', 'error');
    }
  }

  function applyFilters() {
    const filterArt = document.getElementById('filter-art')?.value || '';
    const filterStrecke = (document.getElementById('filter-strecke')?.value || '').trim().toLowerCase();
    const filterGic = (document.getElementById('filter-gic')?.value || '').trim();
    const filterImport = document.getElementById('filter-import')?.value || '';
    const kmGroup = document.getElementById('filter-km-group')?.checked || false;

    _filteredPoints = _allPoints.filter(p => {
      // Art filter: also match if the point's GIC code maps to the filtered art
      if (filterArt) {
        const gicArt = p.gicCode ? Models.GIC_TO_ART[parseInt(p.gicCode)] : null;
        if (p.art !== filterArt && gicArt !== filterArt) return false;
      }
      if (filterStrecke && !(p.strecke || '').toLowerCase().includes(filterStrecke)) return false;
      if (filterGic && !(p.gicCode || '').includes(filterGic)) return false;
      if (filterImport === 'offen' && p.importStatus !== 'offen') return false;
      if (filterImport === 'erledigt' && p.importStatus !== 'erledigt') return false;
      if (filterImport === 'none' && p.importStatus) return false;
      return true;
    });

    // Update count
    const countEl = document.getElementById('filter-count');
    if (countEl) {
      countEl.textContent = `${_filteredPoints.length} / ${_allPoints.length}`;
    }

    const list = document.getElementById('point-list');
    const empty = document.getElementById('no-points');
    const pagination = document.getElementById('pagination');

    if (_allPoints.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      pagination.style.display = 'none';
      return;
    }

    if (_filteredPoints.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>Keine Punkte für diesen Filter</p></div>';
      empty.style.display = 'none';
      pagination.style.display = 'none';
      return;
    }

    empty.style.display = 'none';

    if (kmGroup) {
      _renderGroupedView(list);
      pagination.style.display = 'none';
    } else {
      _renderPagedView(list);
      _updatePagination();
    }
  }

  /** Renders a flat paginated list. */
  function _renderPagedView(list) {
    const totalPages = Math.ceil(_filteredPoints.length / PAGE_SIZE);
    if (_currentPage >= totalPages) _currentPage = totalPages - 1;
    if (_currentPage < 0) _currentPage = 0;

    const start = _currentPage * PAGE_SIZE;
    const pagePoints = _filteredPoints.slice(start, start + PAGE_SIZE);

    list.innerHTML = pagePoints.map(p => _renderPointItem(p)).join('');
  }

  function _updatePagination() {
    const pagination = document.getElementById('pagination');
    const totalPages = Math.ceil(_filteredPoints.length / PAGE_SIZE);

    if (totalPages <= 1) {
      pagination.style.display = 'none';
      return;
    }

    pagination.style.display = 'flex';
    document.getElementById('page-prev').disabled = _currentPage <= 0;
    document.getElementById('page-next').disabled = _currentPage >= totalPages - 1;
    document.getElementById('page-info').textContent =
      `Seite ${_currentPage + 1} / ${totalPages}`;
  }

  function prevPage() {
    if (_currentPage > 0) { _currentPage--; applyFilters(); }
  }
  function nextPage() {
    const totalPages = Math.ceil(_filteredPoints.length / PAGE_SIZE);
    if (_currentPage < totalPages - 1) { _currentPage++; applyFilters(); }
  }

  /**
   * Extract km number from a PS4 punkt ID.
   * Patterns: "123-01", "T123-01", "N123-01" → km=123
   * Returns null if no match.
   */
  function _extractKm(punktId) {
    const m = String(punktId).match(/^[TNtn]?(\d+)-\d+[A-Za-z]*$/);
    return m ? parseInt(m[1], 10) : null;
  }

  /** Renders grouped view: PS4 by km, others flat. */
  function _renderGroupedView(list) {
    const ps4Points = [];
    const otherPoints = [];

    for (const p of _filteredPoints) {
      if (p.art === 'ps4') ps4Points.push(p);
      else otherPoints.push(p);
    }

    // Group PS4 by km
    const kmGroups = new Map(); // km -> points[]
    const unspecified = [];
    for (const p of ps4Points) {
      const km = _extractKm(p.punktId);
      if (km !== null) {
        if (!kmGroups.has(km)) kmGroups.set(km, []);
        kmGroups.get(km).push(p);
      } else {
        unspecified.push(p);
      }
    }

    // Sort km groups numerically
    const sortedKms = [...kmGroups.keys()].sort((a, b) => a - b);

    let html = '';

    // Render km groups
    for (const km of sortedKms) {
      const groupPoints = kmGroups.get(km);
      const openCount = groupPoints.filter(p => p.importStatus === 'offen').length;
      const doneCount = groupPoints.filter(p => p.importStatus === 'erledigt').length;
      let statusHtml = '';
      if (openCount > 0) statusHtml += `<span class="badge badge-import-offen">${openCount} offen</span> `;
      if (doneCount > 0) statusHtml += `<span class="badge badge-import-erledigt">${doneCount} erledigt</span>`;

      html += `
        <div class="km-group" id="km-group-${km}">
          <div class="km-group-header" onclick="App.toggleKmGroup(${km})">
            <h3>km ${km} <span class="km-count">(${groupPoints.length})</span></h3>
            <span class="km-status">${statusHtml}</span>
            <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="km-group-body">
            ${groupPoints.map(p => _renderPointItem(p)).join('')}
          </div>
        </div>`;
    }

    // Unspecified PS4 group
    if (unspecified.length > 0) {
      html += `
        <div class="km-group" id="km-group-unspec">
          <div class="km-group-header" onclick="App.toggleKmGroup('unspec')">
            <h3>Unspezifisch <span class="km-count">(${unspecified.length})</span></h3>
            <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="km-group-body">
            ${unspecified.map(p => _renderPointItem(p)).join('')}
          </div>
        </div>`;
    }

    // Non-PS4 points flat
    if (otherPoints.length > 0) {
      if (ps4Points.length > 0) {
        html += `<div style="padding:8px 4px 4px;font-size:12px;font-weight:600;color:var(--on-surface-secondary);text-transform:uppercase;letter-spacing:0.5px">Andere Punktarten</div>`;
      }
      html += otherPoints.map(p => _renderPointItem(p)).join('');
    }

    list.innerHTML = html;
  }

  function toggleKmGroup(km) {
    const el = document.getElementById(`km-group-${km}`);
    if (el) el.classList.toggle('expanded');
  }

  /** Renders a single point list item. */
  function _renderPointItem(p) {
    const photoCount = [p.foto1, p.foto2, p.foto3, p.foto4, p.foto5].filter(Boolean).length;
    const date = new Date(p.erfassungsdatum).toLocaleDateString('de-DE');
    const station = p.station != null ? ` km ${p.station}` : '';
    const importClass = p.importStatus ? ` import-${p.importStatus}` : '';
    const importBadge = p.importStatus === 'offen'
      ? '<span class="badge badge-import-offen">OFFEN</span>'
      : p.importStatus === 'erledigt'
      ? '<span class="badge badge-import-erledigt">ERLEDIGT</span>'
      : '';
    return `
      <div class="list-item${importClass}" onclick="App.editPoint('${_escAttr(p.punktId)}')">
        <div class="list-item-content">
          <div class="list-item-title">
            <span class="badge badge-${p.art}">${Models.displayName(Models.PunktArt, p.art)}</span>
            ${_escHtml(p.punktId)}
            ${importBadge}
          </div>
          <div class="list-item-subtitle">
            Str. ${_escHtml(p.strecke)}${station} &middot; ${_escHtml(Models.displayName(Models.Seite, p.seite))} &middot; ${date}
            ${photoCount > 0 ? ' &middot; ' + photoCount + ' Foto(s)' : ''}
          </div>
        </div>
        <div class="list-item-actions">
          <button class="icon-btn" onclick="event.stopPropagation();App.confirmDeletePoint('${_escAttr(p.punktId)}')" title="Löschen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>`;
  }

  async function confirmDeletePoint(punktId) {
    const photos = await DB.getPhotosByPoint(punktId);
    const html = `
      <h3>Punkt löschen?</h3>
      <p class="confirm-text">Punkt <strong>${_escHtml(punktId)}</strong> mit ${photos.length} Foto(s) wird unwiderruflich gelöscht.</p>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="App.closeDialog()">Abbrechen</button>
        <button class="btn btn-danger" onclick="App.doDeletePoint('${_escAttr(punktId)}')">Löschen</button>
      </div>`;
    showDialog(html);
  }

  async function doDeletePoint(punktId) {
    try {
      await DB.deletePoint(punktId);
      closeDialog();
      showToast('Punkt gelöscht', 'success');
      await showPoints();
    } catch (e) {
      console.error('Delete point failed:', e);
      showToast('Löschen fehlgeschlagen: ' + e.message, 'error');
    }
  }

  // ==================== POINT FORM ====================

  function showPointForm(existingPoint) {
    _editingPoint = existingPoint || null;
    _formDirty = false;
    _saving = false;
    _clearPhotoState();

    document.getElementById('point-form-title').textContent =
      existingPoint ? 'Punkt bearbeiten' : 'Punkt erfassen';

    const form = document.getElementById('point-form');
    form.reset();

    // Make punkt-ID editable again (reset readOnly from previous edits)
    document.getElementById('f-punktId').readOnly = false;

    if (existingPoint) {
      _populateForm(existingPoint);
    } else {
      // Apply presets
      const presets = _getPresets();
      document.getElementById('f-art').value = presets.art || 'ps4';
      document.getElementById('f-seite').value = 'rechts';
      if (presets.strecke) document.getElementById('f-strecke').value = presets.strecke;
      if (presets.gicCode) document.getElementById('f-gicCode').value = presets.gicCode;
      if (presets.erfasser) {
        document.getElementById('f-erfasser').value = presets.erfasser;
      }
    }

    onArtChanged();

    // Apply target preset for new points (after art-specific fields are rendered)
    if (!existingPoint) {
      const presets = _getPresets();
      if (presets.targetVorhanden) {
        const targetCb = document.getElementById('f-ps4TargetVorhanden');
        if (targetCb) { targetCb.checked = true; _onTargetChanged(); }
        const pfTargetCb = document.getElementById('f-ps4GvPfostenTargetVorhanden');
        if (pfTargetCb) { pfTargetCb.checked = true; _onPfostenTargetChanged(); }
      }
    }

    _updatePhotoCount();
    showView('view-point-form');

    // Expand first section
    document.querySelectorAll('.form-section').forEach((s, i) => {
      if (i === 0) s.classList.add('expanded');
      else if (!existingPoint) s.classList.remove('expanded');
    });

    // Track dirty state
    _installDirtyTracking();
  }

  function _installDirtyTracking() {
    const form = document.getElementById('point-form');
    const handler = () => { _formDirty = true; };
    form.addEventListener('input', handler, { once: false });
    form.addEventListener('change', handler, { once: false });
  }

  async function editPoint(punktId) {
    try {
      const point = await DB.getPoint(punktId);
      if (!point) { showToast('Punkt nicht gefunden', 'error'); return; }
      showPointForm(point);
      // Load existing photo previews
      for (let slot = 1; slot <= 5; slot++) {
        if (point[`foto${slot}`]) {
          try {
            const url = await DB.getPhotoURL(punktId, slot);
            if (url) {
              _photoURLs[slot] = url;
              _showPhotoPreview(slot, url);
              _photoBlobs[slot] = { existing: true };
            }
          } catch (e) {
            console.warn(`Photo ${slot} for ${punktId} could not be loaded:`, e);
          }
        }
      }
    } catch (e) {
      console.error('editPoint failed:', e);
      showToast('Fehler beim Laden des Punktes', 'error');
    }
  }

  function cancelPointForm() {
    if (_formDirty) {
      const html = `
        <h3>Änderungen verwerfen?</h3>
        <p class="confirm-text">Es gibt ungespeicherte Änderungen. Wirklich abbrechen?</p>
        <div class="btn-row">
          <button class="btn btn-secondary" onclick="App.closeDialog()">Weiter bearbeiten</button>
          <button class="btn btn-danger" onclick="App.closeDialog();App._doCancel()">Verwerfen</button>
        </div>`;
      showDialog(html);
    } else {
      _doCancel();
    }
  }

  function _doCancel() {
    _formDirty = false;
    _clearPhotoState();
    if (_currentProject) showPoints();
    else showProjects();
  }

  async function savePoint() {
    // Debounce rapid clicks
    if (_saving) return;
    _saving = true;

    try {
      const punktId = document.getElementById('f-punktId').value.trim();
      const strecke = document.getElementById('f-strecke').value.trim();
      const erfasser = document.getElementById('f-erfasser').value.trim();

      if (!punktId || !strecke || !erfasser) {
        showToast('Bitte alle Pflichtfelder (*) ausfüllen', 'error');
        _saving = false;
        return;
      }

      // Check for duplicate ID (only when creating new)
      if (!_editingPoint) {
        const existing = await DB.getPoint(punktId);
        if (existing) {
          showToast('Punkt-ID existiert bereits', 'error');
          _saving = false;
          return;
        }
      }

      // Save erfasser for next time
      localStorage.setItem('sc_lastErfasser', erfasser);

      const art = document.getElementById('f-art').value;

      // Build point data
      const pointData = {
        punktId,
        station: _parseFloat('f-station'),
        strecke,
        seite: document.getElementById('f-seite').value,
        art,
        gicCode: document.getElementById('f-gicCode').value.trim() || null,
        erfassungsdatum: _editingPoint?.erfassungsdatum || new Date().toISOString(),
        erfasser,
        neuOderBestand: document.getElementById('f-neuOderBestand').value,
        gnssTauglichkeit: document.getElementById('f-gnssTauglichkeit').value || null,
        rilKonformitaet: document.getElementById('f-rilKonformitaet').value,
        status: document.getElementById('f-status').value,
        einmessskizze: document.getElementById('f-einmessskizze').value,
        gpsLatitude: _parseFloat('f-gpsLatitude'),
        gpsLongitude: _parseFloat('f-gpsLongitude'),
        hoehe: _parseFloat('f-hoehe'),
        gpsAccuracy: _parseFloat('f-gpsAccuracy'),
        dbrefX: _parseFloat('f-dbrefX'),
        dbrefY: _parseFloat('f-dbrefY'),
        gkZone: _parseInt('f-gkZone'),
        bemerkungen: document.getElementById('f-bemerkungen').value.trim() || null,
        projektNummer: _currentProject,
      };

      // Photo flags
      for (let slot = 1; slot <= 5; slot++) {
        pointData[`foto${slot}`] = _photoBlobs[slot] ? true : null;
      }

      // Import tracking: mark as erledigt on save, preserve import origin
      if (_editingPoint?.importStatus) {
        pointData.importStatus = 'erledigt';
      }
      if (_editingPoint?.importQuelle) {
        pointData.importQuelle = _editingPoint.importQuelle;
      }

      // Art-specific fields
      _readArtSpecificFields(pointData, art);

      // Collect new photo blobs (skip ones marked as "existing")
      const newPhotos = {};
      for (const [slot, data] of Object.entries(_photoBlobs)) {
        if (data && !data.existing && data.blob) {
          newPhotos[slot] = data;
        }
      }

      // Check storage before saving large photos
      const totalNewBytes = Object.values(newPhotos).reduce((sum, p) => sum + (p.blob?.size || 0), 0);
      if (totalNewBytes > 0) {
        const storageOk = await _checkStorageQuota(totalNewBytes);
        if (!storageOk) {
          _saving = false;
          return;
        }
      }

      showLoading('Speichere Punkt...');
      await DB.savePointWithPhotos(pointData, newPhotos);
      hideLoading();
      _formDirty = false;
      _clearPhotoState();
      showToast('Punkt gespeichert', 'success');
      await showPoints();
    } catch (e) {
      hideLoading();
      console.error('Save failed:', e);
      showToast('Speichern fehlgeschlagen: ' + e.message, 'error');
    } finally {
      _saving = false;
    }
  }

  /**
   * Checks if there is enough storage quota for the given bytes.
   * Warns user if quota is critically low.
   */
  async function _checkStorageQuota(bytesNeeded) {
    try {
      const est = await DB.getStorageEstimate();
      if (est.quota > 0) {
        const remaining = est.quota - est.usage;
        const marginFactor = 1.5; // require 1.5x the needed space as safety margin
        if (remaining < bytesNeeded * marginFactor) {
          showToast(`Speicher knapp! Nur noch ${(remaining / (1024*1024)).toFixed(0)} MB frei. Bitte exportieren und Punkte löschen.`, 'error');
          return false;
        }
        // Warn at 80% usage
        const pctUsed = (est.usage / est.quota) * 100;
        if (pctUsed > 80) {
          showToast(`Speicher zu ${pctUsed.toFixed(0)}% belegt — bald exportieren!`, 'error');
        }
      }
    } catch (e) {
      console.warn('Storage estimate failed:', e);
    }
    return true;
  }

  // ==================== ART-SPECIFIC FIELDS ====================

  function onArtChanged() {
    const art = document.getElementById('f-art').value;
    const container = document.getElementById('art-specific-fields');

    // Show/hide GNSS field
    const gnssGroup = document.getElementById('gnss-group');
    gnssGroup.style.display = Models.GNSS_ARTS.includes(art) ? '' : 'none';

    let html = '';
    switch (art) {
      case 'ps0':
        html = _fieldSelect('ps0Vermarkungsart', 'Vermarkungsart', Models.PS0Vermarkungsart)
             + _fieldSelect('ps0Vermarkungstraeger', 'Vermarkungsträger', Models.PS0Vermarkungstraeger)
             + _fieldText('ps0AndereVermarkungsart', 'Andere Vermarkungsart')
             + _fieldText('ps0AndereVermarkungstraeger', 'Anderer Vermarkungsträger');
        break;
      case 'ps1':
        html = _fieldSelect('ps1Vermarkungstraeger', 'Vermarkungsträger', Models.PS1Vermarkungstraeger)
             + _fieldText('ps1AndereVermarkungstraeger', 'Anderer Vermarkungsträger');
        break;
      case 'ps2':
        html = _fieldSelect('ps2Vermarkungsart', 'Vermarkungsart', Models.PS2Vermarkungsart)
             + _fieldSelect('ps2Vermarkungstraeger', 'Vermarkungsträger', Models.PS2Vermarkungstraeger)
             + _fieldText('ps2AndereVermarkungstraeger', 'Anderer Vermarkungsträger');
        break;
      case 'ps3':
        html = _fieldSelect('ps3Vermarkungsart', 'Vermarkungsart', Models.PS3Vermarkungsart)
             + _fieldSelect('ps3Vermarkungstraeger', 'Vermarkungsträger', Models.PS3Vermarkungstraeger)
             + _fieldText('ps3AndereVermarkungsart', 'Andere Vermarkungsart')
             + _fieldText('ps3AndereVermarkungstraeger', 'Anderer Vermarkungsträger');
        break;
      case 'ps4':
        html = _fieldSelect('ps4Vermarkungsart', 'Vermarkungsart', Models.PS4Vermarkungsart)
             + '<div id="ps4-dynamic"></div>'
             + _fieldText('ps4AndereTraeger', 'Anderer Träger');
        break;
      case 'tp':
      case 'lhp':
        html = _fieldSelect('lhpTpVermarkungsart', 'Vermarkungsart', Models.LhpTpVermarkungsart)
             + _fieldSelect('lhpTpVermarkungstraeger', 'Vermarkungsträger', Models.LhpTpVermarkungstraeger)
             + _fieldText('lhpTpAndereVermarkungsart', 'Andere Vermarkungsart')
             + _fieldText('lhpTpAndereVermarkungstraeger', 'Anderer Vermarkungsträger');
        break;
    }
    container.innerHTML = html;

    // Restore values if editing
    if (_editingPoint && _editingPoint.art === art) {
      _restoreArtSpecificValues(_editingPoint, art);
    }

    // PS4 sub-fields
    if (art === 'ps4') {
      const sel = document.getElementById('f-ps4Vermarkungsart');
      if (sel) sel.addEventListener('change', _onPs4VermarkungsartChanged);
      _onPs4VermarkungsartChanged();
    }
  }

  function _onPs4VermarkungsartChanged() {
    const va = document.getElementById('f-ps4Vermarkungsart')?.value;
    const container = document.getElementById('ps4-dynamic');
    if (!container) return;

    let html = '';
    switch (va) {
      case 'gvBolzen':
        html = _fieldSelect('ps4GvBolzenTraeger', 'GV-Bolzen Träger', Models.PS4GvBolzenTraeger)
             + _fieldSelect('ps4GvBolzenLaenge', 'Bolzenlänge', Models.PS4GvBolzenLaenge)
             + _fieldText('ps4MastNummer', 'Mastnummer')
             + _fieldText('ps4HoeheUeberSo', 'Höhe über SO (cm)', 'decimal')
             + _fieldCheckbox('ps4TargetVorhanden', 'Target vorhanden')
             + '<div id="ps4-target-fields"></div>';
        break;
      case 'messmarke':
        html = _fieldSelect('ps4MessmarkeTraeger', 'Messmarke Träger', Models.PS4MessmarkeTraeger);
        break;
      case 'attenberger':
      case 'kreuzankerMitGelberKappe':
        html = _fieldSelect('ps4AllgemeinerTraeger', 'Träger', Models.PS4AllgemeinerTraeger);
        break;
      case 'rammschiene':
        html = _fieldSelect('ps4RammschieneTraeger', 'Ramm-Schiene Träger', Models.PS4RammschieneTraeger);
        break;
      case 'gvPfostenGelb':
        html = _fieldSelect('ps4GvPfostenBolzenLaenge', 'Bolzenlänge', Models.PS4GvBolzenLaenge)
             + _fieldCheckbox('ps4GvPfostenTargetVorhanden', 'Target vorhanden')
             + '<div id="ps4-pfosten-target-fields"></div>';
        break;
    }
    container.innerHTML = html;

    if (_editingPoint) {
      _restorePs4DynamicValues(_editingPoint, va);
    }

    const targetCb = document.getElementById('f-ps4TargetVorhanden');
    if (targetCb) targetCb.addEventListener('change', _onTargetChanged);
    const pfTargetCb = document.getElementById('f-ps4GvPfostenTargetVorhanden');
    if (pfTargetCb) pfTargetCb.addEventListener('change', _onPfostenTargetChanged);
  }

  function _onTargetChanged() {
    const checked = document.getElementById('f-ps4TargetVorhanden')?.checked;
    const container = document.getElementById('ps4-target-fields');
    if (!container) return;
    if (checked) {
      container.innerHTML = _fieldSelect('ps4TargetZustand', 'Target Zustand', Models.TargetZustand)
                          + _fieldText('ps4TargetOffset', 'Target Offset (mm)', 'decimal');
      if (_editingPoint) {
        _setVal('f-ps4TargetZustand', _editingPoint.ps4TargetZustand);
        _setVal('f-ps4TargetOffset', _editingPoint.ps4TargetOffset);
      }
    } else {
      container.innerHTML = '';
    }
  }

  function _onPfostenTargetChanged() {
    const checked = document.getElementById('f-ps4GvPfostenTargetVorhanden')?.checked;
    const container = document.getElementById('ps4-pfosten-target-fields');
    if (!container) return;
    if (checked) {
      container.innerHTML = _fieldSelect('ps4GvPfostenTargetZustand', 'Target Zustand', Models.TargetZustand)
                          + _fieldText('ps4GvPfostenTargetOffset', 'Target Offset (mm)', 'decimal');
      if (_editingPoint) {
        _setVal('f-ps4GvPfostenTargetZustand', _editingPoint.ps4GvPfostenTargetZustand);
        _setVal('f-ps4GvPfostenTargetOffset', _editingPoint.ps4GvPfostenTargetOffset);
      }
    } else {
      container.innerHTML = '';
    }
  }

  // ==================== PHOTOS ====================

  function capturePhoto(slot) {
    _photoSlotTarget = slot;
    const input = document.getElementById('photo-input');
    input.value = '';
    input.click();
  }

  async function onPhotoSelected(event) {
    const file = event.target.files[0];
    if (!file) return;
    const slot = _photoSlotTarget;

    // Validate it's actually an image
    if (!file.type.startsWith('image/')) {
      showToast('Nur Bilddateien erlaubt', 'error');
      return;
    }

    // Warn if file is very large (>15 MB)
    if (file.size > 15 * 1024 * 1024) {
      showToast('Foto ist sehr groß (' + (file.size / (1024*1024)).toFixed(1) + ' MB). Komprimierung empfohlen.', 'error');
    }

    // Compress if > 3 MB
    let blob = file;
    if (file.size > 3 * 1024 * 1024 && file.type.startsWith('image/')) {
      try {
        blob = await _compressImage(file, 1920, 0.85);
      } catch (e) {
        console.warn('Compression failed, using original:', e);
        blob = file;
      }
    }

    // Revoke old URL if any
    if (_photoURLs[slot]) URL.revokeObjectURL(_photoURLs[slot]);

    _photoBlobs[slot] = {
      blob,
      mimeType: blob.type || 'image/jpeg',
      fileName: file.name,
    };

    const url = URL.createObjectURL(blob);
    _photoURLs[slot] = url;
    _showPhotoPreview(slot, url);
    _updatePhotoCount();
    _formDirty = true;
  }

  /**
   * Compresses an image file using canvas.
   * Returns a new Blob.
   */
  function _compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image load failed'));
      };
      img.src = url;
    });
  }

  function removePhoto(slot) {
    if (_photoURLs[slot]) URL.revokeObjectURL(_photoURLs[slot]);
    delete _photoBlobs[slot];
    delete _photoURLs[slot];

    const slotEl = document.querySelector(`.photo-slot[data-slot="${slot}"]`);
    if (slotEl) {
      slotEl.classList.remove('has-photo');
      slotEl.querySelector('.photo-preview').style.display = 'none';
      slotEl.querySelector('.photo-placeholder').style.display = 'flex';
      slotEl.querySelector('.photo-remove').style.display = 'none';
    }

    // If editing, also delete from DB
    if (_editingPoint) {
      DB.deletePhoto(_editingPoint.punktId, slot).catch(e =>
        console.warn('Photo delete from DB failed:', e)
      );
    }

    _updatePhotoCount();
    _formDirty = true;
  }

  function _showPhotoPreview(slot, url) {
    const slotEl = document.querySelector(`.photo-slot[data-slot="${slot}"]`);
    if (!slotEl) return;
    slotEl.classList.add('has-photo');
    const img = slotEl.querySelector('.photo-preview');
    img.src = url;
    img.style.display = 'block';
    slotEl.querySelector('.photo-placeholder').style.display = 'none';
    slotEl.querySelector('.photo-remove').style.display = 'block';
  }

  function _updatePhotoCount() {
    const count = Object.keys(_photoBlobs).length;
    const el = document.getElementById('photo-count');
    if (el) el.textContent = `(${count}/5)`;
  }

  function _clearPhotoState() {
    for (const url of Object.values(_photoURLs)) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    for (const key of Object.keys(_photoBlobs)) delete _photoBlobs[key];
    for (const key of Object.keys(_photoURLs)) delete _photoURLs[key];

    document.querySelectorAll('.photo-slot').forEach(s => {
      s.classList.remove('has-photo');
      const preview = s.querySelector('.photo-preview');
      if (preview) { preview.style.display = 'none'; preview.src = ''; }
      const ph = s.querySelector('.photo-placeholder');
      if (ph) ph.style.display = 'flex';
      const rm = s.querySelector('.photo-remove');
      if (rm) rm.style.display = 'none';
    });
  }

  // ==================== GPS ====================

  function captureGPS() {
    if (!navigator.geolocation) {
      showToast('GPS nicht verfügbar in diesem Browser', 'error');
      return;
    }
    showToast('GPS wird erfasst...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById('f-gpsLatitude').value = pos.coords.latitude.toFixed(8);
        document.getElementById('f-gpsLongitude').value = pos.coords.longitude.toFixed(8);
        if (pos.coords.altitude != null) {
          document.getElementById('f-hoehe').value = pos.coords.altitude.toFixed(2);
        }
        if (pos.coords.accuracy != null) {
          document.getElementById('f-gpsAccuracy').value = pos.coords.accuracy.toFixed(1);
        }
        _formDirty = true;
        showToast(`GPS erfasst (±${pos.coords.accuracy?.toFixed(0) || '?'} m)`, 'success');
      },
      (err) => {
        const msgs = {
          1: 'GPS-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.',
          2: 'GPS-Position nicht verfügbar.',
          3: 'GPS-Zeitüberschreitung. Bitte erneut versuchen.',
        };
        showToast(msgs[err.code] || 'GPS-Fehler: ' + err.message, 'error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  // ==================== EXPORT ====================

  function showExportDialog() {
    const html = `
      <h3>Export</h3>
      <div class="export-option" onclick="App.doExport('unified')">
        <h4>Einheitlicher Export</h4>
        <p>QGIS-CSV + glsurvey-CSV + Fotos als ZIP</p>
      </div>
      <div class="export-option" onclick="App.doExport('csv')">
        <h4>CSV mit Fotos</h4>
        <p>Vollständige CSV mit allen Feldern + Fotos-Ordner</p>
      </div>
      <div class="export-option" onclick="App.doExport('geojson')">
        <h4>GeoJSON</h4>
        <p>Individuelle GeoJSON-Dateien pro Punkt + Fotos</p>
      </div>
      <div class="export-option" onclick="App.doExport('dbexcel')">
        <h4>DB-Excel</h4>
        <p>Tab-getrennte CSV im DB-Excel Format + Fotos</p>
      </div>
      <div style="margin-top:16px">
        <button class="btn btn-secondary btn-block" onclick="App.closeDialog()">Abbrechen</button>
      </div>`;
    showDialog(html);
  }

  async function doExport(format) {
    if (typeof JSZip === 'undefined') {
      closeDialog();
      showToast('Export nicht möglich — JSZip-Bibliothek konnte nicht geladen werden', 'error');
      return;
    }

    closeDialog();
    const points = await DB.getPointsByProject(_currentProject);
    if (points.length === 0) {
      showToast('Keine Punkte zum Exportieren', 'error');
      return;
    }

    showLoading(`Exportiere ${points.length} Punkte...`);
    try {
      let result;
      switch (format) {
        case 'unified':
          result = await ExportService.exportUnified(points, _currentProject);
          break;
        case 'csv':
          result = await ExportService.exportCSVWithPhotos(points, _currentProject);
          break;
        case 'geojson':
          result = await ExportService.exportGeoJSON(points, _currentProject);
          break;
        case 'dbexcel':
          result = await ExportService.exportDbExcel(points, _currentProject);
          break;
      }
      hideLoading();
      _showShareDialog(result.blob, result.filename);
    } catch (e) {
      hideLoading();
      console.error('Export failed:', e);
      showToast('Export fehlgeschlagen: ' + e.message, 'error');
    }
  }

  /**
   * Shows a dialog letting the user choose between sharing and downloading the export.
   */
  function _showShareDialog(blob, filename) {
    const canShare = ExportService.canNativeShare();
    const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
    let html = `
      <h3>Export fertig</h3>
      <p class="share-info">${filename} (${sizeMB} MB)</p>`;

    if (canShare) {
      html += `
      <div class="share-actions">
        <button class="btn btn-primary btn-block" id="btn-share-export">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Teilen
        </button>
        <button class="btn btn-secondary btn-block" id="btn-download-export">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Herunterladen
        </button>
      </div>`;
    } else {
      html += `
      <div class="share-actions">
        <button class="btn btn-primary btn-block" id="btn-download-export">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Herunterladen
        </button>
      </div>`;
    }

    html += `
      <div style="margin-top:8px">
        <button class="btn btn-secondary btn-block" onclick="App.closeDialog()">Abbrechen</button>
      </div>`;

    showDialog(html);

    // Bind download button
    document.getElementById('btn-download-export').addEventListener('click', () => {
      ExportService.downloadFile(blob, filename);
      closeDialog();
      showToast(`Heruntergeladen: ${filename}`, 'success');
    });

    // Bind share button if available
    if (canShare) {
      document.getElementById('btn-share-export').addEventListener('click', async () => {
        try {
          await ExportService.shareFile(blob, filename);
          closeDialog();
          showToast('Export geteilt', 'success');
        } catch (e) {
          console.error('Share failed:', e);
          showToast('Teilen fehlgeschlagen — wird heruntergeladen', 'error');
          ExportService.downloadFile(blob, filename);
          closeDialog();
        }
      });
    }
  }

  // ==================== GEOJSON IMPORT ====================

  function triggerImport() {
    document.getElementById('geojson-input').value = '';
    document.getElementById('geojson-input').click();
  }

  async function onGeoJsonSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    showLoading('GeoJSON wird eingelesen...');
    try {
      let text = await file.text();

      // Strip BOM
      text = text.replace(/^\uFEFF/, '');

      // Outlook/OneDrive can wrap files in binary TNEF or prepend metadata.
      // Find the actual JSON object by searching for {"type" which starts every GeoJSON.
      // Try progressively: first raw text, then search for JSON signature.
      let geojson;
      try {
        geojson = JSON.parse(text);
      } catch (_firstErr) {
        // Search for the GeoJSON signature in the text
        const sig = '{"type"';
        let jsonStart = text.indexOf(sig);
        if (jsonStart < 0) {
          // Try with single quotes or flexible whitespace
          jsonStart = text.indexOf('"type"');
          if (jsonStart > 0) jsonStart = text.lastIndexOf('{', jsonStart);
        }

        if (jsonStart < 0) {
          // Last resort: scan raw bytes for ASCII JSON start
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          // Search for byte sequence: 7B 22 74 79 70 65 22 = {"type"
          const needle = [0x7B, 0x22, 0x74, 0x79, 0x70, 0x65, 0x22];
          for (let i = 0; i < bytes.length - needle.length; i++) {
            let match = true;
            for (let j = 0; j < needle.length; j++) {
              if (bytes[i + j] !== needle[j]) { match = false; break; }
            }
            if (match) {
              // Decode from this position onwards as UTF-8
              text = new TextDecoder('utf-8').decode(bytes.slice(i));
              jsonStart = 0;
              break;
            }
          }
        }

        if (jsonStart < 0) {
          throw new Error('Kein gültiges GeoJSON in der Datei gefunden. Möglicherweise ist die Datei binär verpackt (Outlook/OneDrive).');
        }

        if (jsonStart > 0) {
          console.warn(`GeoJSON: skipping ${jsonStart} bytes of non-JSON data`);
          text = text.substring(jsonStart);
        }

        // Trim trailing garbage after last }
        const jsonEnd = text.lastIndexOf('}');
        if (jsonEnd >= 0 && jsonEnd < text.length - 1) {
          text = text.substring(0, jsonEnd + 1);
        }

        geojson = JSON.parse(text);
      }

      if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
        throw new Error('Keine gültige GeoJSON FeatureCollection');
      }

      if (geojson.features.length === 0) {
        hideLoading();
        showToast('Keine Features in der Datei', 'error');
        return;
      }

      // Auto-detect dynamic property prefix (find key ending with _Strecke, _Target, etc.)
      const sampleProps = geojson.features[0].properties || {};
      let prefix = '';
      for (const key of Object.keys(sampleProps)) {
        const suffixes = ['_Strecke', '_Target', '_Bohrung', '_Foto', '_Bemerkung'];
        for (const suf of suffixes) {
          if (key.endsWith(suf)) {
            prefix = key.slice(0, -suf.length);
            break;
          }
        }
        if (prefix) break;
      }

      const presets = _getPresets();
      let imported = 0;
      let skipped = 0;

      for (const feature of geojson.features) {
        const props = feature.properties || {};
        const mastnummer = String(props.field_1 || '').trim();
        if (!mastnummer) { skipped++; continue; }

        const punktId = mastnummer;

        // Skip duplicates
        const existing = await DB.getPoint(punktId);
        if (existing) { skipped++; continue; }

        // Coordinates: use field_2/field_3 (GK) or geometry
        let rechtswert = parseFloat(props.field_2);
        let hochwert = parseFloat(props.field_3);
        const hoehe = parseFloat(props.field_4) || null;

        // Fallback to geometry coordinates
        if ((!rechtswert || !hochwert) && feature.geometry?.coordinates) {
          rechtswert = feature.geometry.coordinates[0];
          hochwert = feature.geometry.coordinates[1];
        }

        // Convert GK → WGS84
        let latitude = null, longitude = null, gkZone = null;
        if (rechtswert && hochwert) {
          const wgs = ExportService.dbRefGkToWgs84(rechtswert, hochwert);
          if (wgs) {
            latitude = wgs.latitude;
            longitude = wgs.longitude;
            gkZone = wgs.zone;
          }
        }

        // Extract properties via detected prefix
        const pStrecke = prefix ? props[`${prefix}_Strecke`] : null;
        const pTarget = prefix ? props[`${prefix}_Target`] : null;
        const pBemerkung = prefix ? props[`${prefix}_Bemerkung`] : null;

        const strecke = String(pStrecke || presets.strecke || '');
        const gicCode = String(props.field_5 || presets.gicCode || '');
        const art = Models.GIC_TO_ART[parseInt(gicCode)] || presets.art || 'ps4';

        // Build bemerkungen from import data
        const bemParts = [];
        if (pBemerkung) bemParts.push(pBemerkung);
        const bemerkungen = bemParts.join('; ') || null;

        const pointData = {
          punktId,
          projektNummer: _currentProject,
          art,
          strecke,
          gicCode: gicCode || null,
          ps4MastNummer: mastnummer,
          erfassungsdatum: new Date().toISOString(),
          erfasser: presets.erfasser || '',
          seite: 'rechts',
          neuOderBestand: 'bestandspunkt',
          status: 'intakt',
          rilKonformitaet: 'konform',
          einmessskizze: 'nein',
          gpsLatitude: latitude,
          gpsLongitude: longitude,
          hoehe,
          dbrefX: rechtswert || null,
          dbrefY: hochwert || null,
          gkZone,
          bemerkungen,
          importStatus: 'offen',
          importQuelle: file.name,
        };

        // Pre-set target vorhanden if indicated in import data or preset
        if (pTarget === 'J' || presets.targetVorhanden) {
          pointData.ps4TargetVorhanden = true;
        }

        await DB.savePointWithPhotos(pointData, {});
        imported++;
      }

      hideLoading();
      let msg = `${imported} Punkt(e) importiert`;
      if (skipped > 0) msg += `, ${skipped} übersprungen (Duplikate)`;
      showToast(msg, 'success');
      await showPoints();
    } catch (e) {
      hideLoading();
      console.error('Import failed:', e);
      showToast('Import fehlgeschlagen: ' + e.message, 'error');
    }
  }

  // ==================== SECTIONS ====================

  function toggleSection(headerEl) {
    headerEl.parentElement.classList.toggle('expanded');
  }

  // ==================== DIALOG / TOAST / LOADING ====================

  function showDialog(html) {
    document.getElementById('dialog-content').innerHTML = html;
    document.getElementById('dialog-overlay').style.display = 'flex';
  }

  function closeDialog() {
    document.getElementById('dialog-overlay').style.display = 'none';
  }

  let _toastTimer = null;
  function showToast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
    el.style.display = 'block';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  function showLoading(text) {
    document.getElementById('loading-text').textContent = text || 'Wird verarbeitet...';
    document.getElementById('loading').style.display = 'flex';
  }
  function hideLoading() {
    document.getElementById('loading').style.display = 'none';
  }

  // ==================== FORM HELPERS ====================

  function _fieldSelect(name, label, enumObj, selected) {
    return `<div class="form-group">
      <label for="f-${name}">${label}</label>
      <select id="f-${name}">${Models.enumOptions(enumObj, selected, true)}</select>
    </div>`;
  }

  function _fieldText(name, label, inputMode) {
    const im = inputMode ? ` inputmode="${inputMode}"` : '';
    return `<div class="form-group">
      <label for="f-${name}">${label}</label>
      <input type="text" id="f-${name}"${im}>
    </div>`;
  }

  function _fieldCheckbox(name, label) {
    return `<div class="checkbox-group">
      <input type="checkbox" id="f-${name}">
      <label for="f-${name}">${label}</label>
    </div>`;
  }

  function _parseFloat(id) {
    const v = document.getElementById(id)?.value?.trim();
    if (!v) return null;
    const n = parseFloat(v.replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  function _parseInt(id) {
    const v = document.getElementById(id)?.value?.trim();
    if (!v) return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  function _setVal(id, value) {
    const el = document.getElementById(id);
    if (!el || value == null) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value;
  }

  function _populateForm(p) {
    _setVal('f-punktId', p.punktId);
    document.getElementById('f-punktId').readOnly = true;
    _setVal('f-gicCode', p.gicCode);
    _setVal('f-strecke', p.strecke);
    _setVal('f-station', p.station);
    _setVal('f-art', p.art);
    _setVal('f-seite', p.seite);
    _setVal('f-erfasser', p.erfasser);
    _setVal('f-neuOderBestand', p.neuOderBestand);
    _setVal('f-status', p.status);
    _setVal('f-rilKonformitaet', p.rilKonformitaet);
    _setVal('f-gnssTauglichkeit', p.gnssTauglichkeit);
    _setVal('f-einmessskizze', p.einmessskizze);
    _setVal('f-gpsLatitude', p.gpsLatitude);
    _setVal('f-gpsLongitude', p.gpsLongitude);
    _setVal('f-hoehe', p.hoehe);
    _setVal('f-gpsAccuracy', p.gpsAccuracy);
    _setVal('f-dbrefX', p.dbrefX);
    _setVal('f-dbrefY', p.dbrefY);
    _setVal('f-gkZone', p.gkZone);
    _setVal('f-bemerkungen', p.bemerkungen);
  }

  function _readArtSpecificFields(data, art) {
    const _v = (id) => document.getElementById(id)?.value?.trim() || null;
    const _cb = (id) => document.getElementById(id)?.checked ?? null;

    switch (art) {
      case 'ps0':
        data.ps0Vermarkungsart = _v('f-ps0Vermarkungsart');
        data.ps0Vermarkungstraeger = _v('f-ps0Vermarkungstraeger');
        data.ps0AndereVermarkungsart = _v('f-ps0AndereVermarkungsart');
        data.ps0AndereVermarkungstraeger = _v('f-ps0AndereVermarkungstraeger');
        break;
      case 'ps1':
        data.ps1Vermarkungstraeger = _v('f-ps1Vermarkungstraeger');
        data.ps1AndereVermarkungstraeger = _v('f-ps1AndereVermarkungstraeger');
        break;
      case 'ps2':
        data.ps2Vermarkungsart = _v('f-ps2Vermarkungsart');
        data.ps2Vermarkungstraeger = _v('f-ps2Vermarkungstraeger');
        data.ps2AndereVermarkungstraeger = _v('f-ps2AndereVermarkungstraeger');
        break;
      case 'ps3':
        data.ps3Vermarkungsart = _v('f-ps3Vermarkungsart');
        data.ps3Vermarkungstraeger = _v('f-ps3Vermarkungstraeger');
        data.ps3AndereVermarkungsart = _v('f-ps3AndereVermarkungsart');
        data.ps3AndereVermarkungstraeger = _v('f-ps3AndereVermarkungstraeger');
        break;
      case 'ps4':
        data.ps4Vermarkungsart = _v('f-ps4Vermarkungsart');
        data.ps4GvBolzenTraeger = _v('f-ps4GvBolzenTraeger');
        data.ps4MessmarkeTraeger = _v('f-ps4MessmarkeTraeger');
        data.ps4AllgemeinerTraeger = _v('f-ps4AllgemeinerTraeger');
        data.ps4RammschieneTraeger = _v('f-ps4RammschieneTraeger');
        data.ps4GvBolzenLaenge = _v('f-ps4GvBolzenLaenge');
        data.ps4HoeheUeberSo = _parseFloat('f-ps4HoeheUeberSo');
        data.ps4TargetVorhanden = _cb('f-ps4TargetVorhanden');
        data.ps4TargetZustand = _v('f-ps4TargetZustand');
        data.ps4TargetOffset = _parseFloat('f-ps4TargetOffset');
        data.ps4MastNummer = _v('f-ps4MastNummer');
        data.ps4AndereTraeger = _v('f-ps4AndereTraeger');
        data.ps4GvPfostenBolzenLaenge = _v('f-ps4GvPfostenBolzenLaenge');
        data.ps4GvPfostenTargetVorhanden = _cb('f-ps4GvPfostenTargetVorhanden');
        data.ps4GvPfostenTargetZustand = _v('f-ps4GvPfostenTargetZustand');
        data.ps4GvPfostenTargetOffset = _parseFloat('f-ps4GvPfostenTargetOffset');
        break;
      case 'tp':
      case 'lhp':
        data.lhpTpVermarkungsart = _v('f-lhpTpVermarkungsart');
        data.lhpTpVermarkungstraeger = _v('f-lhpTpVermarkungstraeger');
        data.lhpTpAndereVermarkungsart = _v('f-lhpTpAndereVermarkungsart');
        data.lhpTpAndereVermarkungstraeger = _v('f-lhpTpAndereVermarkungstraeger');
        break;
    }
  }

  function _restoreArtSpecificValues(p, art) {
    switch (art) {
      case 'ps0':
        _setVal('f-ps0Vermarkungsart', p.ps0Vermarkungsart);
        _setVal('f-ps0Vermarkungstraeger', p.ps0Vermarkungstraeger);
        _setVal('f-ps0AndereVermarkungsart', p.ps0AndereVermarkungsart);
        _setVal('f-ps0AndereVermarkungstraeger', p.ps0AndereVermarkungstraeger);
        break;
      case 'ps1':
        _setVal('f-ps1Vermarkungstraeger', p.ps1Vermarkungstraeger);
        _setVal('f-ps1AndereVermarkungstraeger', p.ps1AndereVermarkungstraeger);
        break;
      case 'ps2':
        _setVal('f-ps2Vermarkungsart', p.ps2Vermarkungsart);
        _setVal('f-ps2Vermarkungstraeger', p.ps2Vermarkungstraeger);
        _setVal('f-ps2AndereVermarkungstraeger', p.ps2AndereVermarkungstraeger);
        break;
      case 'ps3':
        _setVal('f-ps3Vermarkungsart', p.ps3Vermarkungsart);
        _setVal('f-ps3Vermarkungstraeger', p.ps3Vermarkungstraeger);
        _setVal('f-ps3AndereVermarkungsart', p.ps3AndereVermarkungsart);
        _setVal('f-ps3AndereVermarkungstraeger', p.ps3AndereVermarkungstraeger);
        break;
      case 'ps4':
        _setVal('f-ps4Vermarkungsart', p.ps4Vermarkungsart);
        break;
      case 'tp':
      case 'lhp':
        _setVal('f-lhpTpVermarkungsart', p.lhpTpVermarkungsart);
        _setVal('f-lhpTpVermarkungstraeger', p.lhpTpVermarkungstraeger);
        _setVal('f-lhpTpAndereVermarkungsart', p.lhpTpAndereVermarkungsart);
        _setVal('f-lhpTpAndereVermarkungstraeger', p.lhpTpAndereVermarkungstraeger);
        break;
    }
  }

  function _restorePs4DynamicValues(p, va) {
    switch (va) {
      case 'gvBolzen':
        _setVal('f-ps4GvBolzenTraeger', p.ps4GvBolzenTraeger);
        _setVal('f-ps4GvBolzenLaenge', p.ps4GvBolzenLaenge);
        _setVal('f-ps4MastNummer', p.ps4MastNummer);
        _setVal('f-ps4HoeheUeberSo', p.ps4HoeheUeberSo);
        _setVal('f-ps4TargetVorhanden', p.ps4TargetVorhanden);
        if (p.ps4TargetVorhanden) _onTargetChanged();
        break;
      case 'messmarke':
        _setVal('f-ps4MessmarkeTraeger', p.ps4MessmarkeTraeger);
        break;
      case 'attenberger':
      case 'kreuzankerMitGelberKappe':
        _setVal('f-ps4AllgemeinerTraeger', p.ps4AllgemeinerTraeger);
        break;
      case 'rammschiene':
        _setVal('f-ps4RammschieneTraeger', p.ps4RammschieneTraeger);
        break;
      case 'gvPfostenGelb':
        _setVal('f-ps4GvPfostenBolzenLaenge', p.ps4GvPfostenBolzenLaenge);
        _setVal('f-ps4GvPfostenTargetVorhanden', p.ps4GvPfostenTargetVorhanden);
        if (p.ps4GvPfostenTargetVorhanden) _onPfostenTargetChanged();
        break;
    }
  }

  // ==================== HELPERS ====================

  function _escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _escAttr(s) {
    if (!s) return '';
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  // ==================== INIT ON LOAD ====================

  document.addEventListener('DOMContentLoaded', init);

  return {
    init, showProjects, showNewProjectDialog, createProject, selectProject,
    confirmDeleteProject, doDeleteProject,
    showPoints, showPointForm, editPoint, cancelPointForm, savePoint,
    confirmDeletePoint, doDeletePoint,
    onArtChanged, capturePhoto, onPhotoSelected, removePhoto,
    captureGPS, toggleSection,
    showExportDialog, doExport,
    showDialog, closeDialog, showToast,
    // Presets
    togglePresets, savePresets,
    // Import
    triggerImport, onGeoJsonSelected,
    // Filters, pagination, grouping
    applyFilters, prevPage, nextPage, toggleKmGroup,
    // Internal (exposed for dialog callback)
    _doCancel,
  };
})();
