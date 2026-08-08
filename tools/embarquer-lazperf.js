// Génère `vendor/lazperf/lazperf-embarque.js` à partir des fichiers d'origine
// de laz-perf.
//
// Pourquoi cette étape existe : Scopus doit s'ouvrir par double-clic, en
// `file://`. Or dans ce mode le navigateur refuse de lire un fichier local par
// `fetch` ou `XHR` — donc `createLazPerf()` ne peut pas aller chercher son
// `.wasm` tout seul, et un Worker créé depuis une URL blob (origine « null »)
// ne peut pas `importScripts` un fichier local non plus.
//
// La parade est de ne plus rien charger du tout au moment de l'exécution : le
// JavaScript de laz-perf et son binaire WASM deviennent deux chaînes de
// caractères dans un fichier chargé par une simple balise <script src>, qui,
// elle, fonctionne en `file://`.
//
// À relancer uniquement lors d'une mise à jour de laz-perf :
//     node tools/embarquer-lazperf.js

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const RACINE = new URL('../vendor/lazperf/', import.meta.url);
const SORTIE = fileURLToPath(new URL('lazperf-embarque.js', RACINE));

const js = await readFile(fileURLToPath(new URL('laz-perf.js', RACINE)), 'utf8');
const wasm = await readFile(fileURLToPath(new URL('laz-perf.wasm', RACINE)));

// Le source part dans un littéral de gabarit : seuls l'antislash, le backtick
// et `${` doivent être neutralisés. Passer par JSON.stringify produirait une
// ligne unique de 87 Ko, illisible dans un diff.
const echappe = js.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

// Base64 découpé en lignes : un littéral d'un seul tenant de 279 Ko fait ramer
// les éditeurs et rend le fichier impossible à relire.
const b64 = wasm.toString('base64').replace(/(.{120})/g, '$1\n');

await writeFile(SORTIE, `// FICHIER GÉNÉRÉ — ne pas modifier à la main.
// Produit par \`node tools/embarquer-lazperf.js\` depuis laz-perf.js et
// laz-perf.wasm, tous deux présents dans ce répertoire à titre de source.
//
// Expose deux chaînes :
//   LAZPERF_JS       le source de laz-perf, à injecter dans la page ou à
//                    concaténer en tête du source d'un Worker ;
//   LAZPERF_WASM_B64 le binaire WASM, à passer en \`wasmBinary\` pour que
//                    l'initialisation ne déclenche aucune requête réseau.
//
// laz-perf — https://github.com/hobuinc/laz-perf — licence LGPL 2.1.

const LAZPERF_JS = \`${echappe}\`;

const LAZPERF_WASM_B64 = \`
${b64}\`.replace(/\\s+/g, '');

/** Décode le WASM embarqué en Uint8Array, prêt pour \`{ wasmBinary }\`. */
function lazPerfWasm() {
  const brut = atob(LAZPERF_WASM_B64);
  const out = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) out[i] = brut.charCodeAt(i);
  return out;
}
`, 'utf8');

const taille = (await readFile(SORTIE)).length;
console.log(`vendor/lazperf/lazperf-embarque.js — ${(taille / 1024).toFixed(0)} Ko`);
