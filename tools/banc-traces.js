// Banc des tracés : le détecteur (src/traces.js) noté contre la BD TOPO.
//
// Pour chaque dalle : les blocs COPC (gardés dans .tmp/banc-traces/, un seul
// téléchargement), le SVF calculé exactement comme dans l'appli (VUE_RELIEF,
// réglages par défaut, gardé lui aussi pour que les itérations ne refassent que
// la détection), la détection, le linéaire IGN découpé sur la dalle, et deux
// chiffres à 10 et 20 m : le rappel (la part des tracés IGN retrouvés) et la
// précision (la part de la détection qui tombe sur un tracé IGN). Cible :
// 70 % et 50 % à 10 m sur la dalle de référence.
// Conception : docs/superpowers/specs/2026-09-27-traces-design.md.
//
// Lancer : `npm run banc-traces` (options : `--pas 1`, `--recalculer`).
// Rapport : .tmp/banc-traces/rapport.html, images à pleine résolution par quart.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { charger, lazPerf } from './natif.js';
import { png } from './png.js';

const S = charger(
  ['config.js', 'proj.js', 'reseau.js', 'copc.js', 'ign.js', 'decodeur.js', 'vue-grille.js', 'raster.js', 'gpu-relief.js', 'relief.js', 'vue-relief.js', 'traces.js'],
  ['CONFIG', 'PROJ', 'COPC', 'IGN', 'DECODEUR', 'VUE_GRILLE', 'VUE_RELIEF', 'TRACES'],
);

const LOT = 'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/';
const DALLES = [
  { nom: '0536_6214', role: 'référence', url: `${LOT}NUALHD_1-0__LAZ_LAMB93_IR_2025-03-20/LHD_FXX_0536_6214_PTS_LAMB93_IGN69.copc.laz` },
  { nom: '0535_6214', role: 'contrôle', url: `${LOT}NUALHD_1-0__LAZ_LAMB93_HR_2025-04-18/LHD_FXX_0535_6214_PTS_LAMB93_IGN69.copc.laz` },
  // Montagne ariégeoise : un sentier que l'utilisateur voit nettement sur le
  // SVF, et que la détection manquait (27 septembre 2026). `temoin` : un point
  // de ce sentier ; le banc dit à quelle distance passe le tracé le plus proche.
  { nom: '0542_6197', role: 'montagne', url: `${LOT}NUALHD_1-0__LAZ_LAMB93_IR_2025-03-20/LHD_FXX_0542_6197_PTS_LAMB93_IGN69.copc.laz`, temoin: [542314.1, 6196599.6] },
];
const args = process.argv.slice(2);
const PAS = Number(args[args.indexOf('--pas') + 1]) || 0.5;
const RECALCULER = args.includes('--recalculer');
// `--reglages '{"seuilHaut": 0.3}'` : surcharge CONFIG.traces pour ce passage.
const REGLAGES = args.includes('--reglages') ? JSON.parse(args[args.indexOf('--reglages') + 1]) : {};
// `--svf '{"svfRayonM": 5}'` : réglages du SVF (rayon, directions), comme les curseurs de l'appli.
// Par défaut, celui de la détection dans l'appli (CONFIG.traces.svf).
const SVF = { ...S.CONFIG.traces.svf, ...(args.includes('--svf') ? JSON.parse(args[args.indexOf('--svf') + 1]) : {}) };
const SUFFIXE_SVF = Object.keys(SVF).length ? `-${Object.entries(SVF).map(([k, v]) => `${k}${v}`).join('-')}` : '';
// `--dalles 0542_6197,0536_6214` : seulement celles-là.
const CHOIX = args.includes('--dalles') ? args[args.indexOf('--dalles') + 1].split(',') : null;
const RACINE = new URL('../.tmp/banc-traces/', import.meta.url);
mkdirSync(RACINE, { recursive: true });
const chemin = (...p) => new URL(p.join('/'), RACINE);

const empriseDe = (nom) => {
  const [x, y] = nom.split('_').map(Number);
  return { xmin: x * 1000, xmax: x * 1000 + 1000, ymin: y * 1000 - 1000, ymax: y * 1000 };
};

