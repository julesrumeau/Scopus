// Accès aux services IGN : grille des dalles LiDAR HD, bâti BD TOPO, fonds WMTS.
//
// Tout passe par data.geopf.fr, qui répond `access-control-allow-origin: *` sur
// le WFS comme sur le téléchargement — d'où l'absence de proxy dans ce projet.

function urlWFS(params) {
  const p = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
    OUTPUTFORMAT: 'application/json', ...params,
  });
  return `${CONFIG.ign.wfs}?${p}`;
}

/**
 * Dalles LiDAR HD intersectant une fenêtre géographique.
 *
 * Le BBOX WFS 2.0 en CRS urn attend l'ordre (lat, lon) : l'ordre des axes suit
 * la définition officielle d'EPSG:4326, pas l'habitude « lon, lat » du GeoJSON.
 * Inverser les deux ne produit aucune erreur, juste zéro résultat.
 */
async function dalles(sud, ouest, nord, est, signal) {
  const rep = await RESEAU.recuperer(urlWFS({
    TYPENAMES: CONFIG.ign.coucheDalles,
    COUNT: '600',
    BBOX: `${sud},${ouest},${nord},${est},urn:ogc:def:crs:EPSG::4326`,
  }), { type: 'json', signal });

  return (rep.features || []).map((f) => {
    const p = f.properties;
    let meta = {};
    try { meta = JSON.parse(p.metadata || '{}'); } catch { /* métadonnée absente ou malformée : sans conséquence */ }

    // Le nom porte les coordonnées kilométriques du coin nord-ouest :
    // LHD_FXX_0564_6196_… ⇒ X ∈ [564000, 565000], Y ∈ [6195000, 6196000].
    const m = /_(\d{4})_(\d{4})_/.exec(p.name || '');
    const emprise = m ? {
      xmin: +m[1] * 1000, xmax: (+m[1] + 1) * 1000,
      ymin: (+m[2] - 1) * 1000, ymax: +m[2] * 1000,
    } : null;

    return {
      id: p.id,
      nom: p.name,
      url: p.url,
      format: p.format,
      emprise,
      anneau: anneauExterieur(f.geometry),
      nbPoints: meta.nombre_points ?? null,
      dateAcquisition: meta.date_fin_acquisition ?? null,
      systemeAltimetrique: meta.systeme_altimetrique ?? null,
    };
  }).filter((d) => d.url && d.emprise);
}

// Contour externe d'une (Multi)Polygon GeoJSON, en [lat, lon] pour Leaflet.
function anneauExterieur(geom) {
  if (!geom) return [];
  const coords = geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : geom.coordinates[0];
  return coords.map(([lon, lat]) => [lat, lon]);
}

/**
 * Emprises du bâti BD TOPO sur une zone Lambert-93, pour écarter les détections
 * déjà cartographiées.
 *
 * `SRSNAME=EPSG:2154` fait répondre le service directement en Lambert-93 : on
 * compare dans le même repère que les détections, sans aller-retour de
 * projection.
 */
async function batiments(emprise, signal) {
  const so = PROJ.versWGS84(emprise.xmin, emprise.ymin);
  const ne = PROJ.versWGS84(emprise.xmax, emprise.ymax);

  const rep = await RESEAU.recuperer(urlWFS({
    TYPENAMES: CONFIG.ign.coucheBati,
    COUNT: '2000',
    SRSNAME: 'EPSG:2154',
    BBOX: `${so.lat},${so.lon},${ne.lat},${ne.lon},urn:ogc:def:crs:EPSG::4326`,
  }), { type: 'json', signal });

  return (rep.features || []).map((f) => {
    const g = f.geometry;
    if (!g) return null;
    const anneau = g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.coordinates[0];
    let sx = 0, sy = 0;
    for (const c of anneau) { sx += c[0]; sy += c[1]; }
    return {
      cx: sx / anneau.length,
      cy: sy / anneau.length,
      nature: f.properties?.nature || f.properties?.usage_1 || 'bâtiment',
      // Le contour sert au test de proximité arête à arête : un hangar allongé
      // dont le centre est loin n'en reste pas moins tout proche par son bord.
      contour: anneau.map((c) => [c[0], c[1]]),
    };
  }).filter(Boolean);
}

/** Gabarit d'URL WMTS pour Leaflet. */
function gabaritWMTS(cle) {
  const f = CONFIG.ign.fonds[cle];
  const p = new URLSearchParams({
    SERVICE: 'WMTS', VERSION: '1.0.0', REQUEST: 'GetTile',
    LAYER: f.couche, STYLE: 'normal', TILEMATRIXSET: 'PM', FORMAT: f.format,
    TILEMATRIX: '{z}', TILEROW: '{y}', TILECOL: '{x}',
  });
  // Leaflet substitue {x}/{y}/{z} ; URLSearchParams les a encodés en %7B…%7D.
  return `${CONFIG.ign.wmts}?${p}`.replace(/%7B/g, '{').replace(/%7D/g, '}');
}

const IGN = { dalles, batiments, gabaritWMTS };
