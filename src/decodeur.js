// Décompression LAZ : la fonction de travail, et le montage du Worker.
//
// Ce fichier ne s'écrit pas comme un worker classique (un fichier séparé chargé
// par son URL), parce qu'en `file://` cette voie est fermée : Chrome refuse
// `new Worker("file://…")`, et un worker créé depuis une URL blob a l'origine
// « null », donc ne peut pas non plus `importScripts` un fichier local.
//
// La parade : écrire le code du worker comme des **fonctions normales** —
// relisibles, vérifiables par un linter — puis les sérialiser avec
// `Function.prototype.toString()` pour composer le source du blob. On y
// concatène le laz-perf embarqué, et le worker devient autonome : aucun
// chargement au moment de l'exécution.
//
// Corollaire à ne pas perdre de vue : `corpsDecodeur` et `decoderBloc` sont
// sérialisées, donc **elles ne ferment sur rien**. Toute valeur extérieure doit
// arriver par argument ou par message. Une référence à `CONFIG` ou à une
// constante du fichier compilerait ici et échouerait dans le worker.

/**
 * Décompresse un bloc COPC en tableaux typés. Fonction pure, utilisée telle
 * quelle dans le worker comme sur le fil principal.
 *
 * @param {object} lazPerf module laz-perf initialisé
 * @param {Uint8Array} octets bloc compressé
 * @param {object} p { nbPoints, formatPoint, longueurPoint, echelle, decalage, origine }
 */
function decoderBloc(lazPerf, octets, p) {
  const { nbPoints, formatPoint, longueurPoint, echelle, decalage, origine } = p;

  // Décalages dans l'enregistrement de point LAS. Deux familles incompatibles :
  // les formats 0-5 (hérités) et 6-10 (LAS 1.4). L'IGN diffuse du format 6.
  const dIntensite = 12;
  const dRetour = 14;
  const dClasse = formatPoint >= 6 ? 16 : 15;
  const bitsRetour = formatPoint >= 6 ? 4 : 3;

  const src = lazPerf._malloc(octets.byteLength);
  lazPerf.HEAPU8.set(octets, src);
  const dst = lazPerf._malloc(longueurPoint);

  const decodeur = new lazPerf.ChunkDecoder();
  decodeur.open(formatPoint, longueurPoint, src);

  const x = new Float32Array(nbPoints);
  const y = new Float32Array(nbPoints);
  const z = new Float32Array(nbPoints);
  const cls = new Uint8Array(nbPoints);
  const intensite = new Uint16Array(nbPoints);
  const retour = new Uint8Array(nbPoints);

  const sx = echelle[0], sy = echelle[1], sz = echelle[2];
  const ox = decalage[0], oy = decalage[1], oz = decalage[2];
  const gx = origine[0], gy = origine[1], gz = origine[2];

  // Une seule vue sur le tas WASM, réutilisée à chaque point : la recréer des
  // millions de fois coûterait plus cher que la décompression elle-même.
  //
  // Mais le tas peut grandir en cours de route — laz-perf alloue ses tampons
  // internes à la volée. Une croissance **détache** l'ArrayBuffer sous-jacent
  // et toute vue existante devient inutilisable (« Cannot perform
  // DataView.prototype.getInt32 on a detached ArrayBuffer »). Le pointeur `dst`,
  // lui, reste valide : seul le tampon JS est remplacé. On compare donc son
  // identité à chaque tour — un test de référence, négligeable — et on
  // reconstruit la vue quand elle a bougé.
  let tampon = lazPerf.HEAPU8.buffer;
  let vue = new DataView(tampon, dst, longueurPoint);

  for (let i = 0; i < nbPoints; i++) {
    decodeur.getPoint(dst);

    if (lazPerf.HEAPU8.buffer !== tampon) {
      tampon = lazPerf.HEAPU8.buffer;
      vue = new DataView(tampon, dst, longueurPoint);
    }

    // Coordonnées ramenées à une origine locale AVANT conversion en Float32 :
    // en Lambert-93 les Y valent 6,2 millions, ce qu'un flottant 32 bits ne
    // résout qu'à ~0,5 m. Relatives à l'origine de la zone, elles tombent sous
    // le millier de mètres et gardent une précision submillimétrique.
    x[i] = vue.getInt32(0, true) * sx + ox - gx;
    y[i] = vue.getInt32(4, true) * sy + oy - gy;
    z[i] = vue.getInt32(8, true) * sz + oz - gz;

    intensite[i] = vue.getUint16(dIntensite, true);
    cls[i] = vue.getUint8(dClasse);

    const b = vue.getUint8(dRetour);
    retour[i] = bitsRetour === 4
      ? (b & 0x0f) | (((b >> 4) & 0x0f) << 4)
      : (b & 0x07) | (((b >> 3) & 0x07) << 4);
  }

  decodeur.delete();
  lazPerf._free(src);
  lazPerf._free(dst);

  return { nbPoints, x, y, z, cls, intensite, retour };
}

/**
 * Corps du Worker. Sérialisée puis exécutée dans le blob — ne ferme sur rien,
 * `decoderBloc` lui étant concaténée séparément.
 */
function corpsDecodeur() {
  let lazPerf = null;

  self.onmessage = async (ev) => {
    const msg = ev.data;

    if (msg.type === 'init') {
      // Sans ce try, une erreur d'initialisation rejetterait silencieusement ce
      // gestionnaire `async` : aucun message ne partirait, `onerror` ne se
      // déclencherait pas, et le fil principal attendrait indéfiniment un
      // « pret » qui ne vient jamais.
      try {
        lazPerf = await createLazPerf({ wasmBinary: msg.wasmBinary });
        self.postMessage({ type: 'pret' });
      } catch (e) {
        self.postMessage({ type: 'echecInit', message: (e && e.message) || String(e) });
      }
      return;
    }

    if (msg.type !== 'decoder') return;

    try {
      const r = decoderBloc(lazPerf, new Uint8Array(msg.octets), msg);
      self.postMessage(
        { type: 'decode', id: msg.id, ...r },
        [r.x.buffer, r.y.buffer, r.z.buffer, r.cls.buffer, r.intensite.buffer, r.retour.buffer],
      );
    } catch (e) {
      self.postMessage({ type: 'erreur', id: msg.id, message: (e && e.message) || String(e) });
    }
  };
}

const DECODEUR = {
  decoderBloc,

  /**
   * Source complet et autonome d'un worker de décompression.
   * `lazPerfJs` est la chaîne exposée par `vendor/lazperf/lazperf-embarque.js`.
   */
  sourceWorker(lazPerfJs) {
    // `decoderBloc` est posée en position d'instruction, sans parenthèses : elle
    // devient une déclaration de fonction et son nom est donc lié dans la portée
    // du worker. Entre parenthèses ce serait une expression de fonction nommée,
    // dont le nom n'est visible que depuis son propre corps — `corpsDecodeur`
    // ne la trouverait pas.
    return `${lazPerfJs}\n${decoderBloc}\n;(${corpsDecodeur})();\n`;
  },
};
