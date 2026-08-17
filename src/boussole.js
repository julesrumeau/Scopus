// Boussole 3D de la vue : où sont le nord et le haut, et comment y revenir.
//
// Une fois qu'on a pivoté deux ou trois fois autour d'une structure, plus rien
// ne dit où est le nord. Le nuage n'a ni horizon ni bâtiment reconnaissable, et
// une dalle est un carré : toutes les orientations se ressemblent. Or on lit
// ensuite les détections sur une carte, qui elle est au nord — d'où le besoin de
// remettre la vue d'aplomb sans tâtonner.
//
// La boussole est **projetée**, pas dessinée à plat : les quatre points
// cardinaux sont posés sur le cercle de l'horizon vu par la caméra du moment, et
// l'axe vertical suit son inclinaison. C'est ce qui la rend lisible d'un coup
// d'œil — la rose s'aplatit quand on rase le sol, s'arrondit quand on passe à la
// verticale.
//
// En SVG et non en WebGL : il y a du texte. Six étiquettes nettes à toutes les
// densités de pixels coûteraient un atlas de glyphes et un programme de plus ;
// ici c'est un `<text>`, et le style vit avec le reste de l'interface.

const NS_SVG = 'http://www.w3.org/2000/svg';

/**
 * Les six directions, en coordonnées **monde** de la vue 3D.
 *
 * Repère de la scène, fixé par `Vue3D` : X vers l'est, Y vers le haut, Z vers le
 * sud — le Y Lambert-93 est nié au chargement (`cadrer`, `_remplirBoites`), si
 * bien que le nord est en −Z. Toucher à cette table sans toucher à celle-là
 * ferait mentir la boussole.
 */
const AXES_BOUSSOLE = [
  { cle: 'N', libelle: 'N', titre: 'Nord en haut de l’écran', v: [0, 0, -1], rayon: 10 },
  { cle: 'E', libelle: 'E', titre: 'Est en haut de l’écran', v: [1, 0, 0], rayon: 10 },
  { cle: 'S', libelle: 'S', titre: 'Sud en haut de l’écran', v: [0, 0, 1], rayon: 10 },
  { cle: 'O', libelle: 'O', titre: 'Ouest en haut de l’écran', v: [-1, 0, 0], rayon: 10 },
  { cle: 'haut', libelle: '↑', titre: 'Vue de dessus', v: [0, 1, 0], rayon: 8 },
  { cle: 'bas', libelle: '↓', titre: 'Vue de dessous', v: [0, -1, 0], rayon: 8 },
];

class Boussole {
  /**
   * @param {SVGElement} hote conteneur, en viewBox centrée sur l'origine
   * @param {(v:number[]) => void} surChoix reçoit la direction demandée
   */
  constructor(hote, surChoix) {
    this.hote = hote;
    this.rayon = 34;

    hote.appendChild(this._el('circle', { class: 'fond', r: 46 }));
    this.horizon = hote.appendChild(this._el('polygon', { class: 'horizon' }));
    this.axeVertical = hote.appendChild(this._el('line', { class: 'axe-vertical' }));

    this.poignees = AXES_BOUSSOLE.map((axe) => {
      const g = this._el('g', {
        class: `poignee${axe.cle === 'N' ? ' nord' : ''}`, role: 'button', tabindex: '0',
      });
      g.appendChild(this._el('title')).textContent = axe.titre;
      g.appendChild(this._el('circle', { r: axe.rayon }));
      g.appendChild(this._el('text')).textContent = axe.libelle;

      const choisir = () => surChoix(axe.v);
      g.addEventListener('click', choisir);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choisir(); }
      });
      hote.appendChild(g);
      return { axe, g, p: [0, 0, 0] };
    });

    // Cercle unité du plan horizontal, échantillonné une fois pour toutes :
    // projeté, c'est lui qui donne l'ellipse de l'horizon à chaque image.
    this.cercle = [];
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      this.cercle.push([Math.cos(t), 0, Math.sin(t)]);
    }
  }

  /**
   * Redessine la rose pour un repère caméra donné.
   *
   * Le repère vient de `Vue3D._repere()` — la même source que le rendu et que
   * les contrôles. En recalculer un ici ferait exactement ce que l'architecture
   * s'interdit : deux versions du repère qui finissent par diverger.
   */
  orienter({ droite, haut, avant }) {
    const R = this.rayon;
    // Projection d'une direction monde sur l'écran de la boussole. Y est
    // renversé (SVG descend), la troisième composante donne la profondeur :
    // positive, l'axe s'éloigne de l'œil.
    const projeter = (v) => [
      (v[0] * droite[0] + v[1] * droite[1] + v[2] * droite[2]) * R,
      -(v[0] * haut[0] + v[1] * haut[1] + v[2] * haut[2]) * R,
      v[0] * avant[0] + v[1] * avant[1] + v[2] * avant[2],
    ];

    this.horizon.setAttribute('points', this.cercle.map((v) => {
      const p = projeter(v);
      return `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    }).join(' '));

    const ph = projeter([0, 1, 0]);
    const pb = projeter([0, -1, 0]);
    this._attributs(this.axeVertical, {
      x1: ph[0].toFixed(1), y1: ph[1].toFixed(1), x2: pb[0].toFixed(1), y2: pb[1].toFixed(1),
    });

    for (const item of this.poignees) item.p = projeter(item.axe.v);

    // Ordre du peintre : le plus lointain posé en premier. Deux poignées se
    // recouvrent dès que la vue s'approche d'un axe, et c'est celle qui est de
    // notre côté qui doit rester lisible et cliquable.
    for (const item of [...this.poignees].sort((a, b) => b.p[2] - a.p[2])) {
      item.g.setAttribute('transform', `translate(${item.p[0].toFixed(1)} ${item.p[1].toFixed(1)})`);
      item.g.classList.toggle('loin', item.p[2] > 0.02);
      this.hote.appendChild(item.g);
    }
  }

  _el(nom, attributs = {}) {
    const e = document.createElementNS(NS_SVG, nom);
    this._attributs(e, attributs);
    return e;
  }

  _attributs(e, attributs) {
    for (const [k, v] of Object.entries(attributs)) e.setAttribute(k, v);
  }
}
