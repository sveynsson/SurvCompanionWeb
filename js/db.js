/**
 * IndexedDB Service for SurvCompanion Web
 *
 * Stores projects, points, and photos (as blobs) in IndexedDB.
 * Photos are stored separately in a dedicated object store with
 * redundant metadata to prevent data loss.
 *
 * v2 schema (2026-04-21):
 *   - points keyPath: [projektNummer, punktId]
 *   - photos keyPath: [projektNummer, punktId, slot]
 *   Punkt-IDs sind ab v2 nur noch innerhalb eines Projekts eindeutig.
 */
const DB = (() => {
  const DB_NAME = 'SurvCompanionWeb';
  const DB_VERSION = 2;
  let _db = null;

  function _createPointsStore(db) {
    const pts = db.createObjectStore('points', { keyPath: ['projektNummer', 'punktId'] });
    pts.createIndex('projektNummer', 'projektNummer');
    pts.createIndex('art', 'art');
    pts.createIndex('erfassungsdatum', 'erfassungsdatum');
    return pts;
  }

  function _createPhotosStore(db) {
    const phs = db.createObjectStore('photos', { keyPath: ['projektNummer', 'punktId', 'slot'] });
    phs.createIndex('projektNummer', 'projektNummer');
    phs.createIndex('projPunkt', ['projektNummer', 'punktId']);
    return phs;
  }

  /**
   * Reads all rows from v1 points/photos stores, drops them, recreates with
   * composite keyPath, writes rows back. Orphaned photos (missing projektNummer
   * or punktId) are skipped. All operations run inside the versionchange
   * transaction — IDB keeps the transaction alive while cursor/put requests
   * are pending.
   */
  function _migrateV1ToV2(db, tx) {
    const hasPoints = db.objectStoreNames.contains('points');
    const hasPhotos = db.objectStoreNames.contains('photos');
    const oldPoints = [];
    const oldPhotos = [];

    let pointsRead = !hasPoints;
    let photosRead = !hasPhotos;
    let done = false;

    function finish() {
      if (done) return;
      if (!(pointsRead && photosRead)) return;
      done = true;

      if (hasPoints) db.deleteObjectStore('points');
      if (hasPhotos) db.deleteObjectStore('photos');
      _createPointsStore(db);
      _createPhotosStore(db);

      const newPoints = tx.objectStore('points');
      const newPhotos = tx.objectStore('photos');

      let migratedPoints = 0;
      let migratedPhotos = 0;
      let skippedPoints = 0;
      let skippedPhotos = 0;

      for (const p of oldPoints) {
        if (!p.projektNummer || !p.punktId) { skippedPoints++; continue; }
        newPoints.put(p);
        migratedPoints++;
      }
      for (const ph of oldPhotos) {
        if (!ph.projektNummer || !ph.punktId || ph.slot == null) { skippedPhotos++; continue; }
        const rec = Object.assign({}, ph, { slot: Number(ph.slot) });
        delete rec.id;
        newPhotos.put(rec);
        migratedPhotos++;
      }
      console.info(`[DB] v1->v2 migration: points ${migratedPoints} migrated, ${skippedPoints} skipped; photos ${migratedPhotos} migrated, ${skippedPhotos} skipped`);
    }

    if (hasPoints) {
      const req = tx.objectStore('points').openCursor();
      req.onsuccess = (ev) => {
        const cur = ev.target.result;
        if (cur) { oldPoints.push(cur.value); cur.continue(); }
        else { pointsRead = true; finish(); }
      };
      req.onerror = () => { pointsRead = true; finish(); };
    }
    if (hasPhotos) {
      const req = tx.objectStore('photos').openCursor();
      req.onsuccess = (ev) => {
        const cur = ev.target.result;
        if (cur) { oldPhotos.push(cur.value); cur.continue(); }
        else { photosRead = true; finish(); }
      };
      req.onerror = () => { photosRead = true; finish(); };
    }
    // Edge case: neither store existed (shouldn't happen on upgrade, but safe)
    if (!hasPoints && !hasPhotos) finish();
  }

  /**
   * Opens/creates the IndexedDB database.
   */
  async function open() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;
        const oldVersion = e.oldVersion || 0;

        if (oldVersion < 1) {
          const ps = db.createObjectStore('projects', { keyPath: 'projektNummer' });
          ps.createIndex('angelegt', 'angelegt');
        }

        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('points') && !db.objectStoreNames.contains('photos')) {
            // Fresh install (or projects-only DB) — create directly
            _createPointsStore(db);
            _createPhotosStore(db);
          } else {
            _migrateV1ToV2(db, tx);
          }
        }
      };

      req.onsuccess = (e) => {
        _db = e.target.result;
        _db.onclose = () => {
          console.warn('IndexedDB connection closed unexpectedly, will reconnect on next operation');
          _db = null;
        };
        _db.onerror = (ev) => {
          console.error('IndexedDB error:', ev.target.error);
        };
        resolve(_db);
      };
      req.onerror = (e) => reject(e.target.error);
      req.onblocked = () => {
        console.warn('IndexedDB open blocked — close other tabs using this app');
      };
    });
  }

  function tx(storeNames, mode = 'readonly') {
    if (!_db) throw new Error('DB not initialized — call open() first');
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    try {
      return _db.transaction(names, mode);
    } catch (e) {
      if (e.name === 'InvalidStateError') {
        _db = null;
        throw new Error('Datenbankverbindung verloren. Bitte Aktion wiederholen.');
      }
      throw e;
    }
  }

  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function txComplete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => {
        const err = transaction.error || e.target?.error;
        if (err?.name === 'QuotaExceededError') {
          reject(new Error('Speicher voll! Bitte exportieren und alte Punkte löschen.'));
        } else {
          reject(err || new Error('Transaction error'));
        }
      };
      transaction.onabort = (e) => {
        const err = transaction.error || e.target?.error;
        if (err?.name === 'QuotaExceededError') {
          reject(new Error('Speicher voll! Bitte exportieren und alte Punkte löschen.'));
        } else {
          reject(err || new Error('Transaction aborted'));
        }
      };
    });
  }

  // ==================== PROJECTS ====================

  async function getAllProjects({ includeDeleted = false } = {}) {
    await open();
    const t = tx('projects');
    const all = await promisify(t.objectStore('projects').getAll());
    return includeDeleted ? all : all.filter(p => !p.deletedAt);
  }

  async function getDeletedProjects() {
    await open();
    const t = tx('projects');
    const all = await promisify(t.objectStore('projects').getAll());
    return all.filter(p => p.deletedAt);
  }

  async function getProject(projektNummer) {
    await open();
    const t = tx('projects');
    return promisify(t.objectStore('projects').get(projektNummer));
  }

  async function saveProject(project) {
    await open();
    const t = tx('projects', 'readwrite');
    t.objectStore('projects').put(project);
    return txComplete(t);
  }

  async function softDeleteProject(projektNummer) {
    await open();
    const t = tx('projects', 'readwrite');
    const store = t.objectStore('projects');
    const proj = await promisify(store.get(projektNummer));
    if (!proj) throw new Error('Projekt nicht gefunden');
    proj.deletedAt = new Date().toISOString();
    store.put(proj);
    return txComplete(t);
  }

  async function restoreProject(projektNummer) {
    await open();
    const t = tx('projects', 'readwrite');
    const store = t.objectStore('projects');
    const proj = await promisify(store.get(projektNummer));
    if (!proj) throw new Error('Projekt nicht gefunden');
    delete proj.deletedAt;
    store.put(proj);
    return txComplete(t);
  }

  async function hardDeleteProject(projektNummer) {
    await open();
    const photos = await getPhotosByProject(projektNummer);
    const points = await getPointsByProject(projektNummer);

    const t = tx(['projects', 'points', 'photos'], 'readwrite');
    t.objectStore('projects').delete(projektNummer);
    for (const p of points) {
      t.objectStore('points').delete([p.projektNummer, p.punktId]);
    }
    for (const ph of photos) {
      t.objectStore('photos').delete([ph.projektNummer, ph.punktId, ph.slot]);
    }
    return txComplete(t);
  }

  async function purgeExpiredDeleted(maxAgeMs) {
    const deleted = await getDeletedProjects();
    const now = Date.now();
    const purged = [];
    for (const p of deleted) {
      const ts = new Date(p.deletedAt).getTime();
      if (Number.isFinite(ts) && now - ts >= maxAgeMs) {
        await hardDeleteProject(p.projektNummer);
        purged.push(p.projektNummer);
      }
    }
    return purged;
  }

  // ==================== POINTS ====================

  async function getPointsByProject(projektNummer) {
    await open();
    const t = tx('points');
    const idx = t.objectStore('points').index('projektNummer');
    return promisify(idx.getAll(projektNummer));
  }

  async function getPoint(projektNummer, punktId) {
    await open();
    return promisify(tx('points').objectStore('points').get([projektNummer, punktId]));
  }

  /**
   * Saves a point AND its photos atomically in a single transaction.
   * This ensures photos are never orphaned or lost.
   */
  async function savePointWithPhotos(pointData, photoBlobs = {}) {
    await open();
    if (!pointData.projektNummer || !pointData.punktId) {
      throw new Error('Point requires projektNummer and punktId');
    }
    const t = tx(['points', 'photos'], 'readwrite');
    const pointStore = t.objectStore('points');
    const photoStore = t.objectStore('photos');

    pointStore.put(pointData);

    for (const [slot, photoData] of Object.entries(photoBlobs)) {
      if (!photoData || !photoData.blob) continue;
      const slotNum = parseInt(slot);
      const photoRecord = {
        projektNummer: pointData.projektNummer,
        punktId: pointData.punktId,
        slot: slotNum,
        blob: photoData.blob,
        mimeType: photoData.mimeType || 'image/jpeg',
        fileName: photoData.fileName || `foto_${slot}.jpg`,
        size: photoData.blob.size,
        savedAt: new Date().toISOString(),
      };
      photoStore.put(photoRecord);
    }

    return txComplete(t);
  }

  async function deletePoint(projektNummer, punktId) {
    await open();
    const t = tx(['points', 'photos'], 'readwrite');
    t.objectStore('points').delete([projektNummer, punktId]);

    const photoIdx = t.objectStore('photos').index('projPunkt');
    const photos = await promisify(photoIdx.getAll([projektNummer, punktId]));
    for (const ph of photos) {
      t.objectStore('photos').delete([ph.projektNummer, ph.punktId, ph.slot]);
    }

    return txComplete(t);
  }

  // ==================== PHOTOS ====================

  async function getPhoto(projektNummer, punktId, slot) {
    await open();
    return promisify(tx('photos').objectStore('photos').get([projektNummer, punktId, Number(slot)]));
  }

  async function getPhotosByPoint(projektNummer, punktId) {
    await open();
    const t = tx('photos');
    const idx = t.objectStore('photos').index('projPunkt');
    return promisify(idx.getAll([projektNummer, punktId]));
  }

  async function getPhotosByProject(projektNummer) {
    await open();
    const t = tx('photos');
    const idx = t.objectStore('photos').index('projektNummer');
    return promisify(idx.getAll(projektNummer));
  }

  async function deletePhoto(projektNummer, punktId, slot) {
    await open();
    const t = tx('photos', 'readwrite');
    t.objectStore('photos').delete([projektNummer, punktId, Number(slot)]);
    return txComplete(t);
  }

  async function getPhotoAsArrayBuffer(projektNummer, punktId, slot) {
    const photo = await getPhoto(projektNummer, punktId, slot);
    if (!photo || !photo.blob) return null;
    return {
      buffer: await photo.blob.arrayBuffer(),
      mimeType: photo.mimeType,
      fileName: photo.fileName,
    };
  }

  async function getPhotoURL(projektNummer, punktId, slot) {
    const photo = await getPhoto(projektNummer, punktId, slot);
    if (!photo || !photo.blob) return null;
    return URL.createObjectURL(photo.blob);
  }

  // ==================== STORAGE INFO ====================

  async function getStorageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      return {
        usage: est.usage || 0,
        quota: est.quota || 0,
        usageMB: ((est.usage || 0) / (1024 * 1024)).toFixed(1),
        quotaMB: ((est.quota || 0) / (1024 * 1024)).toFixed(0),
        percentUsed: est.quota ? ((est.usage / est.quota) * 100).toFixed(1) : 0,
      };
    }
    return { usage: 0, quota: 0, usageMB: '?', quotaMB: '?', percentUsed: 0 };
  }

  async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      return granted;
    }
    return false;
  }

  // ==================== DATA INTEGRITY ====================

  function _photoKey(projektNummer, punktId, slot) {
    return `${projektNummer}\u001f${punktId}\u001f${slot}`;
  }

  async function verifyIntegrity() {
    await open();
    const points = await promisify(tx('points').objectStore('points').getAll());
    const photos = await promisify(tx('photos').objectStore('photos').getAll());

    const photoKeys = new Set(photos.map(p => _photoKey(p.projektNummer, p.punktId, p.slot)));
    const missing = [];
    const orphaned = [];

    for (const point of points) {
      for (let slot = 1; slot <= 5; slot++) {
        const hasRef = point[`foto${slot}`];
        const hasBlob = photoKeys.has(_photoKey(point.projektNummer, point.punktId, slot));
        if (hasRef && !hasBlob) {
          missing.push({ projektNummer: point.projektNummer, punktId: point.punktId, slot });
        }
      }
    }

    const pointKeys = new Set(points.map(p => `${p.projektNummer}\u001f${p.punktId}`));
    for (const photo of photos) {
      if (!pointKeys.has(`${photo.projektNummer}\u001f${photo.punktId}`)) {
        orphaned.push({ projektNummer: photo.projektNummer, punktId: photo.punktId, slot: photo.slot });
      }
    }

    return { missing, orphaned, totalPoints: points.length, totalPhotos: photos.length };
  }

  return {
    open,
    getAllProjects, getDeletedProjects, getProject, saveProject,
    softDeleteProject, restoreProject, hardDeleteProject, purgeExpiredDeleted,
    getPointsByProject, getPoint, savePointWithPhotos, deletePoint,
    getPhoto, getPhotosByPoint, getPhotosByProject, deletePhoto,
    getPhotoAsArrayBuffer, getPhotoURL,
    getStorageEstimate, requestPersistentStorage, verifyIntegrity,
  };
})();
