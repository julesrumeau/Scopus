// Le lien partageable : le fragment de l'adresse suit la vue (au format d'osm.org, `#map=zoom/lat/lon`,
// complété comme MapLibre en 3D par `/orientation/inclinaison`), plus ce qu'on a posé (bande du profil,
// point sélectionné, règle, réglages : voir `lien.js`). Il suit l'onglet affiché : la carte, ou le point
// visé et les angles de la caméra 3D. Aussi : le menu « Partager » (copier le lien, ouvrir sur osm.org).

function creerPartage(d) {
  const { $, LIEN, carte, vue3d, etat, projVue, statut, outils } = d;   // `carte`, `projVue`, `outils` : des fonctions (nés plus tard dans le démarrage)

  //
  // Le lien porte la **vue**, au format d'osm.org (`#map=zoom/lat/lon`) complété
  // comme MapLibre en 3D (`/orientation/inclinaison`) — voir `lien.js`. Il suit
  // l'onglet affiché : la carte, ou le point visé et les angles de la caméra 3D.

  /** La vue de l'onglet affiché, dans les termes du lien. `null` si rien à dire. */
  function vueDuLien() {
    const onglet = $('panneau').dataset.vue;
    if (onglet === '3d') {
      const c = vue3d?.camera();
      if (!c) return null;
      const { lon, lat } = projVue().versGeo(c.x, c.y);
      return {
        lat, lon, zoom: LIEN.zoomDepuisResolution(c.metresParPixelCss, lat),
        ...LIEN.orientationDepuisCamera(c.azimut, c.elevation),
      };
    }
    const centre = carte().map.getCenter();
    return { lat: centre.lat, lon: centre.lng, zoom: carte().map.getZoom() };
  }

  // ── Le lien du profil (R2) ───────────────────────────────────────────────────
  // L'état de la coupe et de la sélection est dans le bloc du mode vue (la bande, la modale, le
  // graphique) : il pose ces deux fonctions à sa fin. Un lien ouvert avant cela attend dans
  // `partageEnAttente`, que le bloc consomme dès qu'il est prêt.
  const liaisons = { etatPartageVue: null, appliquerPartageVue: null };   // posés par le bloc du relief : l'état de la coupe, et « remet partageEnAttente »
    let partageEnAttente = null;

  /** Ce que le fragment porte en plus de la vue : la coupe, sa mesure, la sélection, les classes du sol. */
  function etatPartage() {
    const e = liaisons.etatPartageVue ? liaisons.etatPartageVue() : {};
    if (outils().selection()) e.sel = { lat: outils().selection().lat, lon: outils().selection().lon };
    if (outils().pointsMesure().length) {
      e.regle = outils().pointsMesure().map((q) => { const g = projVue().versGeo(q.x, q.y); return { lat: g.lat, lon: g.lon }; });
    }
    return e;
  }

  /** Un lien ouvert : s'il porte quelque chose de la coupe ou de la sélection, le remettre. */
  function demanderPartage(partage) {
    if (!partage || !Object.keys(partage).length) return;
    partageEnAttente = partage;
    etat.restaurationPartage = true;
    liaisons.appliquerPartageVue?.();
  }

  /**
   * Réécrit le fragment d'après la vue affichée. `replaceState`, jamais
   * `location.hash =` : le second empile une entrée d'historique à chaque
   * déplacement, et le bouton Retour deviendrait inutilisable.
   */
  function ecrireLien() {
    clearTimeout(minuteurLien);
    // L'accueil ouvert, la carte bouge toute seule (cadrage initial) : écrire un
    // fragment ferait sauter l'accueil au prochain rechargement.
    if (!$('accueil').hidden) return;
    // Un lien qui vient d'être ouvert attend le chargement de sa dalle pour
    // s'appliquer en 2D et en 3D (`appliquerVueDuLien`) : ne pas l'écraser
    // d'ici là par la vue de carte, qui n'en garde ni l'échelle fine ni les angles.
    if (etat.restaurationPartage) return;
    const v = vueDuLien();
    if (!v) return;
    const fragment = '#' + LIEN.ecrire(v) + LIEN.ecrirePartage(etatPartage());
    if (fragment !== location.hash) history.replaceState(null, '', fragment);
  }

  /**
   * Regroupe les demandes : la 3D en émet une par image pendant une animation,
   * et Safari refuse plus de 100 `replaceState` par 30 secondes.
   */
  let minuteurLien = 0;
  function majLien() {
    clearTimeout(minuteurLien);
    minuteurLien = setTimeout(ecrireLien, 300);
  }

  /** Ouvre un lien : le lien cadre la carte, et le relief de la vue suit. */
  function ouvrirLien(lien) {
    requestAnimationFrame(() => { carte().invalider(); carte().map.setView([lien.lat, lien.lon], lien.zoom); });
    demanderPartage(LIEN.lirePartage(location.hash));
  }

  /**
   * Copie le lien courant. `navigator.clipboard` peut refuser en silence — pas
   * seulement en `file://`, mesuré aussi en headless sans geste utilisateur — et
   * l'échec ne doit pas priver du lien : `prompt()` repose sur aucune permission
   * et marche partout, texte déjà sélectionné pour un Ctrl+C manuel.
   */
  async function copierLien() {
    ecrireLien();   // la dernière demande peut encore attendre son minuteur
    try {
      await navigator.clipboard.writeText(location.href);
      statut('Lien copié dans le presse-papiers');
    } catch {
      prompt('Copiez ce lien :', location.href);
    }
  }

  /**
   * Ouvre la même vue sur osm.org — le seul lien sortant, délibérément : osm.org
   * mène à iD, JOSM et au reste de l'écosystème par son propre bouton
   * « Modifier ». Zoom entier et sans angles, ce qu'osm.org sait afficher.
   */
  function ouvrirDansOSM() {
    const v = vueDuLien();
    if (!v) return;
    const fragment = LIEN.ecrire({ zoom: Math.round(v.zoom), lat: v.lat, lon: v.lon });
    window.open(`https://www.openstreetmap.org/#${fragment}`, '_blank', 'noopener');
  }

  function basculerMenuPartage(ouvrir = $('menu-partager').hidden) {
    $('menu-partager').hidden = !ouvrir;
    $('btn-partager').setAttribute('aria-expanded', String(ouvrir));
  }
  $('btn-partager').addEventListener('click', () => basculerMenuPartage());
  $('btn-copier-lien').addEventListener('click', () => { basculerMenuPartage(false); copierLien(); });
  $('btn-ouvrir-osm').addEventListener('click', () => { basculerMenuPartage(false); ouvrirDansOSM(); });
  // Un clic ailleurs ou Échap referme le menu, comme tout menu.
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.partage')) basculerMenuPartage(false);
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') basculerMenuPartage(false); });

  return {
    majLien,
    ecrireLien,
    ouvrirLien,
    /** Ce que le bloc du relief pose en démarrant : `etatPartageVue` et `appliquerPartageVue`. */
    liaisons,
    /** Le lien reçu au démarrage, en attente du bloc du relief ; `prendre` le rend (une seule fois). */
    enAttente: () => partageEnAttente,
    prendre() { const p = partageEnAttente; partageEnAttente = null; return p; },
  };
}
