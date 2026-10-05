// La caméra de la 3D posée d'après un lien (zone, échelle, angles) et bornée au rectangle du nuage : la cible
// n'en sort pas, et on ne s'éloigne pas au-delà de ce qui le montre tout entier. Ne connaît de `Vue3D` que sa
// caméra, son canevas et son nuage ; la géométrie est dans `rectangle-3d.js`.

class Pose3D {
  constructor(vue) {
    this.vue = vue;
    this.pose = null;      // une pose pour le prochain nuage (le lien s'ouvre avant que le premier bloc n'arrive)
    this.limites = null;   // le rectangle du nuage, en coordonnées de la cible
  }

  /**
   * Place la caméra sur un point Lambert-93 à une échelle donnée (mètres par pixel CSS), sous les angles
   * demandés — l'inverse de `Vue3D.camera`, ce que fait un lien ouvert en 3D. `altitude` absolue, ou `null` :
   * une hauteur de cible raisonnable pour ce nuage.
   */
  placer(x, y, altitude, mpp, azimut, elevation) {
    const v = this.vue;
    if (!v.nuage) return;
    v.controles.arreter();
    const o = v.nuage.origine;
    // Canevas masqué : la hauteur de la fenêtre est la meilleure estimation de celle qu'il aura.
    const hauteur = v.canvas.clientHeight || window.innerHeight;
    const cy = altitude == null
      ? (v.nuage.zmax - v.nuage.zmin) * 0.3
      : (altitude - o[2] - v.zmin) * CONFIG.rendu.exagerationZ;
    v.cam.cible = [x - o[0], cy, -(y - o[1])];
    v.cam.distance = Math.max(2, Math.min(6000, RECTANGLE_3D.distanceDepuisResolution(mpp, hauteur, FOV_Y_DEG)));
    v.cam.azimut = azimut;
    v.cam.elevation = elevation;
    this.borner();
    v.invalider();
  }

  /** Une pose pour le prochain nuage : `{x, y, mpp, azimut, elevation}`. */
  definir(pose) { this.pose = pose; }

  /**
   * La bascule manuelle carte → 3D : même zone, même échelle que la carte, sous les angles par défaut. Une pose
   * déjà demandée (un lien) n'est pas remplacée.
   */
  definirDepuisRectangle(rect, azimut = -Math.PI / 4, elevation = 0.55) {
    if (this.pose) return;
    const hauteur = this.vue.canvas.clientHeight || window.innerHeight;
    const { x, y, mpp } = RECTANGLE_3D.poseDepuisRectangle(rect, hauteur, FOV_Y_DEG);
    this.pose = { x, y, mpp, azimut, elevation };
  }

  /** Applique la pose en attente si un nuage existe ; vrai si elle l'a été (une seule fois). */
  appliquer() {
    if (!this.pose || !this.vue.nuage) return false;
    const p = this.pose;
    this.pose = null;
    this.placer(p.x, p.y, null, p.mpp, p.azimut, p.elevation);
    return true;
  }

  /** Le rectangle du nuage actuel devient la limite de la caméra (`null` sans nuage). */
  definirLimites() {
    const n = this.vue.nuage;
    this.limites = n ? { cible: RECTANGLE_3D.rectangleCible(n.emprise, n.origine), emprise: n.emprise } : null;
  }

  borner() {
    const l = this.limites, v = this.vue;
    if (!l) return;
    v.cam.cible = RECTANGLE_3D.limiterCible(v.cam.cible, l.cible);
    const aspect = (v.canvas.clientWidth / v.canvas.clientHeight) || 1.6;
    v.cam.distance = Math.min(v.cam.distance, RECTANGLE_3D.distanceMax(l.emprise, FOV_Y_DEG, aspect));
  }
}
