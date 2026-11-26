// La rampe de couleur « Hauteur/sol » de la 3D, réglable par l'utilisateur. Un **état** : un mode, des limites en mètres et une
// couleur par tranche (N limites, N+1 couleurs) :
//   · `paliers` : chaque tranche est d'une seule couleur, des marches franches aux limites (on lit « à partir de quelle hauteur »)
//   · `degrade` : la couleur de la tranche i est atteinte à la limite i (la première à 0 m), fondue avec la suivante
// Le shader ne connaît pas la formule : il lit une **texture de 1024 couleurs** (0 à 50 m, 5 cm par case) que `texels` remplit.
// Pur : aucun DOM. L'état par défaut, `classique()`, redonne exactement l'ancienne rampe sombre, jaune, rouge (8 m).

const RAMPE_HAUTEUR = (() => {
  const DEFAUT = 8, PORTEE = 50, LARGEUR = 1024, PAS = 0.5, MAX_BORNES = 11, MIN_BORNE_H = 5;
  const SOL = '#2e3038', JAUNE = '#e6b847', ROUGE = '#f25940';
  const HEX = /^#[0-9a-fA-F]{6}$/;

  const arrondi = (h) => Math.round(h / PAS) * PAS;   // le pas d'une retouche à la main
  const dixieme = (h) => Math.round(h * 10) / 10;     // la précision d'un état (et du lien)
  const dansPortee = (h) => Math.min(PORTEE, Math.max(PAS, dixieme(h)));
  const rvb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const hex = (c) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
  const mixer = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

  /** Un nombre en mètres à la française : virgule décimale, une décimale au plus. */
  const formaterM = (x) => `${Number.isInteger(x) ? x : (Math.round(x * 10) / 10).toString().replace('.', ',')} m`;

  /** Bleu (bas) vers rouge (haut) sur 0 à 50 m : la teinte de l'arc-en-ciel à cette hauteur (HSL, saturation 0,8, clarté 0,5). */
  function arcEnCiel(h) {
    const teinte = 240 - 240 * Math.min(1, Math.max(0, h / PORTEE));
    const f = (n) => { const k = (n + teinte / 30) % 12; return 0.5 - 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return hex([f(0), f(8), f(4)]);
  }

  /** La borne de l'ancien curseur : un entier dans [5, 50], 8 si ce n'est pas un nombre. */
  function borne(v) {
    const x = typeof v === 'number' ? v : NaN;
    return Number.isFinite(x) ? Math.min(PORTEE, Math.max(MIN_BORNE_H, Math.round(x))) : DEFAUT;
  }

  /** L'ancienne rampe : sombre à 0 m, jaune à 35 % de la borne, rouge à la borne. */
  const classique = (h) => ({ mode: 'degrade', bornes: [0.35 * borne(h), borne(h)], couleurs: [SOL, JAUNE, ROUGE] });

  const PRESETS = {
    classique,
    seuil: () => ({ mode: 'paliers', bornes: [0.5, 20], couleurs: [SOL, JAUNE, ROUGE] }),
    'arc-en-ciel': () => ({ mode: 'paliers', bornes: [5, 10, 20, 30], couleurs: [2.5, 7.5, 15, 25, 40].map(arcEnCiel) }),
    daltonien: () => ({ mode: 'paliers', bornes: [5, 10, 20, 30], couleurs: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] }),
  };
  const preset = (nom) => (PRESETS[nom] || classique)();

  /**
   * Un état sûr : mode connu, limites triées, arrondies au dixième de mètre, dans [0,5 ; 50], écartées d'au moins 0,5 m, 1 à 11 ;
   * couleurs `#rrggbb` en minuscules (les fausses sont refaites). Tout ce qui n'est pas un état rend le classique.
   */
  function normaliser(e) {
    if (!e || !Array.isArray(e.bornes) || !e.bornes.length) return classique();
    const bornes = [];
    const indices = [];
    e.bornes.map((b, i) => [dansPortee(Number(b)), i]).filter(([b]) => Number.isFinite(b)).sort((x, y) => x[0] - y[0]).forEach(([b, i]) => {
      if (bornes.length < MAX_BORNES && (!bornes.length || b - bornes[bornes.length - 1] >= PAS)) { bornes.push(b); indices.push(i); }
    });
    if (!bornes.length) return classique();
    const brut = Array.isArray(e.couleurs) ? e.couleurs : [];
    const couleurs = [brut[0], ...indices.map((i) => brut[i + 1])].map((c, k) => (HEX.test(c) ? c.toLowerCase() : arcEnCiel(k === 0 ? 1 : bornes[k - 1])));
    return { mode: e.mode === 'paliers' ? 'paliers' : 'degrade', bornes, couleurs };
  }

  /** La couleur (RVB, 0 à 1) d'un point à `h` mètres au-dessus du sol. */
  function couleur(h, e) {
    const { mode, bornes, couleurs } = e;
    let i = 0;
    while (i < bornes.length && h >= bornes[i]) i++;   // la tranche : de 0 à `i`
    if (mode === 'paliers') return rvb(couleurs[i]);
    if (i >= bornes.length) return rvb(couleurs[bornes.length]);
    const bas = i === 0 ? 0 : bornes[i - 1];
    return mixer(rvb(couleurs[i]), rvb(couleurs[i + 1]), (h - bas) / (bornes[i] - bas));
  }

  /** La texture de la rampe : 1024 couleurs RGBA (8 bits) de 0 à 50 m ; au-delà, la dernière. */
  function texels(e) {
    const px = new Uint8Array(LARGEUR * 4);
    for (let i = 0; i < LARGEUR; i++) {
      couleur((i + 0.5) / LARGEUR * PORTEE, e).forEach((v, k) => { px[i * 4 + k] = Math.round(v * 255); });
      px[i * 4 + 3] = 255;
    }
    return px;
  }

  /** Coupe une tranche à `h` : la tranche du haut reçoit la teinte d'arc-en-ciel (paliers) ou la couleur que la rampe avait là (dégradé). */
  function ajouterBorne(e, h) {
    const b = Math.min(PORTEE, Math.max(PAS, arrondi(h)));
    if (e.bornes.length >= MAX_BORNES || e.bornes.some((x) => Math.abs(x - b) < PAS)) return e;
    const i = e.bornes.filter((x) => x < b).length;
    const nouvelle = e.mode === 'paliers' ? arcEnCiel(b) : hex(couleur(b, e));
    return { mode: e.mode, bornes: [...e.bornes.slice(0, i), b, ...e.bornes.slice(i)], couleurs: [...e.couleurs.slice(0, i + 1), nouvelle, ...e.couleurs.slice(i + 1)] };
  }

  /** Retire la limite `i` : la tranche du dessus disparaît dans celle du dessous. Jamais la dernière limite. */
  function retirerBorne(e, i) {
    if (e.bornes.length <= 1 || i < 0 || i >= e.bornes.length) return e;
    return { mode: e.mode, bornes: e.bornes.filter((_, k) => k !== i), couleurs: e.couleurs.filter((_, k) => k !== i + 1) };
  }

  /** Déplace la limite `i` à `h` : arrondie à 0,5 m, sans passer ses voisines (0,5 m d'écart) ni sortir de [0,5 ; 50]. */
  function deplacerBorne(e, i, h) {
    if (i < 0 || i >= e.bornes.length) return e;
    const bas = i === 0 ? PAS : e.bornes[i - 1] + PAS;
    const haut = i === e.bornes.length - 1 ? PORTEE : e.bornes[i + 1] - PAS;
    const b = Math.min(haut, Math.max(bas, arrondi(h)));
    return { ...e, bornes: e.bornes.map((x, k) => (k === i ? b : x)) };
  }

  /** La couleur de la tranche `i`, si elle est valide. */
  function colorerBande(e, i, c) {
    if (!HEX.test(c) || i < 0 || i >= e.couleurs.length) return e;
    return { ...e, couleurs: e.couleurs.map((x, k) => (k === i ? c.toLowerCase() : x)) };
  }

  const changerMode = (e, m) => ({ ...e, mode: m === 'paliers' ? 'paliers' : 'degrade' });

  const egal = (a, b) => JSON.stringify(normaliser(a)) === JSON.stringify(normaliser(b));
  const estDefaut = (e) => egal(e, classique());

  /** Pour le lien : `p_111111_5-222222_12.5-333333` (mode, première couleur, puis limite-couleur) : lettres, chiffres, `_ . -` seulement. */
  function ecrire(e) {
    const n = normaliser(e);
    const mm = (x) => String(x);
    return [n.mode === 'paliers' ? 'p' : 'd', n.couleurs[0].slice(1), ...n.bornes.map((b, i) => `${mm(b)}-${n.couleurs[i + 1].slice(1)}`)].join('_');
  }

  /** L'état d'un texte de lien, ou `null` si la moindre partie est abîmée (jamais à moitié). */
  function lire(t) {
    const m = /^([dp])_([0-9a-f]{6})((?:_\d{1,2}(?:\.\d)?-[0-9a-f]{6}){1,11})$/.exec(typeof t === 'string' ? t : '');
    if (!m) return null;
    const bornes = [], couleurs = [`#${m[2]}`];
    for (const part of m[3].slice(1).split('_')) {
      const [b, c] = part.split('-');
      bornes.push(Number(b));
      couleurs.push(`#${c}`);
    }
    if (bornes.some((b, i) => b < PAS || b > PORTEE || (i && b - bornes[i - 1] < PAS - 1e-9))) return null;
    return { mode: m[1] === 'p' ? 'paliers' : 'degrade', bornes, couleurs };
  }

  /** La légende en HTML (valeurs et couleurs validées, sans entrée libre) : tranches en paliers, couleurs atteintes en dégradé. */
  function legendeHtml(e) {
    const n = normaliser(e);
    const puce = (c, texte) => `<span class="rampe-puce"><i style="background:${c}"></i>${texte}</span>`;
    if (n.mode === 'degrade') return n.couleurs.map((c, i) => puce(c, formaterM(i === 0 ? 0 : n.bornes[i - 1]))).join(' ');
    return n.couleurs.map((c, i) => puce(c, i === n.bornes.length ? `${formaterM(n.bornes[i - 1])} et plus`
      : `${i === 0 ? 0 : String(n.bornes[i - 1]).replace('.', ',')} à ${formaterM(n.bornes[i])}`)).join(' ');
  }

  return {
    defaut: DEFAUT, portee: PORTEE, largeur: LARGEUR, pas: PAS, maxBornes: MAX_BORNES, couleurs: { sol: SOL, jaune: JAUNE, rouge: ROUGE },
    borne, classique, preset, normaliser, couleur, texels, arcEnCiel, ajouterBorne, retirerBorne, deplacerBorne, colorerBande, changerMode,
    egal, estDefaut, ecrire, lire, legendeHtml, formaterM,
  };
})();
