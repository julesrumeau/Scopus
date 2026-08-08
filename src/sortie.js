// Sortie exploitable : rapprochement avec le bâti connu, liens de navigation,
// exports.

/**
 * Marque les candidats qui recoupent un bâtiment de la BD TOPO.
 *
 * Le test porte sur la distance au *contour*, pas au centre : une grange
 * allongée de 60 m a son centre à 30 m de son propre pignon, et un rapprochement
 * par centroïde la manquerait. À l'inverse, un candidat tombant à l'intérieur
 * d'une emprise est répertorié quelle que soit la distance au centre.
 *
 * Rien n'est supprimé : le marquage est réversible côté interface. Le cadastre
 * et la BD TOPO manquent régulièrement les cabanes d'estive, et une détection
 * écartée à tort ne se rattrape pas.
 */
async function rapprocher(candidats, emprise, signal) {
  let batis = [];
  try {
    batis = await IGN.batiments(emprise, signal);
  } catch (e) {
    // Un service indisponible ne doit pas faire perdre la détection : on rend
    // la main sans marquage plutôt que d'échouer.
    return { candidats, batis: [], erreur: e.message };
  }

  const r = CONFIG.sortie.rayonDedupM;
  for (const c of candidats) {
    let plusProche = null;
    let dMin = Infinity;

    for (const b of batis) {
      // Pré-filtre par centroïde : un bâtiment à des centaines de mètres n'a pas
      // à voir son contour parcouru sommet par sommet.
      if (Math.abs(b.cx - c.x) > 400 || Math.abs(b.cy - c.y) > 400) continue;
      const d = distanceAuPolygone(c.x, c.y, b.contour);
      if (d < dMin) { dMin = d; plusProche = b; }
    }

    c.distanceBati = Number.isFinite(dMin) ? dMin : null;
    c.batimentProche = dMin <= r ? plusProche.nature : null;
    c.dejaRepertorie = dMin <= r;
  }

  return { candidats, batis };
}

/** Distance d'un point au polygone : 0 à l'intérieur, sinon distance au bord. */
function distanceAuPolygone(px, py, anneau) {
  if (dansPolygone(px, py, anneau)) return 0;
  let d = Infinity;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    d = Math.min(d, distanceAuSegment(px, py, anneau[j], anneau[i]));
  }
  return d;
}

// Lancer de rayon horizontal : parité du nombre d'arêtes franchies.
function dansPolygone(px, py, anneau) {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i];
    const [xj, yj] = anneau[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

function distanceAuSegment(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - a[0], py - a[1]);
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

// ── Liens de navigation ─────────────────────────────────────────────────────

function liens(c) {
  const ll = `${c.lat.toFixed(7)},${c.lon.toFixed(7)}`;
  return {
    maps: `https://www.google.com/maps/search/?api=1&query=${ll}`,
    // La vue oblique de Google Earth est ce qui permet de trancher entre un
    // muret et une cabane : `a` fixe l'altitude de l'œil, `t` l'inclinaison.
    earth: `https://earth.google.com/web/@${c.lat.toFixed(7)},${c.lon.toFixed(7)},${Math.round(c.altitude)}a,220d,35y,0h,55t,0r`,
    geoportail: `https://www.geoportail.gouv.fr/carte?c=${c.lon.toFixed(7)},${c.lat.toFixed(7)}&z=19&l0=ORTHOIMAGERY.ORTHOPHOTOS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`,
    dms: PROJ.versDMS(c.lon, c.lat),
  };
}

// ── Exports ─────────────────────────────────────────────────────────────────

function versGeoJSON(candidats, meta = {}) {
  return JSON.stringify({
    type: 'FeatureCollection',
    scopus: { genere: new Date().toISOString(), ...meta },
    features: candidats.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [+c.lon.toFixed(7), +c.lat.toFixed(7)] },
      properties: {
        id: c.id, rang: c.rang, score: +c.score.toFixed(3),
        lambert93_x: +c.x.toFixed(2), lambert93_y: +c.y.toFixed(2),
        altitude_m: +c.altitude.toFixed(1),
        surface_m2: +c.surface.toFixed(1),
        longueur_m: +c.longueur.toFixed(2), largeur_m: +c.largeur.toFixed(2),
        azimut_deg: +c.azimut.toFixed(1),
        rectangularite: +c.rectangularite.toFixed(3),
        hauteur_moy_m: +c.hauteurMoy.toFixed(2), hauteur_max_m: +c.hauteurMax.toFixed(2),
        pente_moy_deg: +c.penteMoy.toFixed(1), pente_max_deg: +c.penteMax.toFixed(1),
        part_non_classe: +c.partNonClasse.toFixed(3),
        part_trou_sol: +c.partTrouSol.toFixed(3),
        deja_repertorie: c.dejaRepertorie,
        batiment_proche: c.batimentProche,
        distance_bati_m: c.distanceBati == null ? null : +c.distanceBati.toFixed(1),
      },
    })),
  }, null, 2);
}

