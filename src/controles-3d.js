// Les gestes de la vue 3D : glisser, molette, pincement, double-clic, et les animations de caméra
// (pivot, orientation). Ne connaît de `Vue3D` que sa caméra (`cam`), son canevas, son nuage et quatre
// méthodes : `_repere`, `_rayonBrut`, `rayonEcran`, `_bouger`. Aucun WebGL ici : la géométrie du rendu
// reste dans `vue3d.js`, qui construit ce contrôleur et lui délègue l'orientation.

class ControlesVue3D {
  constructor(vue) {
    this.vue = vue;
    this._animation = 0;
    this._animationPivot = 0;
  }

  get cam() { return this.vue.cam; }
  get canvas() { return this.vue.canvas; }
  get nuage() { return this.vue.nuage; }
  get mode() { return this.vue.mode; }

  /**
   * Point du plan horizontal passant par la cible, sous un pixel donné.
   *
   * Ce plan sert de sol virtuel : il donne un point d'accroche stable pour
   * saisir le terrain et pour zoomer là où pointe le curseur, sans avoir à
   * relire le tampon de profondeur. À l'échelle où l'on inspecte une structure,
   * il colle de près au relief réel.
   *
   * Renvoie `null` en visée rasante, quand le rayon devient parallèle au plan
   * et que l'intersection part à l'infini.
   */
  _pointSousCurseur(ev) {
    const rayon = this.vue._rayonBrut(ev);
    if (!rayon) return null;
    const { oeil, dir } = rayon;

    if (Math.abs(dir[1]) < 1e-3) return null;
    const t = (this.cam.cible[1] - oeil[1]) / dir[1];
    if (!(t > 0)) return null;

    const p = [oeil[0] + dir[0] * t, this.cam.cible[1], oeil[2] + dir[2] * t];
    return p.every(Number.isFinite) ? p : null;
  }

