// Lecteur COPC (Cloud Optimized Point Cloud) par requêtes de plage HTTP.
//
// Pourquoi ce module existe : une dalle LiDAR HD fait ~190 Mo pour ~30 M de
// points. La télécharger entière pour inspecter une ruine de 6 m de côté serait
// absurde. Or le format COPC — celui que diffuse l'IGN — range les points dans
// un octree dont chaque nœud est un bloc LAZ indépendant, et publie la table de
// ces nœuds dans le fichier. Deux requêtes de plage suffisent donc à savoir où
// se trouve chaque bloc, après quoi on ne télécharge que ceux qui intersectent
// la zone visée, à la profondeur voulue.
//
// Concrètement, sur la dalle de test : en-tête + hiérarchie = 48 Ko, contre
// 187 Mo pour le fichier entier. Une zone de 250 m de côté à pleine résolution
// coûte de l'ordre de 5 Mo.
//
// Référence : https://copc.io/copc-specification-1.0.pdf

const TAILLE_ENTETE_MIN = 375;   // en-tête LAS 1.4
const TAILLE_ENTETE_VLR = 54;
const TAILLE_ENTREE_HIER = 32;

/**
 * En-tête LAS + VLR « copc info ». Une seule requête de plage : 64 Ko couvrent
 * l'en-tête, les VLR et le début du VLR de projection dans tous les cas
 * rencontrés.
 */
async function lireEntete(url, signal) {
  const buf = await RESEAU.recuperer(url, { plage: [0, 65535], signal });
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const signature = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (signature !== 'LASF') throw new Error("Ce fichier n'est pas un LAS/LAZ (signature absente)");

  const versionMajeure = dv.getUint8(24);
  const versionMineure = dv.getUint8(25);
  if (versionMajeure !== 1 || versionMineure < 4) {
    throw new Error(`LAS ${versionMajeure}.${versionMineure} non géré — COPC impose LAS 1.4`);
  }

  const tailleEntete = dv.getUint16(94, true);
  const nbVLR = dv.getUint32(100, true);

  // Le bit de poids fort du format de point signale la compression LAZ ; le
  // format réel tient sur les 7 bits bas.
  const formatPoint = dv.getUint8(104) & 0x7f;
  const longueurPoint = dv.getUint16(105, true);

  const entete = {
    url,
    formatPoint,
    longueurPoint,
    echelle: [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)],
    decalage: [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)],
    bbox: {
      xmin: dv.getFloat64(187, true), xmax: dv.getFloat64(179, true),
      ymin: dv.getFloat64(203, true), ymax: dv.getFloat64(195, true),
      zmin: dv.getFloat64(219, true), zmax: dv.getFloat64(211, true),
    },
    // LAS 1.4 double le compteur de points : l'ancien champ 32 bits (offset
    // 107) reste à zéro dès que le format dépasse 5, seul le champ 64 bits
    // fait foi.
    nbPoints: Number(dv.getBigUint64(247, true)),
  };

  // Balayage des VLR à la recherche de « copc / 1 », toujours le premier d'un
  // fichier COPC conforme — mais rien n'oblige à le supposer.
  let p = tailleEntete;
  let info = null;
  for (let i = 0; i < nbVLR && p + TAILLE_ENTETE_VLR <= buf.length; i++) {
    let idUtilisateur = '';
    for (let k = 0; k < 16; k++) {
      const c = buf[p + 2 + k];
      if (c === 0) break;
      idUtilisateur += String.fromCharCode(c);
    }
    const idEnregistrement = dv.getUint16(p + 18, true);
    const longueur = dv.getUint16(p + 20, true);
    const q = p + TAILLE_ENTETE_VLR;

    if (idUtilisateur === 'copc' && idEnregistrement === 1) {
      info = {
        centre: [dv.getFloat64(q, true), dv.getFloat64(q + 8, true), dv.getFloat64(q + 16, true)],
        demiCote: dv.getFloat64(q + 24, true),
        espacement: dv.getFloat64(q + 32, true),
        hierOffset: Number(dv.getBigUint64(q + 40, true)),
        hierTaille: Number(dv.getBigUint64(q + 48, true)),
      };
    }
    p = q + longueur;
  }

  if (!info) throw new Error("VLR « copc info » introuvable — le fichier n'est pas un COPC");
  entete.copc = info;
  return entete;
}

/**
 * Charge l'octree en entier.
 *
 * La hiérarchie COPC est paginée : une entrée dont `nbPoints` vaut -1 ne décrit
 * pas un nœud mais une autre page à télécharger. Sur les dalles IGN testées
 * tout tient dans la page racine (1470 nœuds, 47 Ko), mais on suit quand même
 * les renvois — une dalle plus dense en produirait.
 *
 * @returns {Map<string, {cle:{n:number,x:number,y:number,z:number}, offset:number, taille:number, nbPoints:number}>}
 */
async function lireHierarchie(entete, signal) {
  const noeuds = new Map();
  const aVisiter = [[entete.copc.hierOffset, entete.copc.hierTaille]];
  const pagesVues = new Set();

  while (aVisiter.length) {
    const [offset, taille] = aVisiter.shift();
    const jeton = `${offset}:${taille}`;
    if (taille <= 0 || pagesVues.has(jeton)) continue;
    pagesVues.add(jeton);

    const buf = await RESEAU.recuperer(entete.url, { plage: [offset, offset + taille - 1], signal });
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    for (let p = 0; p + TAILLE_ENTREE_HIER <= buf.length; p += TAILLE_ENTREE_HIER) {
      const cle = {
        n: dv.getInt32(p, true),
        x: dv.getInt32(p + 4, true),
        y: dv.getInt32(p + 8, true),
        z: dv.getInt32(p + 12, true),
      };
      const dOffset = Number(dv.getBigUint64(p + 16, true));
      const dTaille = dv.getInt32(p + 24, true);
      const nbPoints = dv.getInt32(p + 28, true);

      if (nbPoints < 0) { aVisiter.push([dOffset, dTaille]); continue; }
      if (nbPoints === 0) continue;   // nœud vide : présent dans l'index, sans données
      noeuds.set(`${cle.n}-${cle.x}-${cle.y}-${cle.z}`, { cle, offset: dOffset, taille: dTaille, nbPoints });
    }
  }
  return noeuds;
}

