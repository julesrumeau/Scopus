// Chronométrage du fil principal, avec « &chrono » dans l'adresse : où part le temps quand la carte
// ralentit. Chaque morceau de travail mesuré est compté (appels, total, pire) ; les « tâches longues » sont
// celles que le navigateur voit bloquer plus de 50 ms, mesurées ou non. Un tableau dans la console toutes
// les 5 s. Un outil de diagnostic, pas une fonction.

function creerChrono({ actif, FLUX_CHOIX, COPC, CalqueRelief, CalqueFlux, observer = true }) {
  const chrono = new Map();
  const noter = (nom, ms) => {
    const c = chrono.get(nom) || { appels: 0, totalMs: 0, pireMs: 0 };
    c.appels++; c.totalMs += ms; c.pireMs = Math.max(c.pireMs, ms);
    chrono.set(nom, c);
  };
  const mesurer = (nom, f) => function (...a) {
    const t0 = performance.now();
    try { return f.apply(this, a); } finally { noter(nom, performance.now() - t0); }
  };
  /** Les lignes du tableau, par temps total décroissant ; lire les vide. */
  const bilan = () => {
    const lignes = [...chrono].sort((a, b) => b[1].totalMs - a[1].totalMs).map(([nom, c]) => ({
      travail: nom, appels: c.appels, totalMs: Math.round(c.totalMs), pireMs: Math.round(c.pireMs),
    }));
    chrono.clear();
    return lignes;
  };
  const activite = { relief: false, decodages: 0 };
  const chronometre = { actif, activite, mesurer, bilan };
  if (!actif) return chronometre;

  console.info('Chrono du fil principal actif : un tableau toutes les 5 s dès que la carte travaille.');
  for (const [objet, nomObjet, noms] of [
    [FLUX_CHOIX, 'FLUX_CHOIX', ['blocsPourVue', 'aLiberer']],
    [COPC, 'COPC', ['lireFin', 'lireEntrees', 'grouperPlages']],
  ]) for (const n of noms) objet[n] = mesurer(`${nomObjet}.${n}`, objet[n]);
  for (const n of ['afficher', 'vider']) CalqueRelief.prototype[n] = mesurer(`image du relief : ${n}`, CalqueRelief.prototype[n]);
  for (const n of ['ajouter', 'retirer']) CalqueFlux.prototype[n] = mesurer(`contours des blocs : ${n}`, CalqueFlux.prototype[n]);
  if (!observer) return chronometre;

  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) noter('TÂCHES LONGUES (> 50 ms, tout compris)', e.duration); })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* navigateur sans longtask */ }
  // Le détail de chaque gel de plus de 150 ms : quels scripts (fonction, fichier, qui l'a appelée) et
  // combien de rendu (style, mise en page, dessin). Le temps qui n'est ni l'un ni l'autre est hors
  // JavaScript — ramasse-miettes compris. API « long animation frames » de Chrome.
  const gels = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.duration < 150) continue;
        const scripts = [...(e.scripts || [])].sort((a, b) => b.duration - a.duration);
        const js = scripts.reduce((t, x) => t + x.duration, 0);
        const rendu = e.renderStart ? e.startTime + e.duration - e.renderStart : 0;
        const styleMiseEnPage = e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0;
        gels.push({
          gelMs: Math.round(e.duration),
          // Ce qui tournait ailleurs au même moment : les workers ne bloquent pas la page, sauf à saturer
          // les cœurs du processeur.
          reliefEnCalcul: activite.relief ? 'oui' : 'non',
          decompressions: activite.decodages,
          scriptsMs: Math.round(js),
          renduMs: Math.round(rendu),
          dontStyleEtMiseEnPageMs: Math.round(styleMiseEnPage),
          resteMs: Math.round(e.duration - js - rendu),
          scriptsPrincipaux: scripts.slice(0, 3).map((x) => `${Math.round(x.duration)} ms ${x.invoker || '?'} → ${x.sourceFunctionName || '?'} @${(x.sourceURL || '').split('/').pop()}:${x.sourceCharPosition}`).join(' | '),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* navigateur sans long-animation-frame */ }
  setInterval(() => {
    const lignes = bilan();
    if (!lignes.length) return;
    console.log(`Chrono du fil principal, 5 dernières secondes, ${new Date().toLocaleTimeString()}`);
    console.table(lignes);
    if (gels.length) { console.log('Détail des gels de plus de 150 ms :'); console.table(gels.splice(0)); }
  }, 5000);
  return chronometre;
}
