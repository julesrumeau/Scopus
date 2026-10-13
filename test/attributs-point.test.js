// Les attributs d'un point du LiDAR HD : temps GPS converti en date UTC, champs d'un enregistrement de point (LAS 1.4,
// format 6, 30 octets, ou 46 avec les marqueurs MNT et MNS de l'IGN), lignes du tableau de la fenêtre « Détails du point ».
// Les valeurs de référence sont celles de vrais blocs (Verdun, Ariège, Aude), décodés le 13 octobre 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { ATTRIBUTS_POINT: A } = chargerScripts(['attributs-point.js']);

/** Un enregistrement de point, octet par octet : format 6, 30 octets (46 avec `marqueurs`). */
function enregistrement(c) {
  const longueur = c.marqueurs ? 46 : 30;
  const o = new Uint8Array(longueur);
  const v = new DataView(o.buffer);
  v.setInt32(0, c.xe ?? 0, true); v.setInt32(4, c.ye ?? 0, true); v.setInt32(8, c.ze ?? 0, true);
  v.setUint16(12, c.intensite ?? 0, true);
  v.setUint8(14, ((c.sur ?? 1) << 4) | (c.retour ?? 1));
  v.setUint8(15, ((c.bord ?? 0) << 7) | ((c.sens ?? 0) << 6) | ((c.canal ?? 0) << 4) | (c.drapeaux ?? 0));
  v.setUint8(16, c.classe ?? 1); v.setUint8(17, c.user ?? 0);
  v.setInt16(18, c.angle ?? 0, true); v.setUint16(20, c.source ?? 0, true);
  v.setFloat64(22, c.gps ?? 0, true);
  if (c.marqueurs) { v.setFloat64(30, c.marqueurs[0], true); v.setFloat64(38, c.marqueurs[1], true); }
  return o;
}

test('temps GPS : les valeurs de trois vraies dalles tombent dans les plages de vol publiées par l’IGN', () => {
  assert.equal(A.tempsGpsVersUtc(422453057.89562845).iso, '2025-02-01T13:50:39.896Z');   // Verdun, vol du 1er février 2025
  assert.equal(A.tempsGpsVersUtc(341666442.63221306).iso, '2022-07-12T13:07:04.632Z');   // Ariège, vol du 12 au 13 juillet 2022
  assert.equal(A.tempsGpsVersUtc(309509643.289).iso, '2021-07-05T08:40:25.289Z');        // Aude, vol du 5 juillet 2021
});

test('temps GPS : les secondes intercalaires suivent la date (17 s avant le 1er janvier 2017, 18 s après)', () => {
  // Le 1er janvier 2017 à 0 h UTC vaut 1 167 264 018 s de temps GPS ; on y stocke la valeur moins un milliard.
  assert.equal(A.tempsGpsVersUtc(1167264018 - 1e9).iso, '2017-01-01T00:00:00.000Z');
  assert.equal(A.tempsGpsVersUtc(1167264030 - 1e9).iso, '2017-01-01T00:00:12.000Z');
  assert.equal(A.tempsGpsVersUtc(1167264000 - 1e9).iso, '2016-12-31T23:59:43.000Z');
});

test('temps GPS : un temps de semaine ou une valeur absurde ne donne pas de date inventée', () => {
  assert.equal(A.tempsGpsVersUtc(300000.5), null, 'temps de semaine (0 à 604 800 s) : pas de numéro de semaine, pas de date');
  assert.equal(A.tempsGpsVersUtc(0), null);
  assert.equal(A.tempsGpsVersUtc(NaN), null);
  assert.equal(A.tempsGpsVersUtc(undefined), null);
});

test('temps GPS : une valeur déjà standard (au moins un milliard) n’est pas décalée une seconde fois', () => {
  assert.equal(A.tempsGpsVersUtc(1422453057.89562845).iso, '2025-02-01T13:50:39.896Z');
});

test('lirePoint : les champs d’un point de format 6, un par un', () => {
  const o = enregistrement({ xe: 12345, ye: -678, ze: 38110, intensite: 1621, retour: 2, sur: 3, bord: 1, sens: 1, canal: 3, drapeaux: 5, classe: 2, user: 6, angle: -1193, source: 554, gps: 422453057.9 });
  const p = A.lirePoint(o, { echelle: [0.01, 0.01, 0.01], decalage: [100, 200, 0] });
  assert.equal(p.intensite, 1621);
  assert.equal(p.retour, 2); assert.equal(p.nbRetours, 3);
  assert.equal(p.bord, true); assert.equal(p.sensPositif, true); assert.equal(p.canal, 3);
  assert.equal(JSON.stringify(p.drapeaux), JSON.stringify(['synthétique', 'retenu']));   // bits 0 et 2 (les objets de vm : on compare le JSON)
  assert.equal(p.classe, 2); assert.equal(p.user, 6); assert.equal(p.source, 554);
  assert.ok(Math.abs(p.angleDeg - (-1193 * 0.006)) < 1e-9, `angle ${p.angleDeg}`);
  assert.equal(p.gps, 422453057.9);
  assert.equal(p.marqueurs, null, 'pas de marqueurs sur un point de 30 octets');
  assert.ok(Math.abs(p.x - 223.45) < 1e-9 && Math.abs(p.y - 193.22) < 1e-9 && Math.abs(p.z - 381.1) < 1e-9, `${p.x} ${p.y} ${p.z}`);
});

