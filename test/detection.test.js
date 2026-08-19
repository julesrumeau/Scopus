// Tests de la chaîne rastérisation → détection sur nuages synthétiques.
//
// Les cas réels ne disent pas si un écart vient du seuil ou du calcul : ici la
// vérité terrain est posée, on vérifie que le pipeline la retrouve avec les
// bonnes dimensions, et qu'il rejette ce qu'il doit rejeter.
//
//   node --test test/

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';
import { nuageSynthetique, rectangle, disque, X0, Y0, COTE, EMPRISE } from './nuages.js';

// Même ordre que dans index.html : chaque script lit les globaux des précédents.
const { rasteriser, detecter, versLambert93 } =
  chargerScripts(['config.js', 'proj.js', 'raster.js', 'detection.js']);

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

test('l’eau est du terrain, et non un trou que le comblement bombe', () => {
  // Une surface d'eau ne renvoie aucun point « sol ». Ignorée, elle laisse un
  // trou que le comblement referme depuis les berges — c'est-à-dire un dôme ou
  // un plan incliné là où il y a un plan d'eau horizontal, parfaitement lisible
  // en ombrage et en Sky-View Factor. La classe 9 est donc versée dans le sol.
  const centre = (g) => {
    const cx = (g.W / 2) | 0, cy = (g.H / 2) | 0;
    return g.mnt[cy * g.W + cx];
  };

  // Une mare de 8 m de rayon, 50 cm sous le niveau des berges.
  const eau = rasteriser(nuageSynthetique({
    dansStructure: disque(8), classeStructure: 9, hauteur: -0.5,
  }));
  assert.ok(Math.abs(centre(eau) + 0.5) < 0.1,
    `la surface d'eau doit être mesurée à −0,50 m : ${centre(eau).toFixed(3)}`);

  // Contrôle : la même géométrie dans une classe sans emploi (« divers ») laisse
  // bien le trou, comblé depuis les berges. C'est ce que faisait l'eau avant.
  const trou = rasteriser(nuageSynthetique({
    dansStructure: disque(8), classeStructure: 67, hauteur: -0.5,
  }));
  assert.ok(Math.abs(centre(trou)) < 0.1,
    `le trou comblé doit revenir au niveau des berges : ${centre(trou).toFixed(3)}`);
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

test('l’altitude publiée est absolue, pas relative au bas de la dalle', () => {
  // Le nuage synthétique pose son origine à 1000 m et son sol à 0 en relatif :
  // l'altitude annoncée doit donc valoir 1000, pas 0. Une altitude relative
  // dessinait les boîtes du nuage 3D un millier de mètres sous les points, et
  // écrivait des élévations fausses dans les GPX.
  const c = detecter(rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 4) }))).candidats[0];
  assert.ok(Math.abs(c.altitude - 1000) < 1,
    `altitude ${c.altitude.toFixed(1)} m, attendue ≈ 1000`);

  // Sur terrain incliné, elle suit le sol sous la structure.
  const pente = detecter(rasteriser(nuageSynthetique({ dansStructure: rectangle(6, 4), pente: 10 }))).candidats[0];
  const attendu = 1000 + (COTE / 2) * Math.tan(10 * Math.PI / 180);
  assert.ok(Math.abs(pente.altitude - attendu) < 1.5,
    `altitude ${pente.altitude.toFixed(1)} m, attendue ≈ ${attendu.toFixed(1)}`);
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