function versCSV(candidats) {
  const colonnes = [
    'rang', 'score', 'lat', 'lon', 'lambert93_x', 'lambert93_y', 'altitude_m',
    'surface_m2', 'longueur_m', 'largeur_m', 'azimut_deg', 'rectangularite',
    'hauteur_moy_m', 'hauteur_max_m', 'pente_moy_deg', 'part_non_classe',
    'part_trou_sol', 'deja_repertorie', 'lien_google_maps',
  ];
  const lignes = candidats.map((c) => [
    c.rang, c.score.toFixed(3), c.lat.toFixed(7), c.lon.toFixed(7),
    c.x.toFixed(2), c.y.toFixed(2), c.altitude.toFixed(1),
    c.surface.toFixed(1), c.longueur.toFixed(2), c.largeur.toFixed(2),
    c.azimut.toFixed(1), c.rectangularite.toFixed(3),
    c.hauteurMoy.toFixed(2), c.hauteurMax.toFixed(2), c.penteMoy.toFixed(1),
    c.partNonClasse.toFixed(3), c.partTrouSol.toFixed(3),
    c.dejaRepertorie ? 'oui' : 'non', liens(c).maps,
  ].join(','));
  return [colonnes.join(','), ...lignes].join('\n');
}

/** GPX : le format qu'avale n'importe quel GPS de randonnée. */
function versGPX(candidats) {
  const echapper = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const pts = candidats.map((c) => `  <wpt lat="${c.lat.toFixed(7)}" lon="${c.lon.toFixed(7)}">
    <ele>${c.altitude.toFixed(1)}</ele>
    <name>${echapper(`SCO-${String(c.rang).padStart(3, '0')}`)}</name>
    <desc>${echapper(`score ${c.score.toFixed(2)} · ${c.surface.toFixed(0)} m² · ${c.longueur.toFixed(1)}×${c.largeur.toFixed(1)} m · h ${c.hauteurMoy.toFixed(1)} m${c.dejaRepertorie ? ' · déjà répertorié' : ''}`)}</desc>
    <sym>Building</sym>
  </wpt>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Scopus" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Détections Scopus</name><time>${new Date().toISOString()}</time></metadata>
${pts}
</gpx>`;
}

/**
 * GPX de tracés linéaires : des `<trk>`, pas des `<wpt>`.
 *
 * Un sentier n'est pas un point d'intérêt : sur le terrain on veut le suivre,
 * et un GPS affiche une trace comme une ligne à longer. Des points isolés
 * obligeraient à deviner l'ordre.
 */
function tracesVersGPX(traces) {
  const echapper = (v) => String(v).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  const trk = traces.map((s) => `  <trk>
    <name>${echapper(`SEN-${String(s.rang).padStart(3, '0')}`)}</name>
    <desc>${echapper(`score ${s.score.toFixed(2)} · ${s.longueur.toFixed(0)} m · creux ${(s.profondeurMed * 100).toFixed(0)} cm `
      + `· largeur ${s.largeurMed.toFixed(1)} m · pente ${s.penteLongueMed.toFixed(0)}°`)}</desc>
    <trkseg>
${s.gps.map(([lat, lon]) => `      <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"></trkpt>`).join('\n')}
    </trkseg>
  </trk>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Scopus" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Sentiers détectés — Scopus</name><time>${new Date().toISOString()}</time></metadata>
${trk}
</gpx>`;
}

/** GeoJSON de tracés : des LineString. */
function tracesVersGeoJSON(traces, meta = {}) {
  return JSON.stringify({
    type: 'FeatureCollection',
    scopus: { genere: new Date().toISOString(), type: 'sentiers', ...meta },
    features: traces.map((s) => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: s.gps.map(([lat, lon]) => [+lon.toFixed(7), +lat.toFixed(7)]),
      },
      properties: {
        rang: s.rang, score: +s.score.toFixed(3),
        longueur_m: +s.longueur.toFixed(1),
        profondeur_med_m: +s.profondeurMed.toFixed(2),
        largeur_med_m: +s.largeurMed.toFixed(2),
        pente_longue_med_deg: +s.penteLongueMed.toFixed(1),
        alignement_pente: +s.alignementPente.toFixed(3),
        altitude_m: +s.altitude.toFixed(1),
      },
    })),
  }, null, 2);
}

function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  a.click();
  // Révocation différée : Chrome annule le téléchargement si l'URL disparaît
  // avant qu'il ne l'ait lue.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const SORTIE = { rapprocher, liens, versGeoJSON, versCSV, versGPX,
  tracesVersGPX, tracesVersGeoJSON, telecharger };
