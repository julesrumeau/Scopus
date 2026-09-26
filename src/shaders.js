// Shaders du rendu de nuage. Un programme pour les points, un pour les
// surlignages filaires.
//
// Repère : les données sont en Lambert-93 local (X est, Y nord, Z altitude).
// Le passage au repère OpenGL (Y vers le haut, -Z vers l'avant) se fait ici,
// dans le vertex shader, plutôt qu'au remplissage des buffers — les tableaux
// restent ainsi directement comparables aux grilles de détection, où le même
// point garde les mêmes coordonnées.

const SHADERS = {

  pointsVS: `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_pos;      // x est, y nord, z altitude (mètres, locaux)
layout(location = 1) in float a_classe;
layout(location = 2) in float a_intensite;  // déjà normalisée dans [0,1]
layout(location = 3) in float a_hauteur;    // hauteur au-dessus du terrain, m

uniform mat4 u_vp;
uniform vec3 u_camera;
uniform float u_taillePoint;
uniform float u_attenuation;   // 1 = taille décroissante avec la distance
uniform float u_hauteurViewport;
uniform float u_exagerationZ;
uniform float u_zmin;
uniform float u_zref;          // amplitude d'altitude, pour la colorisation
uniform int u_mode;            // 0 élévation · 1 classification · 2 intensité · 3 hauteur · 4 relief
uniform sampler2D u_palette;

// Zone mise en avant (une détection sélectionnée) : au-delà, les points sont
// désaturés. C'est ce qui rend une tache de 3 m lisible au milieu d'un nuage
// de plusieurs millions de points.
uniform vec4 u_focus;          // xmin, ymin, xmax, ymax en coordonnées locales
uniform float u_focusActif;

out vec3 v_couleur;
out float v_attenue;

// Rampe hypsométrique : bleu profond → vert → ocre → blanc. Interpolation
// linéaire entre cinq arrêts, suffisante pour lire un relief.
vec3 rampeElevation(float t) {
  const vec3 c0 = vec3(0.13, 0.20, 0.33);
  const vec3 c1 = vec3(0.16, 0.42, 0.40);
  const vec3 c2 = vec3(0.45, 0.60, 0.32);
  const vec3 c3 = vec3(0.78, 0.66, 0.38);
  const vec3 c4 = vec3(0.96, 0.96, 0.94);
  t = clamp(t, 0.0, 1.0) * 4.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  return mix(c3, c4, t - 3.0);
}

// Rampe de hauteur au-dessus du sol : le sol reste sombre, tout ce qui dépasse
// s'allume. C'est la vue la plus directe pour repérer une structure.
vec3 rampeHauteur(float h) {
  float t = clamp(h / 8.0, 0.0, 1.0);
  vec3 bas = vec3(0.18, 0.19, 0.22);
  vec3 mid = vec3(0.90, 0.72, 0.28);
  vec3 haut = vec3(0.95, 0.35, 0.25);
  return t < 0.35 ? mix(bas, mid, t / 0.35) : mix(mid, haut, (t - 0.35) / 0.65);
}

// Rampe de relief : gris franc, du sombre au clair.
//
// Volontairement neutre, et volontairement la même que celle de l'onglet Relief.
// Une couche d'ombrage ou d'ouverture se lit par le **modelé**, pas par la
// valeur : y mettre des couleurs ferait croire à une échelle qui n'existe pas,
// et empêcherait de comparer l'image 2D et le nuage d'un coup d'œil.
vec3 rampeRelief(float v) {
  float t = clamp(v, 0.0, 1.0);
  return vec3(0.05 + 0.93 * t);
}

void main() {
  // Couleur ET visibilité de la classe, en une lecture.
  //
  // « textureLod » et non « texture » : l'échantillonnage à LOD implicite est
  // interdit en vertex shader, où les dérivées d'écran n'existent pas. Certains
  // pilotes l'acceptent quand même, d'autres refusent de compiler. La palette
  // n'ayant pas de mipmaps, le niveau 0 est exact.
  vec4 pal = textureLod(u_palette, vec2((a_classe + 0.5) / 256.0, 0.5), 0.0);

  // Classe masquée : le point est rejeté hors du volume de vue plutôt que rendu
  // transparent. Un point transparent écrirait quand même dans le tampon de
  // profondeur et masquerait ce qui se trouve derrière.
  if (pal.a < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec3 monde = vec3(a_pos.x, (a_pos.z - u_zmin) * u_exagerationZ, -a_pos.y);
  gl_Position = u_vp * vec4(monde, 1.0);

  float dist = distance(u_camera, monde);

  // Taille en pixels : à attenuation 1, un point garde une taille constante en
  // *mètres* projetés, ce qui donne une densité visuelle stable quand on
  // s'approche. Sans ça, un zoom rapproché laisse voir entre les points.
  float taille = u_taillePoint;
  if (u_attenuation > 0.5) {
    taille = u_taillePoint * u_hauteurViewport / max(dist, 1.0) * 0.02;
  }
  // Un plancher fixe à 1 px annulait le curseur dès qu'on s'éloigne : aux
  // réglages par défaut, tout point à plus de 30-60 m de la caméra tombe déjà
  // sous 1 px et s'y fige, donc le curseur ne fait plus rien sur une dalle
  // entière (vue à plus d'un kilomètre) — précisément le cas signalé. Le
  // plancher suit maintenant le réglage plutôt qu'une constante : loin, les
  // points restent minuscules, mais le curseur y reste sensible.
  float plancher = clamp(u_taillePoint * 0.3, 1.0, 6.0);
  gl_PointSize = clamp(taille, plancher, 24.0);

  if (u_mode == 0)      v_couleur = rampeElevation((a_pos.z - u_zmin) / max(u_zref, 1.0));
  else if (u_mode == 1) v_couleur = pal.rgb;
  else if (u_mode == 2) v_couleur = vec3(0.25 + 0.75 * a_intensite);
  else if (u_mode == 3) v_couleur = rampeHauteur(a_hauteur);
  // Le mode relief réutilise l'attribut de hauteur, qui porte alors la valeur de
  // la couche déjà ramenée dans [0, 1]. Un attribut de plus coûterait 18 Mo de
  // VRAM sur une dalle, pour une donnée dont on n'a jamais besoin des deux à la
  // fois.
  else                  v_couleur = rampeRelief(a_hauteur);

  float dedans = 1.0;
  if (u_focusActif > 0.5) {
    dedans = step(u_focus.x, a_pos.x) * step(a_pos.x, u_focus.z)
           * step(u_focus.y, a_pos.y) * step(a_pos.y, u_focus.w);
  }
  v_attenue = mix(0.22, 1.0, dedans);
}`,

  pointsFS: `#version 300 es
precision highp float;

in vec3 v_couleur;
in float v_attenue;
out vec4 fragColor;

uniform float u_ronds;

void main() {
  if (u_ronds > 0.5) {
    // Découpe en disque. « discard » plutôt qu'un alpha : le test de profondeur
    // doit rejeter le coin du sprite, sinon un point proche masque ses voisins
    // sur toute son emprise carrée.
    vec2 d = gl_PointCoord - vec2(0.5);
    if (dot(d, d) > 0.25) discard;
  }
  vec3 c = mix(vec3(dot(v_couleur, vec3(0.299, 0.587, 0.114))), v_couleur, v_attenue);
  fragColor = vec4(c * mix(0.55, 1.0, v_attenue), 1.0);
}`,

  lignesVS: `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_pos;

uniform mat4 u_vp;
uniform float u_exagerationZ;
uniform float u_zmin;
// Tout ce qui suit est ignoré pour un dessin en LINES — gl_PointSize n'a de
// sens qu'en POINTS — mais partagé avec les marqueurs (sélection, mesure)
// pour ne pas dupliquer tout un programme rien que pour un point coloré, et
// surtout pour qu'ils réagissent à la distance **exactement** comme les
// points du nuage (pointsVS) : sinon un marqueur à taille fixe en pixels
// se met à grossir ou rapetisser par rapport au nuage qui l'entoure dès
// qu'on zoome, ce qui brouille la lecture plutôt que de la clarifier.
uniform vec3 u_camera;
uniform float u_hauteurViewport;
uniform float u_attenuation;
uniform float u_taillePoint;

void main() {
  vec3 monde = vec3(a_pos.x, (a_pos.z - u_zmin) * u_exagerationZ, -a_pos.y);
  gl_Position = u_vp * vec4(monde, 1.0);

  float taille = u_taillePoint;
  if (u_attenuation > 0.5) {
    float dist = distance(u_camera, monde);
    taille = u_taillePoint * u_hauteurViewport / max(dist, 1.0) * 0.02;
  }
  // Le plancher des points du nuage (pointsVS) descend volontairement bas —
  // à peine 1 px au réglage par défaut, pour rester discret de loin. Un
  // marqueur, lui, doit rester trouvable à n'importe quelle distance : 10 px
  // plancher fixe, quoi qu'il arrive, pas une fraction de la taille demandée.
  float plancher = max(10.0, u_taillePoint * 0.5);
  gl_PointSize = clamp(taille, plancher, 96.0);
}`,

  lignesFS: `#version 300 es
precision highp float;
uniform vec4 u_couleur;
// 1 pour un dessin en POINTS qu'on veut rond (marqueurs) — sans objet pour un
// dessin en LINES, où gl_PointCoord n'a pas de valeur définie.
uniform float u_pointRond;
out vec4 fragColor;
void main() {
  if (u_pointRond > 0.5) {
    vec2 d = gl_PointCoord - vec2(0.5);
    if (dot(d, d) > 0.25) discard;
  }
  fragColor = u_couleur;
}`,

  // ── Calcul du relief sur la carte graphique (gpu-relief.js) ─────────────────
  //
  // Chaque noyau est la traduction ligne à ligne de sa version processeur dans
  // relief.js, qui reste la référence : mêmes bornes, mêmes cellules écartées.
  // Une cellule de sortie = un fragment ; un seul triangle couvre la cible.
  // Les grilles sont des textures dont la ligne 0 est au sud, comme les
  // tableaux du projet : les indices se correspondent sans retournement.

  reliefVS: `#version 300 es
in vec2 a_p;
void main() { gl_Position = vec4(a_p, 0.0, 1.0); }`,

  // Balayage d'horizons : SVF, ouverture positive et négative en une passe,
  // comme RELIEF.balayerHorizons. Entrée RG = (altitude, validité). Pour chaque
  // direction, le pas le long de l'axe dominant est entier, l'autre axe est
  // interpolé ; un échantillon hors grille ou touchant une cellule invalide
  // est ignoré, ce que fait NaN côté processeur. Les directions arrivent
  // calculées en double précision par le JavaScript : en simple précision,
  // cos(90 degrés) vaut -4e-8 et le rayon plein nord lirait la colonne voisine.
  //
  // Le pas sur l'axe mineur arrive en deux morceaux, sa valeur en simple
  // précision et le reste. En diagonale il vaut 0,9999999999999998 : arrondi
  // à 1, le plancher désigne la ligne suivante, et l'échantillon sort de la
  // grille (ou touche un trou) une ligne trop tôt. Le plancher se recompose
  // donc avec le reste, pour tomber sur la même ligne que le processeur.
  horizonsFS: `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D u_grille;
uniform int u_W; uniform int u_H; uniform int u_n;
uniform vec4 u_dir[32];   // pas en x, pas en y (en cellules par pas), distance par pas (m), nombre de pas
uniform vec2 u_dirReste[32];   // ce que la simple précision perd de ces deux pas
uniform bool u_majeurX[32];
out vec4 o;
// Plancher et partie fractionnaire de (hi + lo) * k, sans perdre lo. On part
// de l'entier le plus proche : l'écart à cet entier se calcule exactement,
// son signe dit de quel côté tombe le plancher. Partir de floor(a) échoue
// quand a vaut -2e-16 : a - floor(a) s'arrondit à 1 et désigne la mauvaise
// colonne (vu sur les colonnes de bord, rayons plein nord et plein sud).
void plancher(float hi, float lo, float k, out float f0, out float t) {
  float a = hi * k;
  float n = round(a);
  float e = (a - n) + lo * k;
  if (e >= 0.0) { f0 = n; t = e; } else { f0 = n - 1.0; t = 1.0 + e; }
}
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  vec2 c = texelFetch(u_grille, ivec2(x, y), 0).rg;
  if (c.g < 0.5) { o = vec4(0.0); return; }
  float z0 = c.r, svf = 0.0, pos = 0.0, neg = 0.0;
  for (int d = 0; d < u_n; d++) {
    vec4 D = u_dir[d];
    int K = int(D.w);
    float maxTan = -1e30, minTan = 1e30;
    for (int k = 1; k <= K; k++) {
      float fx = D.x * float(k), dist = D.z * float(k), f0, t;
      vec2 s0, s1;
      if (u_majeurX[d]) {
        plancher(D.y, u_dirReste[d].y, float(k), f0, t);
        int xa = x + int(round(fx)); int ya = y + int(f0);
        if (xa < 0 || xa >= u_W || ya < 0 || ya + 1 >= u_H) continue;
        s0 = texelFetch(u_grille, ivec2(xa, ya), 0).rg; s1 = texelFetch(u_grille, ivec2(xa, ya + 1), 0).rg;
      } else {
        plancher(D.x, u_dirReste[d].x, float(k), f0, t);
        int ya = y + int(round(D.y * float(k))); int xa = x + int(f0);
        if (ya < 0 || ya >= u_H || xa < 0 || xa + 1 >= u_W) continue;
        s0 = texelFetch(u_grille, ivec2(xa, ya), 0).rg; s1 = texelFetch(u_grille, ivec2(xa + 1, ya), 0).rg;
      }
      if (s0.g < 0.5 || s1.g < 0.5) continue;
      float tanv = ((1.0 - t) * s0.r + t * s1.r - z0) / dist;
      maxTan = max(maxTan, tanv);
      minTan = min(minTan, tanv);
    }
    float haut = maxTan < -1e29 ? 0.0 : maxTan;
    float bas = minTan > 1e29 ? 0.0 : minTan;
    float u = max(haut, 0.0);
    svf += u / sqrt(1.0 + u * u);
    pos += 1.5707963267948966 - atan(haut);
    neg += 1.5707963267948966 + atan(bas);
  }
  float versDeg = 57.29577951308232 / float(u_n);
  o = vec4(1.0 - svf / float(u_n), pos * versDeg, neg * versDeg, 1.0);
}`,

  // Ombrage de Horn, jusqu'à quatre soleils à la fois (un par canal), comme
  // RELIEF.gradients puis RELIEF.ombrage. Lectures bornées au bord de la
  // grille, comme la fonction lire() côté processeur. Entrée R = altitude.
  ombragesFS: `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D u_grille;
uniform int u_W; uniform int u_H; uniform float u_pas;
uniform vec3 u_soleil[4];
uniform int u_nbSoleils;
out vec4 o;
float z(int x, int y) { return texelFetch(u_grille, ivec2(clamp(x, 0, u_W - 1), clamp(y, 0, u_H - 1)), 0).r; }
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  float a = z(x - 1, y + 1), b = z(x, y + 1), c = z(x + 1, y + 1);
  float d = z(x - 1, y), f = z(x + 1, y);
  float g = z(x - 1, y - 1), h = z(x, y - 1), i = z(x + 1, y - 1);
  float gx = ((c + 2.0 * f + i) - (a + 2.0 * d + g)) / (8.0 * u_pas);
  float gy = ((a + 2.0 * b + c) - (g + 2.0 * h + i)) / (8.0 * u_pas);
  float nx = -gx, ny = -gy;
  float inv = 1.0 / sqrt(nx * nx + ny * ny + 1.0);
  vec4 r = vec4(0.0);
  for (int s = 0; s < 4; s++) {
    if (s >= u_nbSoleils) break;
    vec3 L = u_soleil[s];
    r[s] = max((nx * L.x + ny * L.y + L.z) * inv, 0.0);
  }
  o = r;
}`,

  // Micro-relief, étape 1 : altitude pondérée et poids (R, G), comme la boucle
  // qui prépare la convolution normalisée de RELIEF.microRelief. Les
  // altitudes sont centrées sur u_ref pour que la somme de la boîte garde sa
  // précision en simple précision ; la soustraction finale l'annule.
  microPrepFS: `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D u_grille;
uniform float u_ref;
out vec4 o;
void main() {
  vec2 c = texelFetch(u_grille, ivec2(gl_FragCoord.xy), 0).rg;
  o = c.g > 0.5 ? vec4(c.r - u_ref, 1.0, 0.0, 0.0) : vec4(0.0);
}`,

  // Micro-relief, étape 2 : une boîte horizontale ou verticale sur (R, G), la
  // moyenne sur la seule partie de la fenêtre qui tombe dans la grille, comme
  // boiteH et boiteV (fenêtre de debut à fin, bornée aux bords).
  boiteFS: `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D u_src;
uniform int u_W; uniform int u_H; uniform int u_r; uniform bool u_horizontal;
out vec4 o;
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  int p = u_horizontal ? x : y, lim = u_horizontal ? u_W : u_H;
  int debut = max(0, p - u_r), fin = min(lim - 1, p + u_r);
  vec2 somme = vec2(0.0);
  for (int k = debut; k <= fin; k++) {
    somme += texelFetch(u_src, u_horizontal ? ivec2(k, y) : ivec2(x, k), 0).rg;
  }
  o = vec4(somme / float(fin - debut + 1), 0.0, 0.0);
}`,

  // Micro-relief, étape 3 : altitude moins moyenne locale, dans la marge de
  // trois rayons seulement et là où le poids lissé dépasse 0,05, comme la
  // boucle finale de RELIEF.microRelief. A = 1 si la valeur est définie.
  microFinFS: `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D u_grille;
uniform highp sampler2D u_lisse;
uniform int u_W; uniform int u_H; uniform int u_marge; uniform float u_ref;
out vec4 o;
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  vec2 c = texelFetch(u_grille, ivec2(x, y), 0).rg;
  vec2 s = texelFetch(u_lisse, ivec2(x, y), 0).rg;
  bool dedans = x >= u_marge && x < u_W - u_marge && y >= u_marge && y < u_H - u_marge;
  if (!dedans || c.g < 0.5 || s.g <= 0.05) { o = vec4(0.0); return; }
  o = vec4((c.r - u_ref) - s.r / s.g, 0.0, 0.0, 1.0);
}`,
};
