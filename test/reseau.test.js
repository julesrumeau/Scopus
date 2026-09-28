// Les deux files de reseau.js : chacune son plafond, aucune n'attend l'autre.
//
// Les tuiles de la photo passaient par la file des COPC, bornée à 3 requêtes
// en vol pour l'API de téléchargement : une centaine de tuiles y mettaient 6 à
// 30 s. Ce qui se vérifie ici avec un faux `fetch` : la file des tuiles monte
// à son plafond à elle, et une rafale de tuiles ne retarde pas une requête
// COPC — ni l'inverse.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

function monter() {
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  const enVol = { defaut: 0, tuiles: 0 }, pic = { defaut: 0, tuiles: 0 };
  const liberer = [];
  ctx.fetch = (url) => {
    const f = url.includes('tuile') ? 'tuiles' : 'defaut';
    enVol[f]++; pic[f] = Math.max(pic[f], enVol[f]);
    return new Promise((ok) => liberer.push(() => {
      enVol[f]--;
      ok({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(4) });
    }));
  };
  return { ctx, pic, enVol, liberer };
}

const souffler = () => new Promise((r) => setImmediate(r));

test('la file des tuiles monte à son propre plafond, celle des COPC reste à 3', async () => {
  const { ctx, pic, liberer } = monter();
  const tuiles = Array.from({ length: 40 }, (_, i) => ctx.RESEAU.recuperer(`https://x/tuile${i}`, { file: 'tuiles' }));
  const copc = Array.from({ length: 10 }, (_, i) => ctx.RESEAU.recuperer(`https://x/copc${i}`));
  await souffler();
  assert.equal(pic.tuiles, ctx.CONFIG.reseau.requetesParallelesTuiles);
  assert.equal(pic.defaut, ctx.CONFIG.reseau.requetesParallèles);
  // On vide tout, par vagues.
  while (liberer.length) { liberer.splice(0).forEach((f) => f()); await souffler(); }
  await Promise.all([...tuiles, ...copc]);
});

test('une rafale de tuiles ne fait pas attendre une requête COPC', async () => {
  const { ctx, enVol, liberer } = monter();
  Array.from({ length: 200 }, (_, i) => ctx.RESEAU.recuperer(`https://x/tuile${i}`, { file: 'tuiles' }).catch(() => {}));
  ctx.RESEAU.recuperer('https://x/copc');
  await souffler();
  assert.equal(enVol.defaut, 1, 'la requête COPC part tout de suite, sans attendre les tuiles');
  while (liberer.length) { liberer.splice(0).forEach((f) => f()); await souffler(); }
});

test('sans file précisée, c’est la file des COPC', async () => {
  const { ctx, pic, liberer } = monter();
  const r = Array.from({ length: 8 }, (_, i) => ctx.RESEAU.recuperer(`https://x/copc${i}`));
  await souffler();
  assert.equal(pic.defaut, ctx.CONFIG.reseau.requetesParallèles);
  while (liberer.length) { liberer.splice(0).forEach((f) => f()); await souffler(); }
  await Promise.all(r);
});

test('fin de fichier : Range « bytes=-n » et taille totale du fichier', async () => {
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  const vus = [];
  ctx.fetch = async (url, init) => {
    vus.push(init.headers?.Range);
    return {
      ok: true, status: 206,
      headers: new Map([['content-range', 'bytes 212000000-212999999/213000000']]),
      arrayBuffer: async () => new Uint8Array(1_000_000).buffer,
    };
  };
  const r = await ctx.RESEAU.recuperer('https://x/f.copc.laz', { fin: 1_000_000 });
  assert.equal(vus[0], 'bytes=-1000000');
  assert.equal(r.total, 213_000_000);
  assert.equal(r.octets.length, 1_000_000);
});

test('fin de fichier : un serveur qui ignore la plage rend quand même la fin', async () => {
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  const tout = new Uint8Array(5000).map((_, i) => i % 251);
  ctx.fetch = async () => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => tout.buffer });
  const r = await ctx.RESEAU.recuperer('https://x/f', { fin: 1000 });
  assert.equal(r.total, 5000);
  assert.equal(r.octets.length, 1000);
  assert.equal(r.octets[0], tout[4000]);
});

