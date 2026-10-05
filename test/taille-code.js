// Mesure les fonctions et les classes d'une source JavaScript, sans dépendance : un lexeur qui saute
// commentaires, chaînes, gabarits et expressions régulières (leurs accolades ne comptent pas), puis une
// pile d'accolades qui reconnaît ce qui ouvre un corps de fonction (flèche, méthode, déclaration) ou
// de classe. Heuristique assumée : elle n'a pas à tout comprendre, seulement à ne pas se tromper sur
// ce code-ci — validée contre un vrai analyseur (acorn) à l'écriture.
//
// Lancé directement (`node test/taille-code.js --ecrire`), il réécrit le cliquet (taille-code.limites.json)
// d'après le code actuel : à faire après avoir **réduit** une fonction, une classe ou un fichier.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTROLES = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
const AVANT_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
const PONCTUATION = ['===', '!==', '...', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '++', '--', '+=', '-=', '*=', '/=', '?.'];

/** Les jetons : { t: 'id' | 'num' | 'lit' | 'p', v, l (ligne) }. Les littéraux (chaînes, gabarits, regex) valent un seul jeton. */
function lire(src) {
  const jetons = [];
  const n = src.length;
  let i = 0, ligne = 1;
  const pousser = (t, v) => jetons.push({ t, v, l: ligne });

  const sauterChaine = (q) => {
    i++;
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') { if (src[i + 1] === '\n') ligne++; i += 2; continue; }
      if (src[i] === '\n') ligne++;
      i++;
    }
    i++;
  };
  // Un gabarit : le texte, et les expressions `${ … }` (qui peuvent contenir chaînes, gabarits, accolades).
  const sauterGabarit = () => {
    i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; sauterExpression(); continue; }
      if (src[i] === '\n') ligne++;
      i++;
    }
    i++;
  };
  const sauterExpression = () => {
    let prof = 1;
    while (i < n && prof > 0) {
      const c = src[i];
      if (c === '"' || c === "'") { sauterChaine(c); continue; }
      if (c === '`') { sauterGabarit(); continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
      if (c === '\n') ligne++;
      if (c === '{') prof++;
      else if (c === '}') prof--;
      i++;
    }
  };
  const regexPossible = () => {
    const p = jetons[jetons.length - 1];
    if (!p) return true;
    if (p.t === 'id') return AVANT_REGEX.has(p.v);
    if (p.t === 'num' || p.t === 'lit') return false;
    return !(p.v === ')' || p.v === ']' || p.v === '}');
  };
  const sauterRegex = () => {
    i++;
    let classe = false;
    while (i < n && (src[i] !== '/' || classe)) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '[') classe = true;
      else if (src[i] === ']') classe = false;
      i++;
    }
    i++;
    while (i < n && /[a-z]/i.test(src[i])) i++;
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { ligne++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const fin = src.indexOf('*/', i + 2);
      const bloc = src.slice(i, fin < 0 ? n : fin + 2);
      ligne += (bloc.match(/\n/g) || []).length;
      i = fin < 0 ? n : fin + 2;
      continue;
    }
    if (c === '"' || c === "'") { const l0 = ligne; sauterChaine(c); jetons.push({ t: 'lit', v: c, l: l0 }); continue; }
    if (c === '`') { const l0 = ligne; sauterGabarit(); jetons.push({ t: 'lit', v: c, l: l0 }); continue; }
    if (c === '/' && regexPossible()) { const l0 = ligne; sauterRegex(); jetons.push({ t: 'lit', v: '/', l: l0 }); continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[\w.]/.test(src[j])) j++; pousser('num', src.slice(i, j)); i = j; continue; }
    if (/[\p{L}_$]/u.test(c)) { let j = i; while (j < n && /[\p{L}\p{N}_$]/u.test(src[j])) j++; pousser('id', src.slice(i, j)); i = j; continue; }
    const multi = PONCTUATION.find((p) => src.startsWith(p, i));
    pousser('p', multi || c);
    i += (multi || c).length;
  }
  return jetons;
}

/**
 * Les fonctions et classes de `source`, dans l'ordre de leur accolade fermante :
 * `{ nom, type: 'fonction' | 'classe', debut, fin, lignes, propres }` — `propres` : les lignes sans
 * compter les fonctions et classes imbriquées.
 */