/** Les blocs de la dalle, téléchargés une fois (5 requêtes en vol). */
async function blocs(d) {
  const dossier = chemin(d.nom, '');
  mkdirSync(dossier, { recursive: true });
  const entete = await S.COPC.lireEntete(d.url);
  const noeuds = [...(await S.COPC.lireHierarchie(entete)).values()].filter((n) => n.nbPoints > 0);
  const manquants = noeuds.filter((n) => !existsSync(new URL(`${n.offset}.bin`, dossier)));
  if (manquants.length) {
    const plages = S.COPC.grouperPlages(manquants, 1 << 20, 8 << 20);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (plages.length) {
        const p = plages.shift();
        const o = await (async () => {
          const r = await fetch(d.url, { headers: { Range: `bytes=${p.debut}-${p.fin - 1}` } });
          return new Uint8Array(await r.arrayBuffer());
        })();
        for (const n of p.noeuds) writeFileSync(new URL(`${n.offset}.bin`, dossier), o.subarray(n.offset - p.debut, n.offset - p.debut + n.taille));
      }
    }));
    console.log(`  ${manquants.length} blocs téléchargés en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  return { entete, noeuds, dossier };
}

/** Le SVF de la dalle au pas `PAS`, calculé comme dans l'appli, gardé sur disque. */
async function svf(d) {
  const e = empriseDe(d.nom);
  const f = chemin(d.nom, `svf-${PAS}${SUFFIXE_SVF}.bin`), m = chemin(d.nom, `svf-${PAS}${SUFFIXE_SVF}.json`);
  if (!RECALCULER && existsSync(f) && existsSync(m)) {
    const meta = JSON.parse(readFileSync(m, 'utf8'));
    const o = readFileSync(f);
    const n = meta.W * meta.H;
    return { ...meta, svf: new Float32Array(o.buffer, o.byteOffset, n), valide: new Uint8Array(o.buffer, o.byteOffset + n * 4, n) };
  }
  const { entete, noeuds, dossier } = await blocs(d);
  const lp = await lazPerf();
  const moteur = S.VUE_RELIEF.creer({ moteur: 'cpu' });
  const origineCm = [e.xmin * 100, e.ymin * 100, 0];
  let t0 = Date.now(), total = 0;
  for (const n of noeuds) {
    const points = S.DECODEUR.decoderBloc(lp, new Uint8Array(readFileSync(new URL(`${n.offset}.bin`, dossier))), {
      nbPoints: n.nbPoints, formatPoint: entete.formatPoint, longueurPoint: entete.longueurPoint,
      echelle: entete.echelle, decalage: entete.decalage, origine: [0, 0, 0], entiers: origineCm,
    });
    moteur.ajouter({ cle: `${n.cle.n}-${n.cle.x}-${n.cle.y}-${n.cle.z}`, emprise: S.COPC.empriseNoeud(entete, n.cle), origineCm, points });
    total += n.nbPoints;
  }
  console.log(`  ${(total / 1e6).toFixed(1)} M points décodés en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const geo = S.VUE_GRILLE.definir(e, PAS, S.VUE_GRILLE.marge({ ...S.CONFIG.relief, ...S.CONFIG.flux }), 16384);
  t0 = Date.now();
  const r = moteur.calculer(geo, 'svf', { contraste: 1, couche: SVF });
  console.log(`  SVF ${geo.W}×${geo.H} en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const meta = { W: r.t.W, H: r.t.H, pas: r.t.pas, emprise: r.t.emprise, min: r.min, max: r.max };
  const n = meta.W * meta.H;
  const o = Buffer.alloc(n * 5);
  Buffer.from(r.valeurs.buffer, r.valeurs.byteOffset, n * 4).copy(o, 0);
  Buffer.from(r.t.valide.buffer, r.t.valide.byteOffset, n).copy(o, n * 4);
  writeFileSync(f, o);
  writeFileSync(m, JSON.stringify(meta));
  return { ...meta, svf: r.valeurs, valide: r.t.valide };
}

/** Le linéaire IGN de la dalle, gardé sur disque. */
async function ign(d) {
  const f = chemin(d.nom, 'ign.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const l = await S.IGN.lineaire(empriseDe(d.nom));
  writeFileSync(f, JSON.stringify(l));
  return l;
}

/** Quatre quarts à pleine résolution : SVF en gris, IGN en bleu clair, détection en rouge. */
function images(d, s, reference, detectes) {
  const e = empriseDe(d.nom);
  const N = Math.round((e.xmax - e.xmin) / s.pas);
  const x0 = Math.round((e.xmin - s.emprise.xmin) / s.pas), y0 = Math.round((e.ymin - s.emprise.ymin) / s.pas);
  const rvb = new Uint8Array(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = s.svf[(y0 + y) * s.W + x0 + x];
    const g = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(((v - s.min) / (s.max - s.min)) * 255))) : 128;
    const o = ((N - 1 - y) * N + x) * 3;
    rvb[o] = rvb[o + 1] = rvb[o + 2] = g;
  }
  const tracer = (lignes, [r, v, b], epaisseur) => {
    for (const l of lignes) for (let i = 1; i < l.length; i++) {
      const [ax, ay] = l[i - 1], [bx, by] = l[i];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (s.pas / 2));
      for (let k = 0; k <= n; k++) {
        const px = Math.floor((ax + (bx - ax) * (k / n) - e.xmin) / s.pas), py = N - 1 - Math.floor((ay + (by - ay) * (k / n) - e.ymin) / s.pas);
        for (let dy = -epaisseur; dy <= epaisseur; dy++) for (let dx = -epaisseur; dx <= epaisseur; dx++) {
          const qx = px + dx, qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= N || qy >= N) continue;
          const o = (qy * N + qx) * 3;
          rvb[o] = r; rvb[o + 1] = v; rvb[o + 2] = b;
        }
      }
    }
  };
  tracer(reference, [80, 200, 255], 1);
  tracer(detectes, [255, 40, 40], 0);
  const H = N / 2, noms = [];
  for (const [q, qx, qy] of [['NO', 0, 0], ['NE', H, 0], ['SO', 0, H], ['SE', H, H]]) {
    const c = new Uint8Array(H * H * 3);
    for (let y = 0; y < H; y++) c.set(rvb.subarray(((qy + y) * N + qx) * 3, ((qy + y) * N + qx + H) * 3), y * H * 3);
    const nom = `${d.nom}-${q}.png`;
    writeFileSync(chemin(nom), png(c, H, H));
    noms.push([q, nom]);
  }
  return noms;
}

const lignes = [];
let html = '<!doctype html><meta charset="utf-8"><title>Banc des tracés</title>'
  + '<style>body{font:14px system-ui;background:#111;color:#ddd;margin:16px}img{width:100%;max-width:1000px;display:block}'
  + 'table{border-collapse:collapse}td,th{padding:4px 12px;border-bottom:1px solid #333}.q{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:8px}</style>'
  + `<h1>Banc des tracés — pas ${PAS} m</h1><p>Réglages : ${JSON.stringify({ ...S.CONFIG.traces, ...REGLAGES })}</p><p>Gris : SVF. Bleu clair : BD TOPO. Rouge : détection.</p><table><tr><th>Dalle</th><th>Rappel 10 m</th><th>Précision 10 m</th><th>Rappel 20 m</th><th>Précision 20 m</th><th>IGN</th><th>Détecté</th><th>Durée</th></tr>`;
const pct = (v) => (Number.isFinite(v) ? `${(100 * v).toFixed(1)} %` : '—');
let corps = '';
for (const d of DALLES.filter((x) => !CHOIX || CHOIX.includes(x.nom))) {
  console.log(`${d.nom} (${d.role})`);
  const s = await svf(d);
  const reference = (await ign(d)).map((l) => l.points);
  const t0 = Date.now();
  const r = S.TRACES.detecter({ W: s.W, H: s.H, pas: s.pas, emprise: s.emprise, valide: s.valide }, { ...REGLAGES, svf: s.svf });
  const duree = (Date.now() - t0) / 1000;
  const e = empriseDe(d.nom);
  const m10 = S.TRACES.mesurer(r.lignes, reference, e, 10), m20 = S.TRACES.mesurer(r.lignes, reference, e, 20);
  const ligne = { dalle: d.nom, role: d.role, pas: PAS, rappel10: m10.rappel, precision10: m10.precision, rappel20: m20.rappel, precision20: m20.precision, ign: m10.longueurReference, detecte: m10.longueurDetectee, duree, stats: r.stats };
  lignes.push(ligne);
  if (d.temoin) {
    let dmin = Infinity;
    for (const l of r.lignes) for (let i = 1; i < l.length; i++) {
      const [ax, ay] = l[i - 1], [bx, by] = l[i], [px, py] = d.temoin;
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-9;
      const u = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2));
      dmin = Math.min(dmin, Math.hypot(px - ax - u * (bx - ax), py - ay - u * (by - ay)));
    }
    ligne.temoin = dmin;
    console.log(`  témoin : tracé le plus proche à ${dmin.toFixed(1)} m ${dmin <= 5 ? '(trouvé)' : '(MANQUÉ)'}`);
  }
  console.log(`  rappel ${pct(m10.rappel)} · précision ${pct(m10.precision)} à 10 m (${pct(m20.rappel)} · ${pct(m20.precision)} à 20 m) · IGN ${m10.longueurReference.toFixed(0)} m · détecté ${m10.longueurDetectee.toFixed(0)} m · ${duree.toFixed(1)} s`);
  html += `<tr><td>${d.nom} (${d.role})</td><td>${pct(m10.rappel)}</td><td>${pct(m10.precision)}</td><td>${pct(m20.rappel)}</td><td>${pct(m20.precision)}</td><td>${m10.longueurReference.toFixed(0)} m</td><td>${m10.longueurDetectee.toFixed(0)} m</td><td>${duree.toFixed(1)} s</td></tr>`;
  corps += `<h2>${d.nom} (${d.role})</h2><div class="q">${images(d, s, reference, S.TRACES.decouper(r.lignes, e)).map(([q, n]) => `<figure><img src="${n}"><figcaption>${q}</figcaption></figure>`).join('')}</div>`;
}
writeFileSync(chemin('rapport.json'), JSON.stringify(lignes, null, 2));
writeFileSync(chemin('rapport.html'), `${html}</table>${corps}`);
console.log(`rapport : ${new URL('rapport.html', RACINE).pathname}`);