test('fin de fichier : un 206 sans Content-Range lisible (CORS) rend une taille inconnue', async () => {
  // L'IGN n'expose pas Content-Range aux pages web : le navigateur le masque.
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  ctx.fetch = async () => ({ ok: true, status: 206, headers: new Map(), arrayBuffer: async () => new Uint8Array(1000).buffer });
  const r = await ctx.RESEAU.recuperer('https://x/f', { fin: 1000 });
  assert.equal(r.total, null);
  assert.equal(r.octets.length, 1000);
});

test('fin de fichier : un 200 servi par le cache HTTP avec juste les octets demandés n’est pas le fichier entier', async () => {
  // Le cache du navigateur peut servir une plage en 200 sans Content-Range
  // (voir « Pièges connus » dans CLAUDE.md) : la taille reste inconnue.
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  ctx.fetch = async () => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new Uint8Array(1000).buffer });
  const r = await ctx.RESEAU.recuperer('https://x/f', { fin: 1000 });
  assert.equal(r.total, null);
});

// Un serveur qui laisse pendre une requête, sans jamais répondre : mesuré le
// 28 septembre 2026 sur data.geopf.fr, deux fins de fichier sur trois restaient
// 50 à 59 s sans premier octet, la troisième répondait en 0,5 s. Attendre la
// réponse au plus `delaiReponseMs`, puis réessayer — et le faire savoir.
function serveurQuiPend(ctx, pendues) {
  let appels = 0;
  ctx.fetch = (url, init) => {
    appels++;
    if (appels <= pendues) {
      return new Promise((_, ko) => init.signal.addEventListener('abort', () => ko(init.signal.reason)));
    }
    return Promise.resolve({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(4) });
  };
  return () => appels;
}

test('une requête sans réponse est abandonnée au délai de réponse, puis réessayée', async () => {
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  ctx.CONFIG.reseau.delaiReponseMs = 30;
  ctx.CONFIG.reseau.reculInitialMs = 1;
  const appels = serveurQuiPend(ctx, 1);
  const t0 = Date.now();
  const r = await ctx.RESEAU.recuperer('https://x/f.copc.laz');
  assert.equal(r.length, 4);
  assert.equal(appels(), 2);
  assert.ok(Date.now() - t0 < 1000, `abandon au délai de réponse, pas au délai maximal (${Date.now() - t0} ms)`);
});

test('l’IGN est dit lent après une requête restée sans réponse, et seulement alors', async () => {
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  ctx.CONFIG.reseau.delaiReponseMs = 30;
  ctx.CONFIG.reseau.reculInitialMs = 1;
  serveurQuiPend(ctx, 0);
  await ctx.RESEAU.recuperer('https://x/a');
  assert.equal(ctx.RESEAU.lenteRecente(), false);
  let prevenu = 0;
  ctx.RESEAU.surLenteur(() => { prevenu++; });
  serveurQuiPend(ctx, 1);
  await ctx.RESEAU.recuperer('https://x/b');
  assert.equal(ctx.RESEAU.lenteRecente(), true);
  assert.equal(prevenu, 1);
});

test('une réponse lente à arriver mais qui arrive n’est pas coupée par le délai de réponse', async () => {
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  ctx.CONFIG.reseau.delaiReponseMs = 30;
  // Les en-têtes arrivent tout de suite, le corps après le délai de réponse :
  // une grosse plage sur une connexion lente, qui ne doit pas être coupée.
  ctx.fetch = async (url, init) => ({
    ok: true, status: 200, headers: new Map(),
    arrayBuffer: () => new Promise((ok, ko) => {
      const t = setTimeout(() => ok(new ArrayBuffer(4)), 80);
      init.signal.addEventListener('abort', () => { clearTimeout(t); ko(init.signal.reason); });
    }),
  });
  const r = await ctx.RESEAU.recuperer('https://x/grosse-plage');
  assert.equal(r.length, 4);
  assert.equal(ctx.RESEAU.lenteRecente(), false);
});
