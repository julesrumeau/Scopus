// Les palettes des couches de relief (palette + étalement, voir `RELIEF.COUCHES`).

/**
 * Tables de couleurs, 256 entrées, en triplets.
 *
 * Quatre familles, chacune choisie pour ce que la couche veut faire voir :
 * `gris` pour les couches d'éclairement, où l'œil lit le modelé et non la
 * valeur ; `divergent` pour les couches signées, où le zéro doit se distinguer
 * du reste ; `chaud` et `froid` pour les couches positives qu'on veut voir
 * ressortir du fond.
 */
function construireLUT(nom) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    let r, v, b;
    if (nom === 'divergent') {
      // Creux en bleu froid, bosses en ocre, zéro en gris moyen.
      if (u < 0.5) { const k = u * 2; r = 60 + k * 130; v = 90 + k * 100; b = 130 + k * 60; }
      else { const k = (u - 0.5) * 2; r = 190 + k * 60; v = 190 - k * 20; b = 190 - k * 110; }
    } else if (nom === 'chaud') {
      r = 30 + u * 225; v = 30 + u * 150 * (u < 0.7 ? 1 : 0.7); b = 40 * (1 - u);
    } else if (nom === 'froid') {
      r = 20 + u * 60; v = 30 + u * 170; b = 45 + u * 210;
    } else {
      r = v = b = 12 + u * 236;
    }
    lut[i * 3] = Math.max(0, Math.min(255, r));
    lut[i * 3 + 1] = Math.max(0, Math.min(255, v));
    lut[i * 3 + 2] = Math.max(0, Math.min(255, b));
  }
  return lut;
}
