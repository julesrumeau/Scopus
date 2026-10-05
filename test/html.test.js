// Les deux fonctions qui écrivent du texte venu d'un service tiers dans un innerHTML.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { echapper, ligneDetail } = chargerScripts(['html.js']);

test('echapper neutralise le HTML, guillemets compris', () => {
  assert.equal(echapper('<b onclick="x">&\'</b>'), '&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;');
});

test('echapper accepte un nombre ou null sans lever', () => {
  assert.equal(echapper(12.5), '12.5');
  assert.equal(echapper(null), 'null');
});

test('ligneDetail : un couple <dt>/<dd>, la clé et la valeur échappées, les retours à la ligne en <br>', () => {
  assert.equal(ligneDetail('Altitude', '381.6 m'), '<dt>Altitude</dt><dd>381.6 m</dd>');
  assert.equal(ligneDetail('a<b', 'ligne 1\nligne 2'), '<dt>a&lt;b</dt><dd>ligne 1<br>ligne 2</dd>');
  assert.ok(!ligneDetail('x', '<script>').includes('<script>'));
});
