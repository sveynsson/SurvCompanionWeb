# SurvCompanion Web

Browser-basierte Vermessungspunkt-Erfassung – die Web-Variante der [SurvCompanion](https://github.com/sveynsson/survcompanion_app) Android-App, fokussiert auf die Punkterfassungsfunktion.

**Live:** [https://sveynsson.github.io/SurvCompanionWeb/](https://sveynsson.github.io/SurvCompanionWeb/)

## Funktionsumfang

### Projektstruktur
- Projekte anlegen und verwalten
- Punkte werden projektbezogen organisiert
- Vollständige CRUD-Operationen für Projekte und Punkte

### Punkterfassung
Alle Punktarten mit sämtlichen art-spezifischen Attributen:

| Art | Beschreibung |
|-----|-------------|
| PS0 | DB-Signalpunkte |
| PS1 | Höhenfestpunkte |
| PS2 | Aufrichtepunkte |
| PS3 | Horizontalpunkte |
| PS4 | Gleispunkte (GV-Bolzen, Messmarke, Attenberger, Kreuzanker, Ramm-Schiene, GV-Pfosten) |
| TP | Triangulationspunkte |
| LHP | Lagefestpunkte horizontal |

Erfasste Daten pro Punkt:
- Punkt-ID, Strecke, Station, Seite, GIC-Code
- Status (Intakt/Zerstört/Nicht gefunden), RIL-Konformität, GNSS-Tauglichkeit
- Neu-/Bestandspunkt, Punktbeschreibung
- Art-spezifische Vermarkungsart und -träger (inkl. PS4 Target-Attribute)
- GPS-Koordinaten (WGS84) mit Browser-Geolocation
- DB-Ref Gauß-Krüger Koordinaten (optional)
- Bis zu 5 Fotos
- Freitext-Bemerkungen

### Fotos
- Bis zu 5 Fotos pro Punkt
- Direktaufnahme über Smartphone-Kamera (`<input capture>`)
- Fotos werden als Blobs in IndexedDB gespeichert (nicht als Dateipfade)
- Atomare Speicherung: Punkt und Fotos in einer einzigen Transaktion
- `navigator.storage.persist()` verhindert Browser-Eviction

### Exportformate
Identisch zur Android-App:

| Format | Inhalt |
|--------|--------|
| **Einheitlicher Export** | QGIS-CSV (WGS84) + glsurvey-CSV (DB-Ref2016 GK) + Fotos als ZIP |
| **CSV mit Fotos** | Vollständige CSV mit allen Feldern + Fotos-Ordner |
| **GeoJSON** | Individuelle `.geojson`-Datei pro Punkt + Fotos |
| **DB-Excel** | Tab-getrennte CSV im DB-Excel Format + Fotos |

Koordinatentransformation WGS84 → DB-Ref2016 Gauß-Krüger (EPSG:5681–5685) über 7-Parameter Helmert-Transformation.

### Smartphone-Optimierung
- Mobile-first responsive Design
- Touch-optimierte Bedienelemente
- Bottom-Sheet Dialoge
- Safe-Area Support (Notch, Home-Indikator)
- PWA-fähig (Add to Homescreen)

## Technologie

Reine Client-Side Web-App ohne Build-Tooling:

- **HTML/CSS/JS** – kein Framework, kein Bundler
- **IndexedDB** – Offline-Datenspeicherung (Projekte, Punkte, Foto-Blobs)
- **[JSZip](https://stuk.github.io/jszip/)** – ZIP-Erstellung für Exporte
- **[proj4js](http://proj4js.org/)** – Koordinatentransformation
- **Web Share API** – Nativer Share-Dialog auf Mobilgeräten (Fallback: Download)
- **Geolocation API** – GPS-Erfassung

## Datensicherheit

Die Fotos sind das kritischste Asset. Folgende Maßnahmen schützen vor Datenverlust:

1. **Separater IndexedDB Object Store** für Fotos (nicht im Punkt-Record)
2. **Atomare Transaktionen** – Punkt + Fotos werden gemeinsam gespeichert oder gar nicht
3. **Persistent Storage** – Browser wird beim Start gebeten, die Daten nicht zu evicten
4. **Redundante Metadaten** – Jedes Foto speichert `punktId`, `projektNummer`, Zeitstempel
5. **Integritätsprüfung** – `DB.verifyIntegrity()` erkennt fehlende oder verwaiste Fotos

> **Empfehlung:** Regelmäßig exportieren, um eine zusätzliche Sicherungskopie außerhalb des Browsers zu haben.

## Lokale Entwicklung

Einfach einen lokalen Webserver starten:

```bash
# Python
python -m http.server 8000

# Node.js
npx serve .
```

Dann [http://localhost:8000](http://localhost:8000) öffnen.

## Deployment

Das Deployment auf GitHub Pages erfolgt automatisch bei jedem Push auf `main` via GitHub Actions.
