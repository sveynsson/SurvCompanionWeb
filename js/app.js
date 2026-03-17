/**
 * Main Application Controller for SurvCompanion Web
 */
const App = (() => {
  let _currentProject = null;
  let _editingPoint = null;
  let _photoSlotTarget = 0;
  const _photoBlobs = {}; // slot -> { blob, mimeType, fileName }
  const _photoURLs = {};  // slot -> objectURL (for display, must be revoked)

  // ==================== INITIALIZATION ====================

  async function init() {
    try {
      await DB.open();
      // Request persistent storage immediately
      const persisted = await DB.requestPersistentStorage();
      if (!persisted) {
        console.warn('Persistent storage not granted — data may be evicted by browser');
      }
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
    const projects = await DB.getAllProjects();
    const list = document.getElementById('project-list');
    const empty = document.getElementById('no-projects');

    if (projects.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    // Sort by creation date desc
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

    await DB.saveProject({
      projektNummer: nr,
      bezeichnung: document.getElementById('d-projBez').value.trim() || nr,
      ersteller: document.getElementById('d-projErsteller').value.trim(),
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
    const html = `
      <h3>Projekt löschen?</h3>
      <p class="confirm-text">
        Projekt <strong>${_escHtml(projektNummer)}</strong> und alle
        <strong>${points.length}</strong> Punkte mit Fotos werden unwiderruflich gelöscht.
      </p>
      <p class="warning-text">Diese Aktion kann nicht rückgängig gemacht werden!</p>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="App.closeDialog()">Abbrechen</button>
        <button class="btn btn-danger" onclick="App.doDeleteProject('${_escAttr(projektNummer)}')">Löschen</button>
      </div>`;
    showDialog(html);
  }

  async function doDeleteProject(projektNummer) {
    await DB.deleteProject(projektNummer);
    closeDialog();
    showToast('Projekt gelöscht', 'success');
    await showProjects();
  }

  // ==================== POINTS LIST ====================

  async function showPoints() {
    showView('view-points');
    const proj = await DB.getProject(_currentProject);
    document.getElementById('points-title').textContent = proj?.bezeichnung || _currentProject;

    const points = await DB.getPointsByProject(_currentProject);
    const list = document.getElementById('point-list');
    const empty = document.getElementById('no-points');

    if (points.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    points.sort((a, b) => new Date(b.erfassungsdatum) - new Date(a.erfassungsdatum));

    let html = '';
    for (const p of points) {
      const photoCount = [p.foto1, p.foto2, p.foto3, p.foto4, p.foto5].filter(Boolean).length;
      const date = new Date(p.erfassungsdatum).toLocaleDateString('de-DE');
      const station = p.station != null ? ` km ${p.station}` : '';
      html += `
        <div class="list-item" onclick="App.editPoint('${_escAttr(p.punktId)}')">
          <div class="list-item-content">
            <div class="list-item-title">
              <span class="badge badge-${p.art}">${Models.displayName(Models.PunktArt, p.art)}</span>
              ${_escHtml(p.punktId)}
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
    list.innerHTML = html;
  }

  async function confirmDeletePoint(punktId) {
    const html = `
      <h3>Punkt löschen?</h3>
      <p class="confirm-text">Punkt <strong>${_escHtml(punktId)}</strong> mit allen Fotos wird unwiderruflich gelöscht.</p>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="App.closeDialog()">Abbrechen</button>
        <button class="btn btn-danger" onclick="App.doDeletePoint('${_escAttr(punktId)}')">Löschen</button>
      </div>`;
    showDialog(html);
  }

  async function doDeletePoint(punktId) {
    await DB.deletePoint(punktId);
    closeDialog();
    showToast('Punkt gelöscht', 'success');
    await showPoints();
  }

  // ==================== POINT FORM ====================

  function showPointForm(existingPoint) {
    _editingPoint = existingPoint || null;
    _clearPhotoState();

    document.getElementById('point-form-title').textContent =
      existingPoint ? 'Punkt bearbeiten' : 'Punkt erfassen';

    const form = document.getElementById('point-form');
    form.reset();

    if (existingPoint) {
      _populateForm(existingPoint);
    } else {
      // Defaults
      document.getElementById('f-art').value = 'ps4';
      document.getElementById('f-seite').value = 'rechts';
      // Restore last used erfasser from localStorage
      const lastErfasser = localStorage.getItem('sc_lastErfasser');
      if (lastErfasser) document.getElementById('f-erfasser').value = lastErfasser;
    }

    onArtChanged();
    _updatePhotoCount();
    showView('view-point-form');

    // Expand first section
    document.querySelectorAll('.form-section').forEach((s, i) => {
      if (i === 0) s.classList.add('expanded');
      else if (!existingPoint) s.classList.remove('expanded');
    });
  }

  async function editPoint(punktId) {
    const point = await DB.getPoint(punktId);
    if (!point) { showToast('Punkt nicht gefunden', 'error'); return; }
    showPointForm(point);
    // Load existing photo previews
    for (let slot = 1; slot <= 5; slot++) {
      if (point[`foto${slot}`]) {
        const url = await DB.getPhotoURL(punktId, slot);
        if (url) {
          _photoURLs[slot] = url;
          _showPhotoPreview(slot, url);
          // Mark as existing (not a new blob)
          _photoBlobs[slot] = { existing: true };
        }
      }
    }
  }

  function cancelPointForm() {
    _clearPhotoState();
    if (_currentProject) showPoints();
    else showProjects();
  }

  async function savePoint() {
    const form = document.getElementById('point-form');
    const punktId = document.getElementById('f-punktId').value.trim();
    const strecke = document.getElementById('f-strecke').value.trim();
    const erfasser = document.getElementById('f-erfasser').value.trim();

    if (!punktId || !strecke || !erfasser) {
      showToast('Bitte alle Pflichtfelder (*) ausfüllen', 'error');
      return;
    }

    // Check for duplicate ID (only when creating new)
    if (!_editingPoint) {
      const existing = await DB.getPoint(punktId);
      if (existing) {
        showToast('Punkt-ID existiert bereits', 'error');
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
      // Coordinates
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

    // Photo flags (true if slot has a photo)
    for (let slot = 1; slot <= 5; slot++) {
      pointData[`foto${slot}`] = _photoBlobs[slot] ? true : null;
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

    try {
      showLoading('Speichere Punkt...');
      await DB.savePointWithPhotos(pointData, newPhotos);
      hideLoading();
      _clearPhotoState();
      showToast('Punkt gespeichert', 'success');
      await showPoints();
    } catch (e) {
      hideLoading();
      console.error('Save failed:', e);
      showToast('Speichern fehlgeschlagen: ' + e.message, 'error');
    }
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

    // Target checkbox listener
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

    // Revoke old URL if any
    if (_photoURLs[slot]) URL.revokeObjectURL(_photoURLs[slot]);

    _photoBlobs[slot] = {
      blob: file,
      mimeType: file.type || 'image/jpeg',
      fileName: file.name,
    };

    const url = URL.createObjectURL(file);
    _photoURLs[slot] = url;
    _showPhotoPreview(slot, url);
    _updatePhotoCount();
  }

  function removePhoto(slot) {
    if (_photoURLs[slot]) URL.revokeObjectURL(_photoURLs[slot]);
    delete _photoBlobs[slot];
    delete _photoURLs[slot];

    const slotEl = document.querySelector(`.photo-slot[data-slot="${slot}"]`);
    slotEl.classList.remove('has-photo');
    slotEl.querySelector('.photo-preview').style.display = 'none';
    slotEl.querySelector('.photo-placeholder').style.display = 'flex';
    slotEl.querySelector('.photo-remove').style.display = 'none';

    // If editing, also delete from DB
    if (_editingPoint) {
      DB.deletePhoto(_editingPoint.punktId, slot).catch(console.error);
    }

    _updatePhotoCount();
  }

  function _showPhotoPreview(slot, url) {
    const slotEl = document.querySelector(`.photo-slot[data-slot="${slot}"]`);
    slotEl.classList.add('has-photo');
    const img = slotEl.querySelector('.photo-preview');
    img.src = url;
    img.style.display = 'block';
    slotEl.querySelector('.photo-placeholder').style.display = 'none';
    slotEl.querySelector('.photo-remove').style.display = 'block';
  }

  function _updatePhotoCount() {
    const count = Object.keys(_photoBlobs).length;
    document.getElementById('photo-count').textContent = `(${count}/5)`;
  }

  function _clearPhotoState() {
    for (const url of Object.values(_photoURLs)) {
      URL.revokeObjectURL(url);
    }
    for (const key of Object.keys(_photoBlobs)) delete _photoBlobs[key];
    for (const key of Object.keys(_photoURLs)) delete _photoURLs[key];

    document.querySelectorAll('.photo-slot').forEach(s => {
      s.classList.remove('has-photo');
      s.querySelector('.photo-preview').style.display = 'none';
      s.querySelector('.photo-placeholder').style.display = 'flex';
      s.querySelector('.photo-remove').style.display = 'none';
    });
  }

  // ==================== GPS ====================

  function captureGPS() {
    if (!navigator.geolocation) {
      showToast('GPS nicht verfügbar', 'error');
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
        showToast('GPS-Position erfasst', 'success');
      },
      (err) => {
        showToast('GPS-Fehler: ' + err.message, 'error');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
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
    closeDialog();
    const points = await DB.getPointsByProject(_currentProject);
    if (points.length === 0) {
      showToast('Keine Punkte zum Exportieren', 'error');
      return;
    }

    showLoading('Exportiere...');
    try {
      let filename;
      switch (format) {
        case 'unified':
          filename = await ExportService.exportUnified(points, _currentProject);
          break;
        case 'csv':
          filename = await ExportService.exportCSVWithPhotos(points, _currentProject);
          break;
        case 'geojson':
          filename = await ExportService.exportGeoJSON(points, _currentProject);
          break;
        case 'dbexcel':
          filename = await ExportService.exportDbExcel(points, _currentProject);
          break;
      }
      hideLoading();
      showToast(`Export: ${filename}`, 'success');
    } catch (e) {
      hideLoading();
      console.error('Export failed:', e);
      showToast('Export fehlgeschlagen: ' + e.message, 'error');
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
    _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
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
    return `<div class="form-group" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="f-${name}" style="width:auto">
      <label for="f-${name}" style="margin:0;text-transform:none;font-size:15px">${label}</label>
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
        // Dynamic fields will be restored after sub-change fires
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
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _escAttr(s) {
    if (!s) return '';
    return s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
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
  };
})();