test('lirePoint : sans drapeau ni bord, les listes sont vides et les booléens faux', () => {
  const p = A.lirePoint(enregistrement({ classe: 5 }), { echelle: [0.01, 0.01, 0.01], decalage: [0, 0, 0] });
  assert.equal(JSON.stringify(p.drapeaux), '[]');
  assert.equal(p.bord, false); assert.equal(p.sensPositif, false);
});

test('lirePoint : les marqueurs MNT et MNS des points à 46 octets (réels de 8 octets : 1 ou 0)', () => {
  const o = enregistrement({ marqueurs: [1, 0] });
  const p = A.lirePoint(o, { echelle: [0.01, 0.01, 0.01], decalage: [0, 0, 0] });
  assert.equal(JSON.stringify(p.marqueurs), JSON.stringify({ mnt: true, mns: false }));
  assert.equal(JSON.stringify(A.lirePoint(enregistrement({ marqueurs: [0, 1] }), { echelle: [0.01, 0.01, 0.01], decalage: [0, 0, 0] }).marqueurs), JSON.stringify({ mnt: false, mns: true }));
});

test('lignes : le tableau est rangé par groupes, en français, avec la date en tête', () => {
  const p = A.lirePoint(enregistrement({ xe: 87712345, ye: 690412345, ze: 38110, intensite: 1621, retour: 1, sur: 2, sens: 1, canal: 3, classe: 2, user: 3, angle: -1193, source: 43, gps: 422453057.89562845, marqueurs: [1, 0] }),
    { echelle: [0.01, 0.01, 0.01], decalage: [0, 0, 0] });
  const lignes = A.lignes(p, { nomsClasses: { 2: 'sol', 5: 'végét. haute' } });
  const groupes = [...new Set(lignes.map((l) => l.groupe))];
  assert.equal(groupes.join(' | '), 'Temps | Retour du laser | Le vol | Classement | Marqueurs IGN | Position');
  const v = (libelle) => lignes.find((l) => l.libelle === libelle)?.valeur;
  assert.equal(lignes[0].libelle, 'Date et heure (UTC)');
  assert.equal(v('Date et heure (UTC)'), '2025-02-01 13:50:39,896');
  assert.equal(v('Temps GPS brut'), '422 453 057,896 s');
  assert.equal(v('Intensité'), '1621');
  assert.equal(v('Retour'), '1 sur 2');
  assert.equal(v('Angle de scan'), '−7,158°');
  assert.equal(v('Sens de balayage'), 'de gauche à droite');
  assert.equal(v('Canal du scanner'), '3');
  assert.equal(v('Ligne de vol'), '43');
  assert.equal(v('Valeur utilisateur'), '3 (valeur brute)');
  assert.equal(v('Classe'), '2 : sol');
  assert.equal(v('Drapeaux de classement'), 'aucun');
  assert.equal(v('Utilisé pour le MNT'), 'oui');
  assert.equal(v('Utilisé pour le MNS'), 'non');
});

test('lignes : sans date possible, sans marqueurs et avec une classe inconnue, rien n’est inventé', () => {
  const p = A.lirePoint(enregistrement({ classe: 99, gps: 12345.6 }), { echelle: [0.01, 0.01, 0.01], decalage: [0, 0, 0] });
  const lignes = A.lignes(p, { nomsClasses: { 2: 'sol' } });
  const v = (libelle) => lignes.find((l) => l.libelle === libelle)?.valeur;
  assert.equal(v('Date et heure (UTC)'), 'n/d (temps de semaine : pas de numéro de semaine)');
  assert.equal(v('Classe'), '99 : classe inconnue');
  assert.ok(!lignes.some((l) => l.groupe === 'Marqueurs IGN'), 'pas de groupe sans marqueurs');
});

test('lignes : aucun tiret cadratin dans ce que la personne lit', () => {
  const p = A.lirePoint(enregistrement({ marqueurs: [1, 1], gps: 422453057.9, drapeaux: 15 }), { echelle: [0.01, 0.01, 0.01], decalage: [0, 0, 0] });
  for (const l of A.lignes(p, { nomsClasses: { 1: 'non classé' } })) assert.ok(!`${l.libelle}${l.valeur}`.includes('—'), `${l.libelle}`);
});
