/**
 * Data models and enum definitions matching the Flutter VermessungsPunkt model.
 */
const Models = (() => {

  // ==================== ENUM DEFINITIONS ====================

  const PunktArt = {
    ps0: { name: 'ps0', displayName: 'PS0' },
    ps1: { name: 'ps1', displayName: 'PS1' },
    ps2: { name: 'ps2', displayName: 'PS2' },
    ps3: { name: 'ps3', displayName: 'PS3' },
    ps4: { name: 'ps4', displayName: 'PS4' },
    tp:  { name: 'tp',  displayName: 'TP' },
    lhp: { name: 'lhp', displayName: 'LHP' },
  };

  const Seite = {
    links:  { name: 'links',  displayName: 'Links' },
    rechts: { name: 'rechts', displayName: 'Rechts' },
    mittig: { name: 'mittig', displayName: 'Mittig' },
  };

  const PunktStatus = {
    intakt:        { name: 'intakt',        displayName: 'Intakt' },
    zerstoert:     { name: 'zerstoert',     displayName: 'Zerstört' },
    nichtGefunden: { name: 'nichtGefunden', displayName: 'Nicht gefunden' },
  };

  const PunktTyp = {
    neupunkt:      { name: 'neupunkt',      displayName: 'Neupunkt' },
    bestandspunkt: { name: 'bestandspunkt', displayName: 'Bestandspunkt' },
  };

  const RilKonformitaet = {
    ja:   { name: 'ja',   displayName: 'Ja' },
    nein: { name: 'nein', displayName: 'Nein' },
  };

  const GnssTauglichkeit = {
    ja:              { name: 'ja',              displayName: 'Ja' },
    nein:            { name: 'nein',            displayName: 'Nein' },
    eingeschraenkt:  { name: 'eingeschraenkt',  displayName: 'Eingeschränkt' },
  };

  const Einmessskizze = {
    vorhanden:      { name: 'vorhanden',      displayName: 'Punktbeschreibung vorhanden' },
    nichtVorhanden: { name: 'nichtVorhanden', displayName: 'Keine Punktbeschreibung' },
    neuErstellt:    { name: 'neuErstellt',    displayName: 'Punktbeschreibung neu erstellt' },
  };

  // PS0
  const PS0Vermarkungsart = {
    dbAluMitId: { name: 'dbAluMitId', displayName: 'DB-Alu mit ID' },
    andere:     { name: 'andere',     displayName: 'Andere' },
  };
  const PS0Vermarkungstraeger = {
    bauwerk: { name: 'bauwerk', displayName: 'Bauwerk' },
    beton:   { name: 'beton',   displayName: 'Beton' },
    andere:  { name: 'andere',  displayName: 'Andere' },
  };

  // PS1
  const PS1Vermarkungstraeger = {
    bauwerk: { name: 'bauwerk', displayName: 'Bauwerk' },
    beton:   { name: 'beton',   displayName: 'Beton' },
    andere:  { name: 'andere',  displayName: 'Andere' },
  };

  // PS2
  const PS2Vermarkungsart = {
    messmarke:                { name: 'messmarke',                displayName: 'Messmarke' },
    nagel:                    { name: 'nagel',                    displayName: 'Nagel' },
    kreuzankerMitGelberKappe: { name: 'kreuzankerMitGelberKappe', displayName: 'Kreuzanker mit gelber Kappe' },
    attenberger:              { name: 'attenberger',              displayName: 'Attenberger' },
  };
  const PS2Vermarkungstraeger = {
    bauwerk: { name: 'bauwerk', displayName: 'Bauwerk' },
    beton:   { name: 'beton',   displayName: 'Beton' },
    boden:   { name: 'boden',   displayName: 'Boden' },
    andere:  { name: 'andere',  displayName: 'Andere' },
  };

  // PS3
  const PS3Vermarkungsart = {
    stehbolzen:   { name: 'stehbolzen',   displayName: 'Stehbolzen' },
    mauerbolzen:  { name: 'mauerbolzen',  displayName: 'Mauerbolzen' },
    andere:       { name: 'andere',       displayName: 'Andere' },
  };
  const PS3Vermarkungstraeger = {
    bauwerk: { name: 'bauwerk', displayName: 'Bauwerk' },
    beton:   { name: 'beton',   displayName: 'Beton' },
    andere:  { name: 'andere',  displayName: 'Andere' },
  };

  // PS4
  const PS4Vermarkungsart = {
    gvBolzen:                 { name: 'gvBolzen',                 displayName: 'GV-Bolzen' },
    messmarke:                { name: 'messmarke',                displayName: 'Messmarke' },
    attenberger:              { name: 'attenberger',              displayName: 'Attenberger' },
    kreuzankerMitGelberKappe: { name: 'kreuzankerMitGelberKappe', displayName: 'Kreuzanker mit gelber Kappe' },
    rammschiene:              { name: 'rammschiene',              displayName: 'Ramm-Schiene' },
    gvPfostenGelb:            { name: 'gvPfostenGelb',            displayName: 'GV-Pfosten (gelb)' },
  };
  const PS4GvBolzenTraeger = {
    mast:    { name: 'mast',    displayName: 'Mast' },
    laterne: { name: 'laterne', displayName: 'Laterne' },
    mauer:   { name: 'mauer',   displayName: 'Mauer' },
    andere:  { name: 'andere',  displayName: 'Andere' },
  };
  const PS4MessmarkeTraeger = {
    bahnsteig: { name: 'bahnsteig', displayName: 'Bahnsteig' },
    bauwerk:   { name: 'bauwerk',   displayName: 'Bauwerk' },
    andere:    { name: 'andere',    displayName: 'Andere' },
  };
  const PS4AllgemeinerTraeger = {
    bauwerk: { name: 'bauwerk', displayName: 'Bauwerk' },
    beton:   { name: 'beton',   displayName: 'Beton' },
    boden:   { name: 'boden',   displayName: 'Boden' },
    andere:  { name: 'andere',  displayName: 'Andere' },
  };
  const PS4RammschieneTraeger = {
    gelbkappe: { name: 'gelbkappe', displayName: 'Gelbe Kappe' },
    gvBolzen:  { name: 'gvBolzen',  displayName: 'GV-Bolzen' },
  };
  const PS4GvBolzenLaenge = {
    mm30: { name: 'mm30', displayName: '30mm' },
    mm40: { name: 'mm40', displayName: '40mm' },
  };
  const TargetZustand = {
    intakt:              { name: 'intakt',              displayName: 'Intakt' },
    zerstoert:           { name: 'zerstoert',           displayName: 'Zerstört' },
    teilweiseZerstoert:  { name: 'teilweiseZerstoert',  displayName: 'Teilweise zerstört' },
  };

  // LHP/TP
  const LhpTpVermarkungsart = {
    stein:    { name: 'stein',    displayName: 'Stein' },
    messmarke:{ name: 'messmarke', displayName: 'Messmarke' },
    andere:   { name: 'andere',   displayName: 'Andere' },
  };
  const LhpTpVermarkungstraeger = {
    bauwerk: { name: 'bauwerk', displayName: 'Bauwerk' },
    beton:   { name: 'beton',   displayName: 'Beton' },
    boden:   { name: 'boden',   displayName: 'Boden' },
    andere:  { name: 'andere',  displayName: 'Andere' },
  };

  /**
   * Helper to get displayName from an enum by name.
   */
  function displayName(enumObj, name) {
    if (!name || !enumObj) return '';
    const entry = enumObj[name];
    return entry ? entry.displayName : name;
  }

  /**
   * Generates option HTML for a select from an enum object.
   */
  function enumOptions(enumObj, selectedName, includeEmpty = false) {
    let html = '';
    if (includeEmpty) html += '<option value="">-- k.A. --</option>';
    for (const [key, val] of Object.entries(enumObj)) {
      const sel = key === selectedName ? ' selected' : '';
      html += `<option value="${key}"${sel}>${val.displayName}</option>`;
    }
    return html;
  }

  /**
   * Art types that support GNSS tauglichkeit.
   */
  const ImportStatus = {
    offen:    { name: 'offen',    displayName: 'Offen' },
    erledigt: { name: 'erledigt', displayName: 'Erledigt' },
  };

  const GNSS_ARTS = ['ps0', 'ps1', 'ps2', 'tp', 'lhp'];

  /**
   * GIC Code ↔ Art mapping (range 100–157).
   */
  const GIC_TO_ART = {
    100: 'ps0', 110: 'ps1', 120: 'ps2', 130: 'ps3',
    140: 'ps4', 141: 'ps4', 142: 'ps4', 143: 'ps4',
    144: 'ps4', 145: 'ps4', 146: 'ps4', 147: 'ps4',
    150: 'tp', 151: 'tp', 155: 'lhp', 156: 'lhp', 157: 'lhp',
  };

  return {
    PunktArt, Seite, PunktStatus, PunktTyp, RilKonformitaet,
    GnssTauglichkeit, Einmessskizze,
    PS0Vermarkungsart, PS0Vermarkungstraeger,
    PS1Vermarkungstraeger,
    PS2Vermarkungsart, PS2Vermarkungstraeger,
    PS3Vermarkungsart, PS3Vermarkungstraeger,
    PS4Vermarkungsart, PS4GvBolzenTraeger, PS4MessmarkeTraeger,
    PS4AllgemeinerTraeger, PS4RammschieneTraeger, PS4GvBolzenLaenge, TargetZustand,
    LhpTpVermarkungsart, LhpTpVermarkungstraeger,
    ImportStatus,
    displayName, enumOptions, GNSS_ARTS, GIC_TO_ART,
  };
})();