export function mesurer(source) {
  const jetons = lire(source);
  // Parenthèses appariées, pour retrouver ce qui précède la parenthèse ouvrante d'une liste de paramètres.
  const ouvrante = new Map(), fermante = new Map(), pileP = [];
  jetons.forEach((j, k) => {
    if (j.t !== 'p') return;
    if (j.v === '(') pileP.push(k);
    else if (j.v === ')') { const o = pileP.pop(); if (o !== undefined) { ouvrante.set(k, o); fermante.set(o, k); } }
  });

  const nomFleche = (k) => {                 // k : l'indice de `=>`
    let j = k - 1;
    if (jetons[j]?.v === ')') j = ouvrante.get(j) - 1; else j -= 1;   // avant les paramètres
    if (jetons[j]?.t === 'id' && jetons[j].v === 'async') j -= 1;
    const p = jetons[j];
    if (!p) return '(anonyme)';
    if (p.v === '=' || p.v === ':') return jetons[j - 1]?.t === 'id' ? jetons[j - 1].v : '(anonyme)';
    if (p.v === '(' && jetons[(fermante.get(j) ?? -2) + 1]?.v === '(') return '(IIFE)';
    return '(anonyme)';
  };
  const nomParenthese = (k) => {             // k : l'indice de `)` avant `{` ; null si c'est un bloc de contrôle
    const o = ouvrante.get(k);
    const avant = jetons[o - 1];
    if (!avant) return null;
    if (avant.t === 'id' && CONTROLES.has(avant.v)) return null;
    if (avant.t === 'id' && avant.v === 'function') return '(anonyme)';
    if (avant.t === 'id') return avant.v;
    return avant.v === ']' ? '(méthode)' : null;
  };

  const resultats = [], pile = [];
  let profParen = 0, classeEnAttente = null;
  for (let k = 0; k < jetons.length; k++) {
    const j = jetons[k];
    if (j.t === 'id' && j.v === 'class') {
      const suivant = jetons[k + 1];
      // Le mot-clé est suivi d'un nom, de `extends` ou d'un corps ; une clé (`class: 'x'`) ou un `.class` non.
      if (jetons[k - 1]?.v === '.' || !(suivant && (suivant.t === 'id' || suivant.v === '{'))) continue;
      classeEnAttente = { nom: suivant?.t === 'id' && suivant.v !== 'extends' ? suivant.v : '(classe)', prof: profParen };
      continue;
    }
    if (j.t !== 'p') continue;
    if (j.v === '(') { profParen++; continue; }
    if (j.v === ')') { profParen--; continue; }
    if (j.v === '{') {
      const prev = jetons[k - 1];
      let entree = { type: 'bloc', sous: 0 };
      if (classeEnAttente && classeEnAttente.prof === profParen) {
        entree = { type: 'classe', nom: classeEnAttente.nom, debut: j.l, sous: 0 };
        classeEnAttente = null;
      } else if (prev?.v === '=>') {
        entree = { type: 'fonction', nom: nomFleche(k - 1), debut: j.l, sous: 0 };
      } else if (prev?.v === ')') {
        const nom = nomParenthese(k - 1);
        if (nom !== null) entree = { type: 'fonction', nom, debut: j.l, sous: 0 };
      }
      pile.push(entree);
    } else if (j.v === '}') {
      const e = pile.pop();
      if (!e || e.type === 'bloc') continue;
      const lignes = j.l - e.debut + 1;
      resultats.push({ nom: e.nom, type: e.type, debut: e.debut, fin: j.l, lignes, propres: lignes - e.sous });
      // Le plus proche ancêtre fonction ou classe retire cette taille de la sienne.
      for (let a = pile.length - 1; a >= 0; a--) if (pile[a].type !== 'bloc') { pile[a].sous += lignes; break; }
    }
  }
  return resultats;
}

// ── Le cliquet ───────────────────────────────────────────────────────────────

/** Les seuils : une fonction, **sans compter ce qu'elle imbrique**, tient en 100 lignes ; une classe en 400 ; un fichier en 1000. */
export const SEUILS = { fonction: 100, classe: 400, fichier: 1000 };

const SRC = new URL('../src/', import.meta.url);

/**
 * Ce qui dépasse un seuil dans `src/` : `{ fonctions, classes, fichiers }`. Fonctions et classes : une clé
 * `fichier::nom` et la liste de leurs tailles au-dessus du seuil (plusieurs fonctions peuvent porter le même
 * nom, comme les IIFE) ; fichiers : leur nombre de lignes.
 */
export function observer() {
  const fonctions = {}, classes = {}, fichiers = {};
  for (const nom of readdirSync(fileURLToPath(SRC)).filter((n) => n.endsWith('.js')).sort()) {
    const source = readFileSync(new URL(nom, SRC), 'utf8');
    const lignes = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
    if (lignes > SEUILS.fichier) fichiers[nom] = [lignes];
    for (const m of mesurer(source)) {
      const [liste, taille, seuil] = m.type === 'classe' ? [classes, m.lignes, SEUILS.classe] : [fonctions, m.propres, SEUILS.fonction];
      if (taille > seuil) (liste[`${nom}::${m.nom}`] ||= []).push(taille);
    }
  }
  return { fonctions, classes, fichiers };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--ecrire')) {
  const o = observer();
  const tri = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, [...v].sort((a, b) => b - a)]).sort(([a], [b]) => a.localeCompare(b)));
  const json = { seuils: SEUILS, fonctions: tri(o.fonctions), classes: tri(o.classes), fichiers: tri(o.fichiers) };
  writeFileSync(new URL('./taille-code.limites.json', import.meta.url), JSON.stringify(json, null, 2) + '\n');
  console.log('cliquet réécrit :', Object.keys(json.fonctions).length, 'fonctions,', Object.keys(json.classes).length, 'classes,', Object.keys(json.fichiers).length, 'fichiers au-dessus des seuils');
}
