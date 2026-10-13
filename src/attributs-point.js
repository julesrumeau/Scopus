// Les attributs d'un point du LiDAR HD, pour la fenêtre « Détails du point » : un enregistrement de point LAS 1.4 (format 6,
// 30 octets, ou 46 avec les marqueurs MNT et MNS de l'IGN) devient un objet lisible, puis des lignes de tableau. Pur : aucun
// DOM, aucun réseau. Mesuré le 13 octobre 2026 sur trois dalles (Verdun, Ariège, Aude).
//
// Le **temps GPS** y est du temps GPS **ajusté** (standard moins 1 milliard de secondes) alors que le bit 0 de l'encodage global
// de l'en-tête est à 0 : on ne s'y fie pas. Règle sur la valeur : moins de 604 800 s, c'est un temps de semaine (sans numéro de
// semaine, pas de date) ; de là à 1 milliard, ajusté ; au-delà, déjà standard. Les trois dalles tombent sur les plages de vol
// publiées par l'IGN.

const ATTRIBUTS_POINT = (() => {
  const EPOQUE_GPS_MS = Date.UTC(1980, 0, 6);
  // Les secondes intercalaires insérées depuis 1980 (le temps GPS les ignore) : à 0 h UTC de ces dates, le 1er du mois.
  const INSERTIONS = [[1981, 6], [1982, 6], [1983, 6], [1985, 6], [1988, 0], [1990, 0], [1991, 0], [1992, 6], [1993, 6], [1994, 6],
    [1996, 0], [1997, 6], [1999, 0], [2006, 0], [2009, 0], [2012, 6], [2015, 6], [2017, 0]].map(([a, m]) => Date.UTC(a, m, 1));
  const DRAPEAUX = ['synthétique', 'point clé', 'retenu', 'chevauchement'];

  /** L'écart GPS moins UTC (secondes) à un instant exprimé en temps GPS « calendaire » (millisecondes). */
  function ecartGpsUtc(gpsMs) {
    let n = 0;
    INSERTIONS.forEach((u, i) => { if (gpsMs >= u + (i + 1) * 1000) n = i + 1; });
    return n;
  }

  /** `{ iso, ms }` en UTC pour un temps GPS stocké (voir l'en-tête), ou `null` si la valeur ne permet pas une date. */
  function tempsGpsVersUtc(valeur) {
    if (!Number.isFinite(valeur) || valeur < 604800) return null;
    const standard = valeur < 1e9 ? valeur + 1e9 : valeur;
    const gpsMs = EPOQUE_GPS_MS + standard * 1000;
    const ms = Math.round(gpsMs - ecartGpsUtc(gpsMs) * 1000);
    return { iso: new Date(ms).toISOString(), ms };
  }

  /** Un enregistrement de point (octets décompressés) en objet ; `entete` : `{ echelle, decalage }` du fichier. */
  function lirePoint(octets, entete) {
    const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
    const retourBits = v.getUint8(14), drapeauxBits = v.getUint8(15);
    const marq = octets.length >= 46;
    return {
      x: v.getInt32(0, true) * entete.echelle[0] + entete.decalage[0],
      y: v.getInt32(4, true) * entete.echelle[1] + entete.decalage[1],
      z: v.getInt32(8, true) * entete.echelle[2] + entete.decalage[2],
      intensite: v.getUint16(12, true),
      retour: retourBits & 15, nbRetours: retourBits >> 4,
      drapeaux: DRAPEAUX.filter((_, i) => drapeauxBits & (1 << i)),
      canal: (drapeauxBits >> 4) & 3,
      sensPositif: ((drapeauxBits >> 6) & 1) === 1,
      bord: (drapeauxBits >> 7) === 1,
      classe: v.getUint8(16),
      user: v.getUint8(17),
      angleDeg: v.getInt16(18, true) * 0.006,
      source: v.getUint16(20, true),
      gps: v.getFloat64(22, true),
      marqueurs: marq ? { mnt: v.getFloat64(30, true) > 0.5, mns: v.getFloat64(38, true) > 0.5 } : null,
    };
  }

  /** Un nombre à la française : virgule décimale, espace fine insécable entre les milliers, vrai signe moins. */
  function nombre(x, decimales) {
    const [entier, frac] = Math.abs(x).toFixed(decimales).split('.');
    const groupes = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${x < 0 ? '−' : ''}${groupes}${frac ? `,${frac}` : ''}`;
  }

  const oui = (b) => (b ? 'oui' : 'non');

  /** Les lignes du tableau : `{ groupe, libelle, valeur }`, rangées par groupes (pas de groupe vide). */
  function lignes(p, { nomsClasses = {} } = {}) {
    const date = tempsGpsVersUtc(p.gps);
    const L = [];
    const ajouter = (groupe, libelle, valeur) => L.push({ groupe, libelle, valeur });
    ajouter('Temps', 'Date et heure (UTC)',
      date ? `${date.iso.slice(0, 10)} ${date.iso.slice(11, 23).replace('.', ',')}` : 'n/d (temps de semaine : pas de numéro de semaine)');
    ajouter('Temps', 'Temps GPS brut', `${nombre(p.gps, 3)} s`);
    ajouter('Retour du laser', 'Intensité', String(p.intensite));
    ajouter('Retour du laser', 'Retour', `${p.retour} sur ${p.nbRetours}`);
    ajouter('Retour du laser', 'Angle de scan', `${nombre(p.angleDeg, 3)}°`);
    ajouter('Retour du laser', 'Sens de balayage', p.sensPositif ? 'de gauche à droite' : 'de droite à gauche');
    ajouter('Retour du laser', 'Bord de ligne de vol', oui(p.bord));
    ajouter('Retour du laser', 'Canal du scanner', String(p.canal));
    ajouter('Le vol', 'Ligne de vol', String(p.source));
    ajouter('Le vol', 'Valeur utilisateur', `${p.user} (valeur brute)`);
    ajouter('Classement', 'Classe', `${p.classe} : ${nomsClasses[p.classe] || 'classe inconnue'}`);
    ajouter('Classement', 'Drapeaux de classement', p.drapeaux.length ? p.drapeaux.join(', ') : 'aucun');
    if (p.marqueurs) {
      ajouter('Marqueurs IGN', 'Utilisé pour le MNT', oui(p.marqueurs.mnt));
      ajouter('Marqueurs IGN', 'Utilisé pour le MNS', oui(p.marqueurs.mns));
    }
    ajouter('Position', 'X', `${nombre(p.x, 2)} m`);
    ajouter('Position', 'Y', `${nombre(p.y, 2)} m`);
    ajouter('Position', 'Altitude Z', `${nombre(p.z, 2)} m`);
    return L;
  }

  return { tempsGpsVersUtc, lirePoint, lignes };
})();
