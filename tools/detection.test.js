// Tests de la chaîne rastérisation → détection sur nuages synthétiques.
//
// Les cas réels ne disent pas si un écart vient du seuil ou du calcul : ici la
// vérité terrain est posée, on vérifie que le pipeline la retrouve avec les
// bonnes dimensions, et qu'il rejette ce qu'il doit rejeter.
//
//   node --test tools/

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

// Même ordre que dans index.html : chaque script lit les globaux des précédents.
const { rasteriser, detecter, versLambert93 } =
  chargerScripts(['config.js', 'proj.js', 'raster.js', 'detection.js']);

const X0 = 592000, Y0 = 6183000;   // coin sud-ouest, Lambert-93
const COTE = 40;                   // zone de 40 × 40 m
const EMPRISE = { xmin: X0, xmax: X0 + COTE, ymin: Y0, ymax: Y0 + COTE };

/**
 * Fabrique un nuage : sol plat (ou en pente), plus une structure.
 *
 * @param {object} opts
 * @param {(x:number,y:number)=>boolean} [opts.dansStructure] emprise de la structure
 * @param {number} [opts.hauteur] hauteur de la structure, en m
 * @param {number} [opts.pente] pente du sol, en degrés
 * @param {number} [opts.classeStructure] classification des points de structure
 * @param {boolean} [opts.trouSol] retirer le sol sous la structure
 */
function nuageSynthetique(opts = {}) {
  const {
    dansStructure = null, hauteur = 2, pente = 0,
    classeStructure = 1, trouSol = true, densite = 10,
  } = opts;

  const origine = [X0 + COTE / 2, Y0 + COTE / 2, 1000];
  const pas = 1 / Math.sqrt(densite);
  const xs = [], ys = [], zs = [], cls = [];
  const tanP = Math.tan(pente * Math.PI / 180);

  for (let gy = 0; gy < COTE; gy += pas) {
    for (let gx = 0; gx < COTE; gx += pas) {
      // Léger désordre : un échantillonnage parfaitement régulier laisserait
      // des cellules systématiquement vides selon l'alignement de la grille.
      const x = gx + (Math.random() - 0.5) * pas;
      const y = gy + (Math.random() - 0.5) * pas;
      const zSol = gx * tanP;
      const dedans = dansStructure?.(x, y) ?? false;

      if (!dedans || !trouSol) {
        xs.push(x - COTE / 2); ys.push(y - COTE / 2); zs.push(zSol); cls.push(2);
      }
      if (dedans) {
        xs.push(x - COTE / 2); ys.push(y - COTE / 2);
        zs.push(zSol + hauteur); cls.push(classeStructure);
      }
    }
  }

  const n = xs.length;
  const nuage = {
    n, origine, emprise: EMPRISE,
    x: Float32Array.from(xs), y: Float32Array.from(ys), z: Float32Array.from(zs),
    cls: Uint8Array.from(cls),
    intensite: new Uint16Array(n), retour: new Uint8Array(n),
    zmin: Math.min(...zs), zmax: Math.max(...zs),
  };
  return nuage;
}

// Rectangle de l × L mètres, centré dans la zone.
const rectangle = (l, L) => (x, y) =>
  Math.abs(x - COTE / 2) <= l / 2 && Math.abs(y - COTE / 2) <= L / 2;

const disque = (r) => (x, y) => Math.hypot(x - COTE / 2, y - COTE / 2) <= r;

test('détecte une structure rectangulaire sur sol plat', () => {
  const g = rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 4) }));
  const r = detecter(g);

  assert.equal(r.candidats.length, 1, 'exactement une structure attendue');
  const c = r.candidats[0];

  // Le contour est reconstruit à la cellule près : on tolère un pas de grille.
  assert.ok(Math.abs(c.surface - 24) < 6, `surface ${c.surface.toFixed(1)} m², attendu ≈ 24`);
  assert.ok(Math.abs(c.longueur - 6) < 1, `longueur ${c.longueur.toFixed(2)} m, attendu ≈ 6`);
  assert.ok(Math.abs(c.largeur - 4) < 1, `largeur ${c.largeur.toFixed(2)} m, attendu ≈ 4`);
  assert.ok(Math.abs(c.hauteurMoy - 2) < 0.3, `hauteur ${c.hauteurMoy.toFixed(2)} m, attendu ≈ 2`);
  assert.ok(c.rectangularite > 0.85, `rectangularité ${c.rectangularite.toFixed(2)}, attendu > 0.85`);
  assert.ok(c.partTrouSol > 0.7, `part de trou dans le sol ${c.partTrouSol.toFixed(2)}, attendu > 0.7`);
  assert.ok(Number.isFinite(c.score) && c.score > 0.5, `score ${c.score}`);
});

test('le centre détecté retombe sur le centre réel de la structure', () => {
  const g = rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 6) }));
  const c = detecter(g).candidats[0];

  const attenduX = X0 + COTE / 2;
  const attenduY = Y0 + COTE / 2;
  assert.ok(Math.hypot(c.x - attenduX, c.y - attenduY) < 1,
    `centre à ${Math.hypot(c.x - attenduX, c.y - attenduY).toFixed(2)} m du réel`);

  // Et la position géographique publiée doit correspondre au même point.
  const retour = versLambert93(c.lon, c.lat);
  assert.ok(Math.hypot(retour.x - c.x, retour.y - c.y) < 0.01);
});

