// Nuages synthétiques à vérité connue, partagés par les tests.
//
// Extrait de `detection.test.js` le jour où la voie par la forme a eu besoin
// des mêmes nuages : deux générateurs qui divergent, ce sont deux chaînes
// testées sur deux terrains différents, et une comparaison qui ne veut plus
// rien dire.

/**
 * Générateur pseudo-aléatoire à graine — et non `Math.random`.
 *
 * Le désordre d'échantillonnage est indispensable au réalisme, mais s'il change
 * à chaque exécution les cas limites basculent d'un côté ou de l'autre et un
 * test échoue une fois sur quelques dizaines. Observé. Une graine fixe garde le
 * réalisme et rend l'échec reproductible.
 */
export function hasard(graine = 12345) {
  let e = graine >>> 0;
  return () => {
    e = (e * 1664525 + 1013904223) >>> 0;
    return e / 4294967296;
  };
}

export const X0 = 592000, Y0 = 6183000;   // coin sud-ouest, Lambert-93
export const COTE = 40;                   // zone de 40 × 40 m
export const EMPRISE = { xmin: X0, xmax: X0 + COTE, ymin: Y0, ymax: Y0 + COTE };

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
export function nuageSynthetique(opts = {}) {
  const {
    dansStructure = null, hauteur = 2, pente = 0,
    classeStructure = 1, trouSol = true, densite = 10,
  } = opts;

  const origine = [X0 + COTE / 2, Y0 + COTE / 2, 1000];
  const pas = 1 / Math.sqrt(densite);
  const alea = hasard();
  const xs = [], ys = [], zs = [], cls = [];
  const tanP = Math.tan(pente * Math.PI / 180);

  for (let gy = 0; gy < COTE; gy += pas) {
    for (let gx = 0; gx < COTE; gx += pas) {
      // Léger désordre : un échantillonnage parfaitement régulier laisserait
      // des cellules systématiquement vides selon l'alignement de la grille.
      const x = gx + (alea() - 0.5) * pas;
      const y = gy + (alea() - 0.5) * pas;
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
export const rectangle = (l, L) => (x, y) =>
  Math.abs(x - COTE / 2) <= l / 2 && Math.abs(y - COTE / 2) <= L / 2;

export const disque = (r) => (x, y) => Math.hypot(x - COTE / 2, y - COTE / 2) <= r;

