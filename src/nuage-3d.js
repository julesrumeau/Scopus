// L'onglet 3D : le nuage de la zone vue sur la carte. Rien n'est téléchargé pour lui : ce sont les points
// déjà là pour le relief, échantillonnés par le worker sous un plafond (spec 2026-09-27-vue-3d-design).
// Fabrique à dépendances explicites : ce qui change au fil du temps (vue, état du relief) arrive par des
// fonctions, jamais par des variables recopiées.

function creerNuage3D(d) {
  const { $, vue3d, relief, flux, etat, ATTENTE, FLUX_CHOIX, CONFIG, milliers, surMobile, classesMasquees,
    vueCourante, dernierEtat, reliefAJour, majLegende, majHUD, majAttributNuage, majLien } = d;

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
  let empriseNuage = null, construction = null;
  const construire = async () => {
    if (!vue3d) return;
    if (construction) return construction;
    const e = vueCourante();
    const tropLarge = !e || FLUX_CHOIX.surfaceKm2(e) > CONFIG.flux.surfaceMaxPointsKm2;
    // Reconstruit si la vue a bougé, si le plafond a changé, ou si des points
    // sont arrivés depuis : un nuage bâti en plein chargement ne doit pas
    // rester clairsemé une fois tout arrivé.
    const cle = e && JSON.stringify([e.xmin, e.xmax, e.ymin, e.ymax].map((v) => Math.round(v))
      .concat(budget3D, dernierEtat() ? dernierEtat().points : 0));
    if (!tropLarge && cle === empriseNuage && etat.nuage) return;   // rien n'a bougé
    vue3d.vider();
    etat.nuage = null;
    empriseNuage = null;
    majLegende();
    majHUD();
    if (tropLarge) { avis3D('Zoomez sur la carte pour afficher le nuage en 3D.'); return; }
    construction = (async () => {
      try {
        const n = await ATTENTE.pendant('Nuage 3D', async (etape) => {
          // La surface de la vue d'abord : hauteurs et drapé s'y lisent, et le
          // relief de la carte a pu rester en retard (en pause pendant la 3D,
          // ou un calcul encore en cours au moment de basculer).
          await etape('Relief de la vue…');
          await reliefAJour();
          await etape('Nuage de la vue…', 'les points déjà chargés pour le relief');
          const r = await relief.nuage3d(e, budget3D, [...flux.voulues()]);
          if (r && !r.vide) {
            await etape('Nuage vers la carte graphique…', `${milliers(r.n)} points`);
            r.parClasse = new Map(r.parClasse);
            vue3d.definirNuage(r, r.hauteur);
          }
          return r;
        });
        if (!n || n.vide) {
          avis3D(n?.raison || 'Zoomez sur la carte pour afficher le nuage en 3D.');
          return;
        }
        avis3D(null);
        etat.nuage = n;
        empriseNuage = cle;
        vue3d.definirClassesMasquees(classesMasquees);
        majLegende();
        majHUD();
        await majAttributNuage();
      } catch (err) {
        console.error(err);
        avis3D(`Le nuage 3D n’a pas pu être construit — ${err.message}`);
      } finally {
        construction = null;
      }
    })();
    return construction;
  };

  $('vue-budget3d').addEventListener('input', (e) => { $('val-vue-budget3d').textContent = `${e.target.value} M`; });
  $('vue-budget3d').addEventListener('change', (e) => {
    budget3D = Number(e.target.value) * 1e6;
    if (!$('vue-3d').hidden) construire();
    majLien();   // le plafond de points est dans le lien
  });

  return {
    construire,
    /** Le plafond de points, en nombre de points. */
    budget: () => budget3D,
  };
}
