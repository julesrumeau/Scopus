// L'onglet 3D : le nuage de la zone vue sur la carte. Rien n'est téléchargé pour lui : ce sont les points
// déjà là pour le relief, échantillonnés par le worker sous un plafond (spec 2026-09-27-vue-3d-design).
// Fabrique à dépendances explicites : ce qui change au fil du temps (vue, état du relief) arrive par des
// fonctions, jamais par des variables recopiées.

function creerNuage3D(d) {
  const { $, vue3d, relief, flux, etat, ATTENTE, FLUX_CHOIX, CONFIG, milliers, surMobile, classesMasquees,
    vueCourante, dernierEtat, reliefAJour, majLegende, majHUD, majAttributNuage, majLien,
    carte, projVue, majVueFlux, basculerVue, LIEN, RECTANGLE_3D, apresNuage } = d;

  // ── L'onglet 3D : le nuage de la zone vue sur la carte ──
  // Rien n'est téléchargé pour lui : ce sont les points déjà là pour le
  // relief, échantillonnés par le worker sous un plafond. Le nuage reste figé
  // tant qu'on est en 3D ; revenu en 3D sans que la carte ait bougé, on
  // garde le même, sinon on le reconstruit (spec 2026-09-27-vue-3d-design).
  $('section-affichage').hidden = false;
  $('section-vide-3d').hidden = true;
  let budget3D = surMobile() ? CONFIG.rendu.budget3DMobile : CONFIG.rendu.budget3D;
  $('vue-budget3d').value = budget3D / 1e6;
  $('val-vue-budget3d').textContent = `${budget3D / 1e6} M`;
  $('vue-edl').checked = CONFIG.rendu.edl.actif;
  const avis3D = (texte) => {
    $('avis-3d').hidden = !texte;
    $('avis-3d').textContent = texte || '';
  };
  let cleVueConstruite = null, pointsConstruits = -1, construction = null, minuteurAffinage = null;

  /** Ce qui fait la vue du nuage : le rectangle et le plafond. Qu'elle change, et tout est à refaire, caméra comprise. */
  const cleVue = (e) => e && JSON.stringify([e.xmin, e.xmax, e.ymin, e.ymax].map((v) => Math.round(v)).concat(budget3D));

  /**
   * Bâtit le nuage de la zone. `progressif` : même vue, des blocs sont arrivés depuis — on remplace le nuage
   * en silence (ni voile d'attente, ni retour de la caméra), qui reste où l'on l'avait mise.
   */
  async function batir(e, progressif) {
    try {
      const etapes = async (etape) => {
        // La surface de la vue d'abord, si la couleur la lit (hauteur, relief drapé) : le relief de la
        // carte a pu rester en retard (en pause pendant la 3D, ou un calcul encore en cours).
        if (!progressif || ['hauteur', 'relief'].includes(CONFIG.rendu.coloration)) {
          await etape('Relief de la vue…');
          await reliefAJour();
        }
        await etape('Nuage de la vue…', 'les points déjà chargés pour le relief');
        const r = await relief.nuage3d(e, budget3D, [...flux.voulues()]);
        if (r && !r.vide) {
          await etape('Nuage vers la carte graphique…', `${milliers(r.n)} points`);
          r.parClasse = new Map(r.parClasse);
          vue3d.definirNuage(r, r.hauteur, { cadrer: !progressif });
        }
        return r;
      };
      const n = await (progressif ? etapes(() => {}) : ATTENTE.pendant('Nuage 3D', etapes));
      if (!n || n.vide) {
        // Rien encore : la zone se charge, ou n'a pas de LiDAR, ou n'a vraiment aucun point.
        const e2 = dernierEtat();
        avis3D(e2?.sansLidar ? 'Pas de LiDAR HD dans cette zone.' : n?.raison || (!e2 || !e2.points ? 'Chargement des points de la zone…' : 'Aucun point dans cette zone.'));
        return;
      }
      avis3D(null);
      etat.nuage = n;
      cleVueConstruite = cleVue(e);
      vue3d.definirClassesMasquees(classesMasquees);
      apresNuage();
      majLegende();
      majHUD();
      await majAttributNuage();
    } catch (err) {
      console.error(err);
      avis3D(`Le nuage 3D n’a pas pu être construit — ${err.message}`);
    }
  }

  const construire = async () => {
    if (!vue3d) return;
    if (construction) return construction;
    const e = vueCourante();
    const tropLarge = !e || FLUX_CHOIX.surfaceKm2(e) > CONFIG.flux.surfaceMaxPointsKm2;
    const points = dernierEtat() ? dernierEtat().points : 0;
    const memeVue = !tropLarge && cleVue(e) === cleVueConstruite && !!etat.nuage;
    // Rien n'a bougé : ni la vue, ni le plafond, ni les points reçus (un nuage bâti en plein chargement ne
    // doit pas rester clairsemé une fois tout arrivé).
    if (memeVue && points === pointsConstruits) return;
    if (!memeVue) {
      vue3d.vider();
      etat.nuage = null;
      cleVueConstruite = null;
      majLegende();
      majHUD();
    }
    if (tropLarge) { avis3D('Zoomez sur la carte pour afficher le nuage en 3D.'); return; }
    // Une autre zone : la caméra se pose sur la zone et l'échelle de la carte (sauf une pose venue d'un lien).
    if (!memeVue) vue3d.pose3d.definirDepuisRectangle(e);
    pointsConstruits = points;
    construction = batir(e, memeVue).finally(() => { construction = null; planifierAffinage(); });
    return construction;
  };

  /**
   * Le flux a changé d'état : si des blocs sont arrivés pendant qu'on est en 3D, le nuage s'étoffe tout seul, à
   * intervalles (le renvoyer à la carte graphique pèse : une fois par `affinage3dMs` au plus).
   */
  function etatChange(e) {
    if (!vue3d || $('vue-3d').hidden || minuteurAffinage || construction) return;
    if (!(e.attente > 0 || e.points !== pointsConstruits)) return;
    minuteurAffinage = setTimeout(() => {
      minuteurAffinage = null;
      if (!$('vue-3d').hidden) construire();
    }, CONFIG.rendu.affinage3dMs);
  }
  const planifierAffinage = () => { if (dernierEtat()) etatChange(dernierEtat()); };

  /**
   * Un lien pris en 3D : la zone et l'échelle du lien, la caméra à son orientation et son inclinaison. Le
   * rectangle est calculé ici (centre, échelle, taille de la scène), pas lu sur la carte, dont Leaflet arrondit
   * le zoom ; la carte est déjà à la bonne zone quand on en revient.
   */
  function ouvrirDepuisLien(lien) {
    if (!vue3d) return;   // sans WebGL2, la carte reste
    carte.invalider();
    carte.map.setView([lien.lat, lien.lon], lien.zoom, { animate: false });
    const c = projVue().versLocal(lien.lon, lien.lat);
    const mpp = LIEN.resolutionDepuisZoom(lien.zoom, lien.lat);
    const taille = carte.map.getSize();
    majVueFlux(RECTANGLE_3D.depuisCentre(c, mpp, taille.x, taille.y));
    const cam = LIEN.cameraDepuisOrientation(lien.orientation, lien.inclinaison);
    vue3d.pose3d.definir({ x: c.x, y: c.y, mpp, azimut: cam.azimut, elevation: cam.elevation });
    basculerVue('3d');
  }

  $('vue-budget3d').addEventListener('input', (e) => { $('val-vue-budget3d').textContent = `${e.target.value} M`; });
  $('vue-budget3d').addEventListener('change', (e) => {
    budget3D = Number(e.target.value) * 1e6;
    if (!$('vue-3d').hidden) construire();
    majLien();   // le plafond de points est dans le lien
  });

  return {
    construire,
    etatChange,
    ouvrirDepuisLien,
    /** Le plafond de points, en nombre de points. */
    budget: () => budget3D,
  };
}
