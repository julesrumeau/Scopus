// Les sources de Scopus dans le contexte principal de Node, pour les bancs.
//
// Les tests passent par un contexte `vm` (test/charger.js), où les boucles
// chaudes tournent ~7 fois plus lentement (CLAUDE.md, « Ne jamais chronométrer
// dans le harnais de test ») : un banc qui calcule un SVF sur 4 M de cases et
// détecte des tracés dessus veut la vitesse native. Les scripts, écrits pour
// partager la portée globale du navigateur, sont concaténés dans une seule
// fonction, qui rend les globaux demandés.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = new URL('../src/', import.meta.url);

/** Les globaux `noms` des scripts `fichiers` de src/, chargés dans l'ordre. */
export function charger(fichiers, noms) {
  const source = fichiers.map((f) => readFileSync(new URL(f, SRC), 'utf8')).join('\n;\n');
  return new Function(`${source}\nreturn { ${noms.join(', ')} };`)();
}

/**
 * laz-perf, tel qu'embarqué pour les workers (il se croit dans un worker) : un
 * contexte vm lui fournit `self` et `importScripts`, le WASM est lu du disque.
 */
export async function lazPerf() {
  const V = new URL('../vendor/lazperf/', import.meta.url);
  const ctx = vm.createContext({ console, WebAssembly, performance, setTimeout, clearTimeout, importScripts: () => {}, location: { href: '' }, TextDecoder, Uint8Array });
  ctx.self = ctx;
  vm.runInContext(`${readFileSync(new URL('laz-perf.js', V), 'utf8')}\nthis.createLazPerf = createLazPerf;`, ctx);
  return ctx.createLazPerf({ wasmBinary: readFileSync(new URL('laz-perf.wasm', V)) });
}
