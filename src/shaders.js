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
uniform int u_mode;            // 0 élévation · 1 classification · 2 intensité · 3 hauteur
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

void main() {
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
  gl_PointSize = clamp(taille, 1.0, 24.0);

  if (u_mode == 0)      v_couleur = rampeElevation((a_pos.z - u_zmin) / max(u_zref, 1.0));
  else if (u_mode == 1) v_couleur = texture(u_palette, vec2((a_classe + 0.5) / 256.0, 0.5)).rgb;
  else if (u_mode == 2) v_couleur = vec3(0.25 + 0.75 * a_intensite);
  else                  v_couleur = rampeHauteur(a_hauteur);

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

void main() {
  gl_Position = u_vp * vec4(a_pos.x, (a_pos.z - u_zmin) * u_exagerationZ, -a_pos.y, 1.0);
}`,

  lignesFS: `#version 300 es
precision highp float;
uniform vec4 u_couleur;
out vec4 fragColor;
void main() { fragColor = u_couleur; }`,
};