  /**
   * Contrôles « à la Google Earth » : glisser déplace le terrain, la molette
   * zoome sous le curseur.
   *
   * L'inverse — glisser pour orbiter, molette vers le centre — est l'usage des
   * visionneuses 3D, mais il est pénible ici. On balaie un kilomètre carré à la
   * recherche de structures : le geste dominant est le déplacement, pas la
   * rotation, et l'onglet Carte se manipule déjà ainsi. Surtout, zoomer vers le
   * centre d'orbite éloigne de ce qu'on vient de repérer au bord de l'écran, et
   * oblige à alterner déplacement et zoom sans fin.
   */
  brancher() {
    const c = this.canvas;
    let glisse = null;

    // Pincement à deux doigts : `wheel` ne se déclenche jamais pour un geste
    // tactile réel — sans ce suivi, aucun zoom n'est possible au doigt. Un
    // deuxième doigt qui touche par accident pendant un glissé (la paume, un
    // pouce) est le cas courant à ne pas laisser corrompre le déplacement en
    // cours : avant ce garde, un pointeur en trop remplaçait `glisse` par sa
    // propre référence et son relâchement arrêtait tout le geste en cours,
    // ce qui rendait le déplacement erratique dès qu'un second contact
    // apparaissait — le mode courant sur un écran tactile.
    //
    // Les deux doigts portent aussi l'orientation : sur tactile, ni Maj ni
    // clic droit n'existent pour distinguer orbite et déplacement, donc rien
    // ne pouvait déclencher `glisse.orbite`. Le milieu des deux doigts qui
    // glisse pivote la vue — écarter ou rapprocher les doigts zoome en même
    // temps, les deux gestes se lisent indépendamment sur le même geste.
    const doigts = new Map();
    let pince = null;

    // Point de départ en pixels, pour distinguer un clic d'un glissé — un
    // clic en mode sélection vise un point, un glissé ne doit pas en viser un
    // au relâchement. `pinceUtilisee` fait pareil pour un pincement à deux
    // doigts qui se termine à un seul.
    let depart = null;
    let pinceUtilisee = false;

    const milieu = () => {
      const [a, b] = [...doigts.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const ecart = () => {
      const [a, b] = [...doigts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    c.addEventListener('pointerdown', (e) => {
      this.arreter();
      c.setPointerCapture(e.pointerId);
      doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (doigts.size >= 2) {
        glisse = null;
        depart = null;
        pinceUtilisee = true;
        const m = milieu();
        pince = { distance: ecart(), cx: m.x, cy: m.y };
        return;
      }
      depart = [e.clientX, e.clientY];
      const orbite = e.button === 1 || e.button === 2 || e.shiftKey;
      glisse = {
        x: e.clientX, y: e.clientY,
        // Bouton principal : déplacement. Clic droit, bouton du milieu ou
        // Maj+glissé : orbite. Trois voies parce que selon la souris ou le pavé
        // tactile, l'une des trois manque.
        orbite,
      };
    });

    c.addEventListener('pointermove', (e) => {
      if (doigts.has(e.pointerId)) doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pince && doigts.size >= 2) {
        const m = milieu();
        const d = ecart();

        // Zoom sur l'écart, ancré au milieu courant — recalculé à chaque
        // image, comme pour la molette, parce que ce milieu se déplace en
        // même temps que la vue pivote.
        if (pince.distance > 0) {
          const avant = this._pointSousCurseur({ clientX: m.x, clientY: m.y });
          const ancienne = this.cam.distance;
          this._zoomVers(avant, ancienne, ancienne * (pince.distance / d));
        }
        pince.distance = d;

        this.cam.azimut -= (m.x - pince.cx) * 0.006;
        this.cam.elevation = Math.max(-1.553, Math.min(1.553, this.cam.elevation + (m.y - pince.cy) * 0.006));
        pince.cx = m.x; pince.cy = m.y;

        this.vue._bouger();
        return;
      }

      if (!glisse) return;
      const dx = e.clientX - glisse.x;
      const dy = e.clientY - glisse.y;

      if (glisse.orbite) {
        this.cam.azimut -= dx * 0.006;
        // Bornes strictes : au zénith exact, le vecteur « haut » devient
        // colinéaire à l'axe de visée et lookAt produit une matrice dégénérée.
        // 89° laisse une vue quasi verticale sans l'atteindre.
        this.cam.elevation = Math.max(-1.553, Math.min(1.553, this.cam.elevation + dy * 0.006));
      } else {
        this._deplacer(glisse, e, dx, dy);
      }
      glisse.x = e.clientX; glisse.y = e.clientY;
      this.vue._bouger();
    });

    const relacher = (e) => {
      c.releasePointerCapture?.(e.pointerId);
      doigts.delete(e.pointerId);
      if (doigts.size < 2) pince = null;
      if (doigts.size === 1) {
        // Un doigt reste au sol : reprendre le glissé depuis sa position
        // actuelle, pas depuis le point de départ d'origine — sinon la vue
        // saute au relâchement du second doigt.
        const [pos] = doigts.values();
        glisse = { x: pos.x, y: pos.y, orbite: false };
      } else if (doigts.size === 0) {
        glisse = null;
      }
    };
    c.addEventListener('pointerup', relacher);
    c.addEventListener('pointercancel', relacher);
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const avant = this._pointSousCurseur(e);
      const ancienne = this.cam.distance;
      this._zoomVers(avant, ancienne, ancienne * Math.exp(e.deltaY * 0.0012));
      this.vue._bouger();
    }, { passive: false });

    c.addEventListener('click', (e) => {
      const bouge = pinceUtilisee ||
        (depart && Math.hypot(e.clientX - depart[0], e.clientY - depart[1]) > 4);
      pinceUtilisee = false;
      depart = null;
      if (bouge || this.mode === 'deplacement') return;
      const rayon = this.vue.rayonEcran(e);
      if (!rayon) return;
      if (this.mode === 'selection') this.vue.onSelectionPoint?.(rayon);
      else if (this.mode === 'mesure') this.vue.onPointMesure?.(rayon);
    });

    c.addEventListener('dblclick', (e) => {
      if (this.mode !== 'deplacement') return;
      this._recentrerPivot(e);
    });
  }

  /**
   * Replace le pivot d'orbite sur le point visé, sans toucher au zoom.
   * Déclenché par un double-clic explicite, pas au début de chaque geste
   * d'orbite : recalculer automatiquement à chaque Maj+glissé revient à
   * parier que le clic de départ tombe pile sur la cible. Retour utilisateur
   * du 22/08/2026, sur un cas concret : viser un bâtiment, Maj+glisser pour
   * en faire le tour, et perdre le bâtiment de vue parce que le clic de
   * départ — pas forcément exact — devenait le nouveau pivot. Un double-clic
   * délibéré, qu'on peut viser et refaire si raté, n'a pas ce défaut ; c'est
   * aussi le fonctionnement par défaut de Potree et CloudCompare.
   *
   * Le trajet est animé (`_animerPivot`), pas instantané : décaler le pivot
   * décale la caméra d'autant pour garder distance et angle inchangés (la
   * technique standard pour ne pas faire pivoter la vue au passage), mais
   * pour un point cliqué loin de l'ancien pivot, ce décalage reste un vrai
   * déplacement de caméra — visible d'un coup, il se lisait comme un saut.
   * Retour utilisateur du 22/08/2026.
   *
   * `_pointSousCurseur` intersecte un plan horizontal **infini** : en visée
   * presque rasante — typiquement en cliquant juste à côté du nuage, vers le
   * ciel ou le bord de la vue — le calcul reste valide mais rend un point à
   * des kilomètres. Le pivot s'y envolait. Un point hors de l'emprise réelle
   * de la dalle (marge de 50 m) est donc ignoré plutôt que suivi aveuglément
   * — le pivot reste où il était, ce qui ne se voit même pas, plutôt que de
   * sauter n'importe où. Retour utilisateur du 22/08/2026.
   */
  _recentrerPivot(ev) {
    const p = this._pointSousCurseur(ev);
    if (!p || !this.nuage) return;
    const o = this.nuage.origine, e = this.nuage.emprise, marge = 50;
    const x = p[0] + o[0], y = o[1] - p[2];
    if (x < e.xmin - marge || x > e.xmax + marge || y < e.ymin - marge || y > e.ymax + marge) return;
    this._animerPivot(p[0], p[2]);
  }

  /**
   * Anime `cam.cible[0]`/`[2]` vers `(x, z)` sur `duree` ms — jamais les
   * angles, à la différence de `_animerVers` : l'utilisateur est en train de
   * faire tourner la vue par son propre geste au même moment (voir
   * `pointermove`), les deux doivent progresser en même temps sans se
   * marcher dessus, d'où une animation et un handle séparés.
   */
  _animerPivot(x, z, duree = 200) {
    if (this._animationPivot) cancelAnimationFrame(this._animationPivot);
    const x0 = this.cam.cible[0], z0 = this.cam.cible[2];
    const dx = x - x0, dz = z - z0;
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;
    const t0 = performance.now();

    const pas = () => {
      const u = Math.min(1, (performance.now() - t0) / duree);
      const k = u * u * (3 - 2 * u);   // départ et arrivée amortis
      this.cam.cible[0] = x0 + dx * k;
      this.cam.cible[2] = z0 + dz * k;
      this.vue._bouger();
      this._animationPivot = u < 1 ? requestAnimationFrame(pas) : 0;
    };
    pas();
  }

  /**
   * Applique un zoom vers `voulue` (distance visée, avant plancher/plafond),
   * ancré sur `avant` (le point du plan visé avant le zoom, ou `null` en
   * visée rasante). Partagé par la molette et le pincement à deux doigts.
   *
   * Sous le plancher, la distance ne se bloque plus : la cible elle-même
   * avance dans l'axe de visée (« infinityDolly », le correctif documenté
   * par `camera-controls`, la référence three.js, pour ce symptôme précis —
   * sans lui, continuer à zoomer près d'un point donnait l'impression d'un
   * mur plutôt que de continuer à s'en approcher). Retour utilisateur du
   * 22/08/2026.
   */
  _zoomVers(avant, ancienne, voulue) {
    const MIN = 2, MAX = 6000;
    this.cam.distance = Math.max(MIN, Math.min(MAX, voulue));

    // Zoom sous le curseur : on rapproche la cible du point visé dans le même
    // rapport que la distance. Ce point reste donc immobile à l'écran, et
    // l'on plonge vers ce qu'on regarde au lieu de vers le centre.
    if (avant) {
      const k = this.cam.distance / ancienne;
      for (const i of [0, 2]) {
        this.cam.cible[i] = avant[i] + (this.cam.cible[i] - avant[i]) * k;
      }
    }

    if (voulue < MIN) {
      const { avant: dev } = this.vue._repere();
      const deficit = MIN - voulue;
      for (const i of [0, 1, 2]) this.cam.cible[i] += dev[i] * deficit;
    }
  }

  /**
   * Déplacement : le terrain suit le curseur.
   *
   * On mesure le point du plan sous le curseur avant et après le mouvement, et
   * l'on décale la cible de leur différence — la surface reste donc « collée »
   * au doigt, à n'importe quelle inclinaison. En visée rasante l'intersection
   * diverge, on retombe alors sur un déplacement à l'échelle de la distance.
   */
  _deplacer(glisse, ev, dx, dy) {
    const avant = this._pointSousCurseur({ clientX: glisse.x, clientY: glisse.y });
    const apres = this._pointSousCurseur(ev);

    if (avant && apres) {
      this.cam.cible[0] += avant[0] - apres[0];
      this.cam.cible[2] += avant[2] - apres[2];
      return;
    }

    const r = this.canvas.getBoundingClientRect();
    const k = 2 * this.cam.distance * Math.tan((FOV_Y_DEG * Math.PI / 180) / 2) / Math.max(1, r.height);
    const { droite, avant: dev } = this.vue._repere();
    // Composante horizontale de l'axe de visée : le déplacement vertical de la
    // souris avance ou recule au sol, il ne doit pas changer l'altitude visée.
    const sol = Math.hypot(dev[0], dev[2]) || 1;
    for (const i of [0, 2]) {
      this.cam.cible[i] -= droite[i] * dx * k;
      this.cam.cible[i] += (dev[i] / sol) * dy * k;
    }
  }

  /** Vue verticale, la plus lisible pour balayer une dalle. */
  vueDeDessus() {
    this._animerVers(0, 1.553);
  }

  /**
   * Amène la vue sur une direction du monde — ce que fait un clic sur la
   * boussole.
   *
   * Deux lectures possibles pour un point cardinal, opposées : « se placer au
   * nord » (le nord finit alors en bas de l'écran) ou « regarder vers le nord »
   * (il finit en haut). C'est la seconde qui est retenue, parce que le besoin
   * est de retrouver l'orientation d'une carte — le nord en haut. L'élévation ne
   * bouge pas : on veut pivoter, pas changer de point de vue.
   *
   * L'axe vertical, lui, ne peut se lire que comme un déplacement : on se met
   * au-dessus ou en dessous, l'azimut restant celui qu'on avait.
   */
  orienterVers(v) {
    if (Math.abs(v[1]) > 0.5) {
      this._animerVers(this.cam.azimut, v[1] > 0 ? 1.553 : -1.553);
    } else {
      // Inversion de `_repere` : l'axe de visée horizontal vaut (−sin a, −cos a).
      this._animerVers(Math.atan2(-v[0], -v[2]), this.cam.elevation);
    }
  }

  /**
   * Pivote la caméra jusqu'aux angles demandés, en un quart de seconde.
   *
   * Le rendu est à la demande — c'est ici la seule chose qui l'anime, et elle
   * s'arrête d'elle-même. Un saut instantané d'un quart de tour est
   * désorientant : sans le mouvement, rien ne dit si l'on a tourné à gauche ou à
   * droite, et il faut relire la scène entière pour s'y retrouver. C'est
   * précisément ce que la boussole cherche à éviter.
   */
  _animerVers(azimut, elevation, duree = 260) {
    this.arreter();
    const a0 = this.cam.azimut;
    const e0 = this.cam.elevation;
    // Chemin le plus court : sans ce repli dans [−π, π], passer de 3,0 à −3,0
    // rad ferait un tour complet pour 16° d'écart réel.
    const da = Math.atan2(Math.sin(azimut - a0), Math.cos(azimut - a0));
    const de = elevation - e0;
    // Déjà orienté ainsi : une quinzaine d'images d'un nuage de plusieurs
    // millions de points pour ne rien déplacer.
    if (Math.abs(da) < 1e-4 && Math.abs(de) < 1e-4) return;
    const t0 = performance.now();

    const pas = () => {
      const u = Math.min(1, (performance.now() - t0) / duree);
      const k = u * u * (3 - 2 * u);   // départ et arrivée amortis
      this.cam.azimut = a0 + da * k;
      this.cam.elevation = e0 + de * k;
      this.vue._bouger();
      this._animation = u < 1 ? requestAnimationFrame(pas) : 0;
    };
    pas();
  }

  /** Rend la main à l'utilisateur : tout geste prime sur l'animation en cours. */
  arreter() {
    if (this._animation) cancelAnimationFrame(this._animation);
    this._animation = 0;
    if (this._animationPivot) cancelAnimationFrame(this._animationPivot);
    this._animationPivot = 0;
  }
}
