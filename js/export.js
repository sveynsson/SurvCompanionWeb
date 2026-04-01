/**
 * Export Service for SurvCompanion Web
 *
 * Provides the same export formats as the Android app:
 * 1. Unified ZIP (QGIS-CSV + glsurvey-CSV + photos)
 * 2. CSV with Photos ZIP
 * 3. GeoJSON ZIP
 * 4. DB-Excel CSV ZIP
 */
const ExportService = (() => {

  // ==================== PROJ4 SETUP ====================

  function _initProj4() {
    if (typeof proj4 === 'undefined') return;
    const towgs84Bessel = '+towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7';
    const defs = {
      // DB-Ref Gauß-Krüger (Bessel ellipsoid)
      'EPSG:5681': `+proj=tmerc +lat_0=0 +lon_0=3  +k=1 +x_0=1500000 +y_0=0 +ellps=bessel ${towgs84Bessel} +units=m +no_defs`,
      'EPSG:5682': `+proj=tmerc +lat_0=0 +lon_0=6  +k=1 +x_0=2500000 +y_0=0 +ellps=bessel ${towgs84Bessel} +units=m +no_defs`,
      'EPSG:5683': `+proj=tmerc +lat_0=0 +lon_0=9  +k=1 +x_0=3500000 +y_0=0 +ellps=bessel ${towgs84Bessel} +units=m +no_defs`,
      'EPSG:5684': `+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=4500000 +y_0=0 +ellps=bessel ${towgs84Bessel} +units=m +no_defs`,
      'EPSG:5685': `+proj=tmerc +lat_0=0 +lon_0=15 +k=1 +x_0=5500000 +y_0=0 +ellps=bessel ${towgs84Bessel} +units=m +no_defs`,
      // UTM / ETRS89 (GRS80 ellipsoid ≈ WGS84)
      'EPSG:25831': '+proj=utm +zone=31 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
      'EPSG:25832': '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
      'EPSG:25833': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
      'EPSG:25834': '+proj=utm +zone=34 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    };
    for (const [code, def] of Object.entries(defs)) {
      try { proj4.defs(code, def); } catch (e) { /* already defined */ }
    }
  }

  /**
   * Supported EPSG codes for CSV import, grouped for display.
   */
  const IMPORT_CRS_OPTIONS = [
    { value: 'EPSG:5681',  label: 'EPSG:5681 – DB-Ref GK Zone 1 (Meridian 3°)' },
    { value: 'EPSG:5682',  label: 'EPSG:5682 – DB-Ref GK Zone 2 (Meridian 6°)' },
    { value: 'EPSG:5683',  label: 'EPSG:5683 – DB-Ref GK Zone 3 (Meridian 9°)' },
    { value: 'EPSG:5684',  label: 'EPSG:5684 – DB-Ref GK Zone 4 (Meridian 12°)' },
    { value: 'EPSG:5685',  label: 'EPSG:5685 – DB-Ref GK Zone 5 (Meridian 15°)' },
    { value: 'EPSG:25831', label: 'EPSG:25831 – UTM Zone 31N (ETRS89)' },
    { value: 'EPSG:25832', label: 'EPSG:25832 – UTM Zone 32N (ETRS89)' },
    { value: 'EPSG:25833', label: 'EPSG:25833 – UTM Zone 33N (ETRS89)' },
    { value: 'EPSG:25834', label: 'EPSG:25834 – UTM Zone 34N (ETRS89)' },
    { value: 'EPSG:4326',  label: 'EPSG:4326 – WGS84 (Breiten-/Längengrad)' },
  ];

  /**
   * General coordinate transform: (Rechtswert/X, Hochwert/Y) in given CRS → WGS84.
   * epsg: one of the values in IMPORT_CRS_OPTIONS, or 'auto'.
   * Returns { latitude, longitude, zone } or null on failure.
   */
  function coordToWgs84(rechtswert, hochwert, epsg) {
    if (epsg === 'EPSG:4326') {
      // Already WGS84: Hochwert = latitude, Rechtswert = longitude
      return { latitude: hochwert, longitude: rechtswert, zone: null };
    }
    if (typeof proj4 === 'undefined') return null;
    _initProj4();
    try {
      const result = proj4(epsg, 'EPSG:4326', [rechtswert, hochwert]);
      return { longitude: result[0], latitude: result[1], zone: null };
    } catch (e) {
      console.warn('coordToWgs84 failed:', e);
      return null;
    }
  }

  function _gkZoneFromLongitude(lon) {
    if (lon < 4.5) return 1;
    if (lon < 7.5) return 2;
    if (lon < 10.5) return 3;
    if (lon < 13.5) return 4;
    return 5;
  }

  function _wgs84ToDbRefGk(lat, lon) {
    if (typeof proj4 === 'undefined') return null;
    _initProj4();
    try {
      const zone = _gkZoneFromLongitude(lon);
      const epsg = `EPSG:${5680 + zone}`;
      const result = proj4('EPSG:4326', epsg, [lon, lat]);
      return { rechtswert: result[0], hochwert: result[1], zone };
    } catch (e) {
      console.warn('GK transform failed:', e);
      return null;
    }
  }

  /**
   * Inverse transform: DB-Ref Gauß-Krüger → WGS84.
   * Zone is auto-detected from the Rechtswert prefix digit.
   */
  function dbRefGkToWgs84(rechtswert, hochwert) {
    if (typeof proj4 === 'undefined') return null;
    _initProj4();
    try {
      const zone = Math.floor(rechtswert / 1000000);
      if (zone < 1 || zone > 5) return null;
      const epsg = `EPSG:${5680 + zone}`;
      const result = proj4(epsg, 'EPSG:4326', [rechtswert, hochwert]);
      return { longitude: result[0], latitude: result[1], zone };
    } catch (e) {
      console.warn('Inverse GK transform failed:', e);
      return null;
    }
  }

  // ==================== CSV HELPERS ====================

  function _esc(value) {
    const s = value == null ? '' : String(value);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function _dn(enumObj, name) {
    return Models.displayName(enumObj, name);
  }

  // ==================== PHOTO HELPERS ====================

  /**
   * Returns which photo slots a point has.
   */
  function _photoSlotsFor(point) {
    const slots = [];
    for (let slot = 1; slot <= 5; slot++) {
      if (point[`foto${slot}`]) slots.push(slot);
    }
    return slots;
  }

  // ==================== QGIS CSV ====================

  function _generateQgisCsv(points, projektNummer) {
    const header = [
      'punkt_id','station','strecke','seite','art',
      'foto1','foto2','foto3','foto4','foto5',
      'erfassungsdatum','erfasser','neu_oder_bestand','gnss_tauglichkeit','ril_konformitaet','status','einmessskizze',
      'dbref_x','dbref_y','gk_zone','gps_latitude','gps_longitude','hoehe','gps_accuracy',
      'ps0_vermarkungsart','ps0_vermarkungstraeger','ps0_andere_vermarkungsart','ps0_andere_vermarkungstraeger',
      'ps1_vermarkungstraeger','ps1_andere_vermarkungstraeger',
      'ps2_vermarkungsart','ps2_vermarkungstraeger','ps2_andere_vermarkungstraeger',
      'ps3_vermarkungsart','ps3_vermarkungstraeger','ps3_andere_vermarkungsart','ps3_andere_vermarkungstraeger',
      'ps4_vermarkungsart','ps4_gv_bolzen_traeger','ps4_messmarke_traeger','ps4_allgemeiner_traeger',
      'ps4_gv_bolzen_laenge','ps4_hoehe_ueber_so','ps4_target_vorhanden','ps4_target_zustand','ps4_target_offset','ps4_mast_nummer','ps4_andere_traeger',
      'lhp_tp_vermarkungsart','lhp_tp_vermarkungstraeger','lhp_tp_andere_vermarkungsart','lhp_tp_andere_vermarkungstraeger',
      'bemerkungen','projekt_nummer',
    ];

    let csv = header.join(',') + '\n';

    for (const p of points) {
      const row = [
        p.punktId,
        p.station ?? '',
        p.strecke,
        _dn(Models.Seite, p.seite),
        _dn(Models.PunktArt, p.art),
        p.foto1 ? `fotos/${p.punktId}_foto1.jpg` : '',
        p.foto2 ? `fotos/${p.punktId}_foto2.jpg` : '',
        p.foto3 ? `fotos/${p.punktId}_foto3.jpg` : '',
        p.foto4 ? `fotos/${p.punktId}_foto4.jpg` : '',
        p.foto5 ? `fotos/${p.punktId}_foto5.jpg` : '',
        p.erfassungsdatum,
        p.erfasser,
        _dn(Models.PunktTyp, p.neuOderBestand),
        _dn(Models.GnssTauglichkeit, p.gnssTauglichkeit),
        _dn(Models.RilKonformitaet, p.rilKonformitaet),
        _dn(Models.PunktStatus, p.status),
        _dn(Models.Einmessskizze, p.einmessskizze),
        p.dbrefX ?? '', p.dbrefY ?? '', p.gkZone ?? '',
        p.gpsLatitude ?? '', p.gpsLongitude ?? '', p.hoehe ?? '', p.gpsAccuracy ?? '',
        _dn(Models.PS0Vermarkungsart, p.ps0Vermarkungsart),
        _dn(Models.PS0Vermarkungstraeger, p.ps0Vermarkungstraeger),
        p.ps0AndereVermarkungsart ?? '', p.ps0AndereVermarkungstraeger ?? '',
        _dn(Models.PS1Vermarkungstraeger, p.ps1Vermarkungstraeger),
        p.ps1AndereVermarkungstraeger ?? '',
        _dn(Models.PS2Vermarkungsart, p.ps2Vermarkungsart),
        _dn(Models.PS2Vermarkungstraeger, p.ps2Vermarkungstraeger),
        p.ps2AndereVermarkungstraeger ?? '',
        _dn(Models.PS3Vermarkungsart, p.ps3Vermarkungsart),
        _dn(Models.PS3Vermarkungstraeger, p.ps3Vermarkungstraeger),
        p.ps3AndereVermarkungsart ?? '', p.ps3AndereVermarkungstraeger ?? '',
        _dn(Models.PS4Vermarkungsart, p.ps4Vermarkungsart),
        _dn(Models.PS4GvBolzenTraeger, p.ps4GvBolzenTraeger),
        _dn(Models.PS4MessmarkeTraeger, p.ps4MessmarkeTraeger),
        _dn(Models.PS4AllgemeinerTraeger, p.ps4AllgemeinerTraeger),
        _dn(Models.PS4GvBolzenLaenge, p.ps4GvBolzenLaenge),
        p.ps4HoeheUeberSo ?? '',
        p.ps4TargetVorhanden ?? '',
        _dn(Models.TargetZustand, p.ps4TargetZustand),
        p.ps4TargetOffset ?? '',
        p.ps4MastNummer ?? '',
        p.ps4AndereTraeger ?? '',
        _dn(Models.LhpTpVermarkungsart, p.lhpTpVermarkungsart),
        _dn(Models.LhpTpVermarkungstraeger, p.lhpTpVermarkungstraeger),
        p.lhpTpAndereVermarkungsart ?? '', p.lhpTpAndereVermarkungstraeger ?? '',
        p.bemerkungen ?? '',
        projektNummer,
      ].map(_esc).join(',');
      csv += row + '\n';
    }

    return csv;
  }

  // ==================== GLSURVEY CSV ====================

  function _generateGlSurveyCsv(points) {
    let csv = 'Punktnummer,Rechtswert,Hochwert,Hoehe,Art,Bemerkungen\n';
    for (const p of points) {
      let rw = null, hw = null;
      if (p.gpsLatitude != null && p.gpsLongitude != null) {
        const gk = _wgs84ToDbRefGk(p.gpsLatitude, p.gpsLongitude);
        if (gk) { rw = gk.rechtswert; hw = gk.hochwert; }
      }
      rw = rw ?? p.dbrefX;
      hw = hw ?? p.dbrefY;
      const row = [
        p.punktId,
        rw != null ? rw.toFixed(4) : '',
        hw != null ? hw.toFixed(4) : '',
        p.hoehe != null ? p.hoehe.toFixed(4) : '',
        _dn(Models.PunktArt, p.art),
        p.bemerkungen ?? '',
      ].map(_esc).join(',');
      csv += row + '\n';
    }
    return csv;
  }

  // ==================== DB-EXCEL CSV ====================

  function _generateDbExcelCsv(points) {
    let csv = 'Dateiname\tStrecke\tVermarkungsträger\tMastnummer\tBolzenlänge/Offset\tTargetseite (L/R)\tAnbringung (neu/at)\tP.-Nr.\tKilometrierungswert\tNummerierungsbezirk\tVermarkungsdatum\n';

    for (const p of points) {
      for (const slot of _photoSlotsFor(p)) {
        const dateiname = `${p.punktId}_foto${slot}.jpg`;
        let traeger = '';
        if (p.ps4GvBolzenTraeger) traeger = _dn(Models.PS4GvBolzenTraeger, p.ps4GvBolzenTraeger);
        else if (p.ps4MessmarkeTraeger) traeger = _dn(Models.PS4MessmarkeTraeger, p.ps4MessmarkeTraeger);
        else if (p.ps4AllgemeinerTraeger) traeger = _dn(Models.PS4AllgemeinerTraeger, p.ps4AllgemeinerTraeger);

        const anbringung = p.neuOderBestand === 'neupunkt' ? 'neu' : 'at';
        const kmWert = p.station != null ? p.station.toFixed(2).replace('.', ',') : '';
        const datum = new Date(p.erfassungsdatum);
        const datumStr = `${String(datum.getDate()).padStart(2,'0')}.${String(datum.getMonth()+1).padStart(2,'0')}.${datum.getFullYear()}`;

        const row = [
          dateiname, p.strecke, traeger, p.ps4MastNummer || '',
          _dn(Models.PS4GvBolzenLaenge, p.ps4GvBolzenLaenge),
          _dn(Models.Seite, p.seite), anbringung, '', kmWert, '', datumStr,
        ].join('\t');
        csv += row + '\n';
      }
    }
    return csv;
  }

  // ==================== GEOJSON ====================

  function _buildGeoJsonProperties(p, projektNummer, fotoPfade) {
    return {
      punktId: p.punktId,
      station: p.station,
      strecke: p.strecke,
      art: _dn(Models.PunktArt, p.art),
      seite: _dn(Models.Seite, p.seite),
      status: _dn(Models.PunktStatus, p.status),
      erfasser: p.erfasser,
      erfassungsdatum: p.erfassungsdatum,
      neuOderBestand: _dn(Models.PunktTyp, p.neuOderBestand),
      gnssTauglichkeit: _dn(Models.GnssTauglichkeit, p.gnssTauglichkeit),
      rilKonformitaet: _dn(Models.RilKonformitaet, p.rilKonformitaet),
      einmessskizze: _dn(Models.Einmessskizze, p.einmessskizze),
      bemerkungen: p.bemerkungen,
      projekt: projektNummer,
      fotos: fotoPfade,
      ps0Vermarkungsart: _dn(Models.PS0Vermarkungsart, p.ps0Vermarkungsart),
      ps0Vermarkungstraeger: _dn(Models.PS0Vermarkungstraeger, p.ps0Vermarkungstraeger),
      ps0AndereVermarkungsart: p.ps0AndereVermarkungsart,
      ps0AndereVermarkungstraeger: p.ps0AndereVermarkungstraeger,
      ps1Vermarkungstraeger: _dn(Models.PS1Vermarkungstraeger, p.ps1Vermarkungstraeger),
      ps1AndereVermarkungstraeger: p.ps1AndereVermarkungstraeger,
      ps2Vermarkungsart: _dn(Models.PS2Vermarkungsart, p.ps2Vermarkungsart),
      ps2Vermarkungstraeger: _dn(Models.PS2Vermarkungstraeger, p.ps2Vermarkungstraeger),
      ps2AndereVermarkungstraeger: p.ps2AndereVermarkungstraeger,
      ps3Vermarkungsart: _dn(Models.PS3Vermarkungsart, p.ps3Vermarkungsart),
      ps3Vermarkungstraeger: _dn(Models.PS3Vermarkungstraeger, p.ps3Vermarkungstraeger),
      ps3AndereVermarkungsart: p.ps3AndereVermarkungsart,
      ps3AndereVermarkungstraeger: p.ps3AndereVermarkungstraeger,
      ps4Vermarkungsart: _dn(Models.PS4Vermarkungsart, p.ps4Vermarkungsart),
      ps4GvBolzenTraeger: _dn(Models.PS4GvBolzenTraeger, p.ps4GvBolzenTraeger),
      ps4MessmarkeTraeger: _dn(Models.PS4MessmarkeTraeger, p.ps4MessmarkeTraeger),
      ps4AllgemeinerTraeger: _dn(Models.PS4AllgemeinerTraeger, p.ps4AllgemeinerTraeger),
      ps4GvBolzenLaenge: p.ps4GvBolzenLaenge,
      ps4HoeheUeberSo: p.ps4HoeheUeberSo,
      ps4TargetVorhanden: p.ps4TargetVorhanden,
      ps4TargetZustand: _dn(Models.TargetZustand, p.ps4TargetZustand),
      ps4TargetOffset: p.ps4TargetOffset,
      ps4MastNummer: p.ps4MastNummer,
      ps4AndereTraeger: p.ps4AndereTraeger,
      lhpTpVermarkungsart: _dn(Models.LhpTpVermarkungsart, p.lhpTpVermarkungsart),
      lhpTpVermarkungstraeger: _dn(Models.LhpTpVermarkungstraeger, p.lhpTpVermarkungstraeger),
      lhpTpAndereVermarkungsart: p.lhpTpAndereVermarkungsart,
      lhpTpAndereVermarkungstraeger: p.lhpTpAndereVermarkungstraeger,
      koordinaten: {
        latitude: p.gpsLatitude,
        longitude: p.gpsLongitude,
        hoehe: p.hoehe,
        dbref_x: p.dbrefX,
        dbref_y: p.dbrefY,
        gk_zone: p.gkZone,
        gps_accuracy: p.gpsAccuracy,
      },
    };
  }

  // ==================== ADD PHOTOS TO ZIP ====================

  /**
   * Adds photos to ZIP one at a time to avoid loading all into memory.
   */
  async function _addPhotosToZip(zip, points, folder = 'fotos') {
    let count = 0;
    for (const p of points) {
      for (const slot of _photoSlotsFor(p)) {
        const data = await DB.getPhotoAsArrayBuffer(p.punktId, slot);
        if (!data) continue;
        const ext = data.mimeType === 'image/png' ? '.png' : '.jpg';
        zip.file(`${folder}/${p.punktId}_foto${slot}${ext}`, data.buffer);
        count++;
      }
    }
    return count;
  }

  // ==================== EXPORT: UNIFIED ====================

  async function exportUnified(points, projektNummer) {
    const zip = new JSZip();

    const now = new Date();
    const ds = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;

    // QGIS CSV
    zip.file(`${ds}_SurvComp_Export_QGIS.csv`, _generateQgisCsv(points, projektNummer));
    // glsurvey CSV
    zip.file(`${ds}_SurvComp_Export_glsurvey.csv`, _generateGlSurveyCsv(points));
    // Photos (loaded one at a time)
    const photoCount = await _addPhotosToZip(zip, points);

    // Info
    const info = `SurvCompanion Export\n========================\nProjekt: ${projektNummer}\nExportiert am: ${now.toISOString()}\nAnzahl Punkte: ${points.length}\nAnzahl Fotos: ${photoCount}\n\nEnthaltene Dateien:\n- ${ds}_SurvComp_Export_QGIS.csv: Vollständige CSV (WGS84)\n- ${ds}_SurvComp_Export_glsurvey.csv: Reduzierte CSV (DB-Ref2016 GK)\n- fotos/: Ordner mit allen Fotos\n- export_info.txt: Diese Datei\n\nKoordinatensysteme:\n- QGIS-CSV: WGS84 (EPSG:4326)\n- glsurvey-CSV: DB-Ref2016 Gauß-Krüger\n`;
    zip.file('export_info.txt', info);

    return _buildZip(zip, `SurvComp_Export_${projektNummer}_${ds}.zip`);
  }

  // ==================== EXPORT: CSV WITH PHOTOS ====================

  async function exportCSVWithPhotos(points, projektNummer) {
    const zip = new JSZip();

    zip.file('vermessungspunkte.csv', _generateQgisCsv(points, projektNummer));
    const photoCount = await _addPhotosToZip(zip, points);

    const info = `CSV Export Information\n========================\nProjekt: ${projektNummer}\nExportiert am: ${new Date().toISOString()}\nAnzahl Punkte: ${points.length}\nAnzahl Fotos: ${photoCount}\n`;
    zip.file('export_info.txt', info);

    const ts = Date.now();
    return _buildZip(zip, `CSV_Export_${projektNummer}_${ts}.zip`);
  }

  // ==================== EXPORT: GEOJSON ====================

  async function exportGeoJSON(points, projektNummer) {
    const zip = new JSZip();

    for (const p of points) {
      const fotoPfade = _photoSlotsFor(p).map(
        slot => `_fotos/${p.punktId}_foto${slot}.jpg`
      );
      const coords = [p.gpsLongitude || 0, p.gpsLatitude || 0];
      if (p.hoehe != null) coords.push(p.hoehe);

      const geojson = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: _buildGeoJsonProperties(p, projektNummer, fotoPfade),
      };
      zip.file(`${p.punktId}.geojson`, JSON.stringify(geojson));
    }

    await _addPhotosToZip(zip, points, '_fotos');

    const summary = {
      export_info: {
        projekt: projektNummer,
        export_datum: new Date().toISOString(),
        anzahl_punkte: points.length,
        format: 'GeoJSON mit ZIP-Archiv',
      },
      dateien: points.map(p => `${p.punktId}.geojson`),
      punkte_uebersicht: points.map(p => ({
        punktId: p.punktId,
        art: _dn(Models.PunktArt, p.art),
        seite: _dn(Models.Seite, p.seite),
        status: _dn(Models.PunktStatus, p.status),
        strecke: p.strecke,
        station: p.station,
        koordinaten: [p.gpsLongitude, p.gpsLatitude],
      })),
    };
    zip.file('export_info.json', JSON.stringify(summary, null, 2));

    const ts = Date.now();
    return _buildZip(zip, `survcompanion_export_${projektNummer}_${ts}.zip`);
  }

  // ==================== EXPORT: DB-EXCEL ====================

  async function exportDbExcel(points, projektNummer) {
    const zip = new JSZip();

    zip.file('vermessungspunkte.csv', _generateDbExcelCsv(points));

    // Add photos one at a time
    for (const p of points) {
      for (const slot of _photoSlotsFor(p)) {
        const data = await DB.getPhotoAsArrayBuffer(p.punktId, slot);
        if (!data) continue;
        zip.file(`${p.punktId}_foto${slot}.jpg`, data.buffer);
      }
    }

    const ts = Date.now();
    return _buildZip(zip, `db_excel_export_${projektNummer}_${ts}.zip`);
  }

  // ==================== ZIP BUILD ====================

  /**
   * Builds the ZIP blob and returns { blob, filename } for the caller
   * to decide how to deliver (share vs download).
   * Uses STORE (no compression) to reduce memory usage on iOS Safari —
   * photos are already JPEG-compressed, so DEFLATE gains almost nothing.
   */
  async function _buildZip(zip, filename) {
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'STORE',
    });
    return { blob, filename };
  }

  // ==================== SHARE / DOWNLOAD ====================

  /**
   * Checks if the Web Share API can share files on this device.
   */
  function canNativeShare() {
    if (!navigator.share || !navigator.canShare) return false;
    try {
      const testFile = new File(['test'], 'test.zip', { type: 'application/zip' });
      return navigator.canShare({ files: [testFile] });
    } catch {
      return false;
    }
  }

  /**
   * Opens the native OS share dialog (like Android SharePlus / iOS Share Sheet).
   */
  async function shareFile(blob, filename) {
    const file = new File([blob], filename, { type: 'application/zip' });
    const shareData = { files: [file], title: 'SurvCompanion Export' };

    try {
      if (!navigator.canShare(shareData)) {
        throw new Error('Teilen von Dateien wird von diesem Browser nicht unterstützt');
      }
      await navigator.share(shareData);
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return true; // user cancelled — that's ok
      throw e;
    }
  }

  /**
   * Downloads a blob as a file.
   */
  function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 5000);
  }

  return {
    exportUnified, exportCSVWithPhotos, exportGeoJSON, exportDbExcel,
    canNativeShare, shareFile, downloadFile,
    dbRefGkToWgs84,
    coordToWgs84,
    IMPORT_CRS_OPTIONS,
  };
})();
