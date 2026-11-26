// L'arbre d'exemple de l'éditeur de rampe : un nuage de points qui ressemble à un arbre de 50 m (un tronc, une couronne, un peu de
// sol), toujours le même, pour voir les couleurs d'une rampe sur quelque chose de reconnaissable. Pur : aucun DOM.
// `x` est dans [-1, 1] (largeur de l'image), `h` la hauteur au-dessus du sol en mètres, de 0 à 50.

const ARBRE_EXEMPLE = (() => {
  /** Un générateur pseudo-aléatoire à graine (mulberry32) : mêmes points à chaque chargement. */
  function graine(a) {
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function points() {
    const alea = graine(20261112);
    const p = [];
    for (let i = 0; i < 260; i++) p.push({ x: (alea() - 0.5) * 2, h: alea() * 0.15 });                       // le sol
    for (let i = 0; i < 220; i++) p.push({ x: (alea() - 0.5) * 0.12, h: 0.2 + alea() * 27 });                 // le tronc
    for (let i = 0; i < 820; i++) {                                                                           // la couronne : une ellipse, surtout en surface
      const a = alea() * Math.PI * 2, r = i % 5 < 3 ? 0.82 + 0.18 * alea() : Math.sqrt(alea());
      p.push({ x: Math.cos(a) * r * 0.9, h: 38 + Math.sin(a) * r * 12 });
    }
    return p;
  }

  return { points };
})();