test('rejette une structure trop petite puis trop grande', () => {
  const petite = detecter(rasteriser(nuageSynthetique({ dansStructure: rectangle(1.5, 1.5) })));
  assert.equal(petite.candidats.length, 0);
  assert.ok(petite.stats.rejets.surface > 0, 'doit être rejetée sur le critère de surface');

  const grande = detecter(rasteriser(nuageSynthetique({ dansStructure: rectangle(15, 12) })));
  assert.equal(grande.candidats.length, 0);
  assert.ok(grande.stats.rejets.surface > 0);
});

test('retient une structure ronde — les orris ariégeois le sont souvent', () => {
  const r = detecter(rasteriser(nuageSynthetique({ dansStructure: disque(2.6) })));
  assert.equal(r.candidats.length, 1, 'une cabane ronde doit être retenue');

  // π/4 : c'est le plafond structurel d'un disque. Le vérifier ici fige le fait
  // que le seuil de rectangularité ne doit jamais monter au-dessus.
  const rect = r.candidats[0].rectangularite;
  assert.ok(Math.abs(rect - Math.PI / 4) < 0.06, `rectangularité ${rect.toFixed(3)}, attendu ≈ 0.785`);
});

test('classe un rectangle net au-dessus d’une forme en L', () => {
  const carre = detecter(rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 4) }))).candidats[0];

  // Deux branches perpendiculaires : surface et hauteur correctes, forme non.
  const enL = (x, y) =>
    (Math.abs(x - COTE / 2) <= 4 && Math.abs(y - COTE / 2 + 2.5) <= 1.5)
    || (Math.abs(y - COTE / 2) <= 4 && Math.abs(x - COTE / 2 + 2.5) <= 1.5);
  const branche = detecter(rasteriser(nuageSynthetique({ dansStructure: enL }))).candidats[0];

  assert.ok(carre.rectangularite > branche.rectangularite + 0.25,
    `rectangle ${carre.rectangularite.toFixed(2)} doit dominer le L ${branche?.rectangularite.toFixed(2)}`);
  assert.ok(carre.score > branche.score, 'et obtenir un meilleur score');
});

test('rejette un muret — filtre d’élongation', () => {
  // 16 × 0.8 m : surface dans la plage, mais rapport 20:1.
  const g = rasteriser(nuageSynthetique({ dansStructure: rectangle(16, 0.8), hauteur: 1.2 }));
  const r = detecter(g);
  assert.equal(r.candidats.length, 0);
  assert.ok(r.stats.rejets.elongation + r.stats.rejets.surface > 0);
});

test('rejette la même structure sur forte pente — cas falaise', () => {
  const plat = detecter(rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 4), pente: 0 })));
  assert.equal(plat.candidats.length, 1, 'contrôle : détectée à plat');

  const raide = detecter(rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 4), pente: 35 })));
  assert.equal(raide.candidats.length, 0, 'la même structure sur 35° doit être écartée');

  // Le rejet a lieu dès le masque : le filtre de pente vide la quasi-totalité
  // des cellules, et le fragment restant tombe sous la surface minimale. C'est
  // le comportement voulu — inutile d'exiger qu'il passe par un motif précis,
  // mais il doit rester bien plus sévère qu'à plat.
  assert.ok(raide.stats.cellulesRetenues < plat.stats.cellulesRetenues / 5,
    `${raide.stats.cellulesRetenues} cellules retenues sur 35° contre ${plat.stats.cellulesRetenues} à plat`);
});

test('sol plat sans structure : aucune détection', () => {
  const r = detecter(rasteriser(nuageSynthetique({ dansStructure: null })));
  assert.equal(r.candidats.length, 0);
});

test('la classe « bâtiment » n’est vue que si l’option est active', () => {
  const g = rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 4), classeStructure: 6 }));

  assert.equal(detecter(g, { inclureBati: false }).candidats.length, 0);
  assert.equal(detecter(g, { inclureBati: true }).candidats.length, 1);
});

test('une hauteur hors plage écarte la structure', () => {
  const rase = detecter(rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 4), hauteur: 0.1 })));
  assert.equal(rase.candidats.length, 0, '10 cm : sous le seuil de hauteur');

  const haute = detecter(rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 4), hauteur: 14 })));
  assert.equal(haute.candidats.length, 0, '14 m : au-dessus du seuil');
});

test('le MNT comble le trou sous la structure', () => {
  const g = rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 4), pente: 10 }));
  const cx = Math.floor(g.W / 2), cy = Math.floor(g.H / 2);
  const centre = cy * g.W + cx;

  // Aucun point sol au centre, mais le MNT doit néanmoins y porter une
  // altitude cohérente avec la pente environnante — c'est ce qui rend la
  // hauteur de la structure calculable.
  assert.equal(g.solN[centre], 0, 'le sol doit bien être absent sous la structure');
  assert.ok(Number.isFinite(g.mnt[centre]));

  const attendu = (COTE / 2) * Math.tan(10 * Math.PI / 180);
  assert.ok(Math.abs(g.mnt[centre] - attendu) < 0.5,
    `MNT comblé à ${g.mnt[centre].toFixed(2)} m, attendu ≈ ${attendu.toFixed(2)}`);
});

test('aucune valeur non finie ne sort de la détection', () => {
  const g = rasteriser(nuageSynthetique({ dansStructure: rectangle(7, 5) }));
  for (const c of detecter(g).candidats) {
    for (const [cle, v] of Object.entries(c)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${cle} = ${v}`);
    }
  }
});
