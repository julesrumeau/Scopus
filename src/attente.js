// Voile d'attente pour les calculs qui bloquent le fil principal.
//
// LE PROBLÈME, et il n'est pas cosmétique. Ces traitements sont **synchrones** :
// tant qu'ils tournent, le navigateur ne répond plus à rien — ni au défilement,
// ni aux clics, ni au redimensionnement. Sans rien à l'écran, l'onglet paraît
// planté, et l'utilisateur relance ou ferme.
//
// CE QUI EST LONG, relevé dans le code :
//
//   RASTER.finaliser         12 passes de comblement sur 16 M de cellules,
//                            plus la pente — le plus lourd du lot
//   DETECTION.detecter       morphologie et étiquetage sur 16 M de cellules
//   SENTIERS.detecterSentiers 3,8 s mesurés sur une dalle
//   RELIEF.svf               8 directions × 20 pas sur 4 M de cellules
//   RELIEF.preparer          une passe sur 16 M de cellules
//   Vue3D.definirNuage       4,4 M points entrelacés puis téléversés
//   RASTER.hauteurParPoint   une passe sur tous les points du nuage
//
// POURQUOI LA ROUE TOURNE QUAND MÊME. Une animation CSS qui ne touche que
// `transform` est portée par le **compositeur**, un autre fil que celui du
// JavaScript. Elle continue donc de tourner pendant que le fil principal est
// bloqué — à condition d'avoir démarré avant. D'où `respirer()` : on montre le
// voile, on laisse passer deux images pour qu'il soit peint et l'animation
// lancée, et seulement après on bloque.
//
// Ne jamais animer autre chose que `transform` ou `opacity` dans ce voile :
// toute propriété qui demande un recalcul de style ou une mise en page
// repasserait par le fil principal, et la roue se figerait — ce qui est pire
// que pas de roue du tout.

const ATTENTE = (() => {
'use strict';

let profondeur = 0;

const el = (id) => document.getElementById(id);

/** Laisse le navigateur peindre. Deux images : la première n'est pas encore à
 *  l'écran quand `requestAnimationFrame` rend la main. */
const respirer = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function ecrire(titre, detail) {
  if (titre != null) el('attente-titre').textContent = titre;
  el('attente-detail').textContent = detail || '';
}

/**
 * Exécute un traitement long derrière le voile.
 *
 * `travail` reçoit une fonction `etape(texte)` à **attendre** entre deux
 * tranches : elle met le libellé à jour et rend la main au navigateur, le temps
 * qu'il l'affiche. Au milieu d'un calcul synchrone, changer le texte sans
 * attendre ne produirait rien — rien n'est peint tant que la pile n'est pas
 * vide.
 *
 * Le voile se retire quoi qu'il arrive, y compris sur exception, et l'erreur
 * poursuit sa route.
 */
async function pendant(titre, travail, detail = '') {
  profondeur++;
  ecrire(titre, detail);
  el('attente').hidden = false;
  await respirer();

  const etape = async (texte, sous = '') => { ecrire(texte, sous); await respirer(); };

  try {
    return await travail(etape);
  } finally {
    profondeur--;
    // Un traitement enveloppé peut en appeler un autre : seul le plus extérieur
    // a le droit de retirer le voile.
    if (profondeur <= 0) { profondeur = 0; el('attente').hidden = true; }
  }
}

return { pendant, respirer };
})();
