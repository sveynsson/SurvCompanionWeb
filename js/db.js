/**
 * IndexedDB Service for SurvCompanion Web
 *
 * Stores projects, points, and photos (as blobs) in IndexedDB.
 * Photos are stored separately in a dedicated object store with
 * redundant metadata to prevent data loss.
 */
const DB = (() => {
  const DB_NAME = 'SurvCompanionWeb';
  const DB_VERSION = 1;
  let _db = null;

  /**
   * Opens/creates the IndexedDB database.
   */
  async function open() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Projects store
        if (!db.objectStoreNames.contains('projects')) {
          const ps = db.createObjectStore('projects', { keyPath: 'projektNummer' });
          ps.createIndex('angelegt', 'angelegt');
        }

        // Points store
        if (!db.objectStoreNames.contains('points')) {
          const pts = db.createObjectStore('points', { keyPath: 'punktId' });
          pts.createIndex('projektNummer', 'projektNummer');
          pts.createIndex('art', 'art');
          pts.createIndex('erfassungsdatum', 'erfassungsdatum');
        }

        // Photos store — separate store for blob safety
        // key: "{punktId}_{slot}" e.g. "PS12345_1"
        if (!db.objectStoreNames.contains('photos')) {
          const phs = db.createObjectStore('photos', { keyPath: 'id' });
          phs.createIndex('punktId', 'punktId');
          phs.createIndex('projektNummer', 'projektNummer');
        }
      };

      req.onsuccess = (e) => {
        _db = e.target.result;
        resolve(_db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Generic transaction helper.
   */
  function tx(storeNames, mode = 'readonly') {
    if (!_db) throw new Error('DB not initialized');
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = _db.transaction(names, mode);
    return transaction;
  }

  /**
   * Wraps an IDBRequest in a promise.
   */
  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Wraps a transaction completion in a promise.
   */
  function txComplete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    });
  }

  // ==================== PROJECTS ====================

  async function getAllProjects() {
    await open();
    const t = tx('projects');
    const store = t.objectStore('projects');
    return promisify(store.getAll());
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

  async function deleteProject(projektNummer) {
    await open();
    // Delete all photos for this project
    const photos = await getPhotosByProject(projektNummer);
    // Delete all points for this project
    const points = await getPointsByProject(projektNummer);

    const t = tx(['projects', 'points', 'photos'], 'readwrite');
    t.objectStore('projects').delete(projektNummer);
    for (const p of points) {
      t.objectStore('points').delete(p.punktId);
    }
    for (const ph of photos) {
      t.objectStore('photos').delete(ph.id);
    }
    return txComplete(t);
  }

  // ==================== POINTS ====================

  async function getPointsByProject(projektNummer) {
    await open();
    const t = tx('points');
    const idx = t.objectStore('points').index('projektNummer');
    return promisify(idx.getAll(projektNummer));
  }

  async function getPoint(punktId) {
    await open();
    return promisify(tx('points').objectStore('points').get(punktId));
  }

  /**
   * Saves a point AND its photos atomically in a single transaction.
   * This ensures photos are never orphaned or lost.
   *
   * @param {Object} pointData - The point data (without blob photo fields)
   * @param {Object} photoBlobs - Map of slot number to {blob, mimeType, fileName}
   */
  async function savePointWithPhotos(pointData, photoBlobs = {}) {
    await open();
    const t = tx(['points', 'photos'], 'readwrite');
    const pointStore = t.objectStore('points');
    const photoStore = t.objectStore('photos');

    // Save point data
    pointStore.put(pointData);

    // Save each photo blob
    for (const [slot, photoData] of Object.entries(photoBlobs)) {
      if (!photoData || !photoData.blob) continue;
      const photoRecord = {
        id: `${pointData.punktId}_${slot}`,
        punktId: pointData.punktId,
        projektNummer: pointData.projektNummer,
        slot: parseInt(slot),
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

  async function deletePoint(punktId) {
    await open();
    const t = tx(['points', 'photos'], 'readwrite');
    t.objectStore('points').delete(punktId);

    // Delete all photos for this point
    const photoIdx = t.objectStore('photos').index('punktId');
    const photos = await promisify(photoIdx.getAll(punktId));
    for (const ph of photos) {
      t.objectStore('photos').delete(ph.id);
    }

    return txComplete(t);
  }

  // ==================== PHOTOS ====================

  async function getPhoto(punktId, slot) {
    await open();
    const id = `${punktId}_${slot}`;
    return promisify(tx('photos').objectStore('photos').get(id));
  }

  async function getPhotosByPoint(punktId) {
    await open();
    const t = tx('photos');
    const idx = t.objectStore('photos').index('punktId');
    return promisify(idx.getAll(punktId));
  }

  async function getPhotosByProject(projektNummer) {
    await open();
    const t = tx('photos');
    const idx = t.objectStore('photos').index('projektNummer');
    return promisify(idx.getAll(projektNummer));
  }

  async function deletePhoto(punktId, slot) {
    await open();
    const id = `${punktId}_${slot}`;
    const t = tx('photos', 'readwrite');
    t.objectStore('photos').delete(id);
    return txComplete(t);
  }

  /**
   * Reads a photo blob as an ArrayBuffer (for export).
   */
  async function getPhotoAsArrayBuffer(punktId, slot) {
    const photo = await getPhoto(punktId, slot);
    if (!photo || !photo.blob) return null;
    return {
      buffer: await photo.blob.arrayBuffer(),
      mimeType: photo.mimeType,
      fileName: photo.fileName,
    };
  }

  /**
   * Creates an object URL for a photo blob (for display).
   * Caller must revoke the URL when done.
   */
  async function getPhotoURL(punktId, slot) {
    const photo = await getPhoto(punktId, slot);
    if (!photo || !photo.blob) return null;
    return URL.createObjectURL(photo.blob);
  }

  // ==================== STORAGE INFO ====================

  /**
   * Estimates storage usage.
   */
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

  /**
   * Requests persistent storage to prevent browser from evicting data.
   */
  async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      return granted;
    }
    return false;
  }

  // ==================== DATA INTEGRITY ====================

  /**
   * Verifies that all photo references in points have corresponding blobs.
   * Returns a report of any orphaned or missing photos.
   */
  async function verifyIntegrity() {
    await open();
    const points = await promisify(tx('points').objectStore('points').getAll());
    const photos = await promisify(tx('photos').objectStore('photos').getAll());

    const photoIds = new Set(photos.map(p => p.id));
    const missing = [];
    const orphaned = [];

    for (const point of points) {
      for (let slot = 1; slot <= 5; slot++) {
        const hasRef = point[`foto${slot}`];
        const hasBlob = photoIds.has(`${point.punktId}_${slot}`);
        if (hasRef && !hasBlob) {
          missing.push({ punktId: point.punktId, slot });
        }
      }
    }

    const pointIds = new Set(points.map(p => p.punktId));
    for (const photo of photos) {
      if (!pointIds.has(photo.punktId)) {
        orphaned.push(photo.id);
      }
    }

    return { missing, orphaned, totalPoints: points.length, totalPhotos: photos.length };
  }

  return {
    open,
    getAllProjects, getProject, saveProject, deleteProject,
    getPointsByProject, getPoint, savePointWithPhotos, deletePoint,
    getPhoto, getPhotosByPoint, getPhotosByProject, deletePhoto,
    getPhotoAsArrayBuffer, getPhotoURL,
    getStorageEstimate, requestPersistentStorage, verifyIntegrity,
  };
})();