/**
 * Emprise au sol d'un nœud d'octree.
 *
 * L'octree COPC est cubique et centré sur `copc.centre` : au niveau n, le cube
 * racine est découpé en 2^n, et la clé (x,y,z) indexe la cellule. On ignore Z
 * ici — la sélection se fait toujours sur une emprise planimétrique.
 */
function empriseNoeud(entete, cle) {
  const { centre, demiCote } = entete.copc;
  const cote = (demiCote * 2) / 2 ** cle.n;
  const x0 = centre[0] - demiCote + cle.x * cote;
  const y0 = centre[1] - demiCote + cle.y * cote;
  const z0 = centre[2] - demiCote + cle.z * cote;
  return { xmin: x0, xmax: x0 + cote, ymin: y0, ymax: y0 + cote, zmin: z0, zmax: z0 + cote, cote };
}

/**
 * Espacement nominal entre points à un niveau donné, en mètres.
 * Chaque descente d'un niveau divise l'espacement par deux — c'est ce qui
 * permet d'annoncer à l'utilisateur la résolution qu'il s'apprête à charger.
 */
function espacementNiveau(entete, niveau) {
  return entete.copc.espacement / 2 ** niveau;
}

/**
 * Choisit les nœuds à télécharger pour couvrir `emprise` (Lambert-93) le plus
 * finement possible sans dépasser les budgets.
 *
 * La sélection est gloutonne par niveau croissant : on prend d'abord tous les
 * nœuds de niveau 0, puis 1, etc. Un niveau n'est retenu que s'il tient
 * *entièrement* dans les budgets restants — accepter un niveau à moitié
 * produirait un nuage dont une part est fine et l'autre grossière, avec une
 * frontière visible et une détection faussée le long de cette frontière.
 *
 * @returns {{noeuds:Array, niveauMax:number, nbPoints:number, octets:number, tronque:boolean}}
 */
function selectionner(entete, noeuds, emprise, budgetPoints, budgetOctets) {
  const parNiveau = new Map();

  for (const noeud of noeuds.values()) {
    const e = empriseNoeud(entete, noeud.cle);
    // Intersection stricte : un nœud qui ne fait qu'affleurer le bord n'apporte
    // aucun point utile.
    if (e.xmax <= emprise.xmin || e.xmin >= emprise.xmax) continue;
    if (e.ymax <= emprise.ymin || e.ymin >= emprise.ymax) continue;
    if (!parNiveau.has(noeud.cle.n)) parNiveau.set(noeud.cle.n, []);
    parNiveau.get(noeud.cle.n).push(noeud);
  }

  const niveaux = [...parNiveau.keys()].sort((a, b) => a - b);
  const retenus = [];
  let nbPoints = 0;
  let octets = 0;
  let niveauMax = -1;
  let tronque = false;

  for (const n of niveaux) {
    const lot = parNiveau.get(n);
    const pts = lot.reduce((s, d) => s + d.nbPoints, 0);
    const oct = lot.reduce((s, d) => s + d.taille, 0);
    if (retenus.length && (nbPoints + pts > budgetPoints || octets + oct > budgetOctets)) {
      tronque = true;
      break;
    }
    retenus.push(...lot);
    nbPoints += pts;
    octets += oct;
    niveauMax = n;
  }

  return { noeuds: retenus, niveauMax, nbPoints, octets, tronque };
}

/**
 * Coût de chaque niveau pris isolément, pour l'affichage du sélecteur de
 * résolution. Les valeurs sont cumulatives : charger le niveau n implique de
 * charger tous les niveaux inférieurs, l'octree COPC répartissant les points
 * entre les niveaux au lieu de les répéter.
 */
function coutParNiveau(entete, noeuds, emprise) {
  const cumul = [];
  let pts = 0, oct = 0;

  const parNiveau = new Map();
  for (const noeud of noeuds.values()) {
    const e = empriseNoeud(entete, noeud.cle);
    if (e.xmax <= emprise.xmin || e.xmin >= emprise.xmax) continue;
    if (e.ymax <= emprise.ymin || e.ymin >= emprise.ymax) continue;
    if (!parNiveau.has(noeud.cle.n)) parNiveau.set(noeud.cle.n, { pts: 0, oct: 0, nb: 0 });
    const acc = parNiveau.get(noeud.cle.n);
    acc.pts += noeud.nbPoints;
    acc.oct += noeud.taille;
    acc.nb++;
  }

  for (const n of [...parNiveau.keys()].sort((a, b) => a - b)) {
    const acc = parNiveau.get(n);
    pts += acc.pts;
    oct += acc.oct;
    cumul.push({ niveau: n, nbNoeuds: acc.nb, nbPoints: pts, octets: oct, espacement: espacementNiveau(entete, n) });
  }
  return cumul;
}

const COPC = { lireEntete, lireHierarchie, empriseNoeud, espacementNiveau, selectionner, coutParNiveau };
