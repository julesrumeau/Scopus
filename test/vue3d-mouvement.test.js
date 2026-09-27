// La part du nuage dessinée pendant un geste : elle baisse quand les images
// tardent, d'autant plus vite qu'elles tardent, et remonte quand elles sont
// rapides. Le retard est celui entre la demande d'une image (le geste) et son
// rendu : une pause dans le geste ne l'allonge pas, une carte saturée si.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { partEnMouvement, CONFIG } = chargerScripts(['config.js', 'vue3d.js']);
const m = CONFIG.rendu.mouvement;

test('images en retard : la part baisse, jamais sous le plancher', () => {
  let part = 1;
  for (let i = 0; i < 100; i++) part = partEnMouvement(part, 60, m);
  assert.equal(part, m.partMin);
  assert.ok(partEnMouvement(1, m.imageLenteMs + 5, m) < 1);
});

test('une image très en retard fait baisser la part d’un coup, pas d’un cinquième', () => {
  // 500 ms sur une carte saturée : à 0,8 par image, il faudrait des secondes
  // de geste avant de redevenir fluide.
  assert.ok(partEnMouvement(1, 500, m) <= 0.25);
});

test('images rapides : la part remonte, jamais au-dessus du nuage entier', () => {
  assert.ok(partEnMouvement(0.3, 10, m) > 0.3);
  let part = 0.3;
  for (let i = 0; i < 100; i++) part = partEnMouvement(part, 10, m);
  assert.equal(part, 1);
});

test('entre les deux, ou sans retard mesuré : inchangée', () => {
  assert.equal(partEnMouvement(0.5, (m.imageLenteMs + m.imageRapideMs) / 2, m), 0.5);
  assert.equal(partEnMouvement(0.5, null, m), 0.5);
});
