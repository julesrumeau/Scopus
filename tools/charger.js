// Charge les scripts de `src/` dans un contexte isolé, pour les tester sous
// Node.
//
// Les sources de Scopus sont des scripts classiques qui exposent des globaux —
// contrainte de l'ouverture en `file://`, cf. CLAUDE.md. Node ne peut donc pas
// les `import`. On les évalue à la place dans un contexte `vm` partagé, ce qui
// reproduit exactement ce que fait le navigateur : une portée globale unique où
// chaque fichier voit les précédents.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = new URL('../src/', import.meta.url);

/**
 * @param {string[]} fichiers noms de fichiers de `src/`, dans l'ordre de chargement
 * @returns {object} le contexte, où chaque global déclaré est accessible
 */
export function chargerScripts(fichiers) {
  // Les globaux de Node (`URLSearchParams`, `fetch`, `TextDecoder`…) sont des
  // propriétés **non énumérables** de `globalThis` : un simple `{ ...globalThis }`
  // les laisse tous derrière, et le script échoue sur un `ReferenceError` qui
  // n'a rien à voir avec le code testé. On recopie donc les descripteurs.
  const base = {};
  for (const nom of Object.getOwnPropertyNames(globalThis)) {
    if (nom === 'globalThis') continue;
    const desc = Object.getOwnPropertyDescriptor(globalThis, nom);
    if (desc) Object.defineProperty(base, nom, desc);
  }
  const contexte = vm.createContext(base);
  contexte.globalThis = contexte;

  for (const nom of fichiers) {
    const chemin = fileURLToPath(new URL(nom, SRC));
    const source = readFileSync(chemin, 'utf8');
    // `const` au premier niveau d'un script ne devient pas propriété de l'objet
    // global : il vit dans la portée lexicale globale, invisible depuis
    // l'extérieur du contexte. On réexporte donc explicitement les noms voulus.
    const noms = [...source.matchAll(/^(?:const|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm)]
      .map((m) => m[1]);
    const reexport = noms.map((n) => `globalThis.${n} = ${n};`).join('\n');
    vm.runInContext(`${source}\n${reexport}`, contexte, { filename: chemin });
  }
  return contexte;
}
