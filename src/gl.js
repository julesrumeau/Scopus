// Helpers WebGL2 minimalistes. Repris de FlowField (`src/gl.js`), réduit à ce
// dont le rendu de nuage a besoin. Même forme que là-bas — script classique
// exposant un global — et pour la même raison : l'ouverture en `file://`, où
// les modules ES sont refusés.
//
// Ce qui vient de FlowField sans changement : `compile`, `program` (avec la
// pré-résolution des uniforms), `createTarget`, les trois fonctions de matrices
// et `hexToRgb`. Ce qui a été retiré : `grid` et `fullscreenTriangle`, propres
// au rendu d'isolignes.

const GL = {

  compile(gl, type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
      gl.deleteShader(sh);
      throw new Error(`Compilation du shader ${kind} échouée :\n${log}`);
    }
    return sh;
  },

  // Lie un programme et pré-résout tous ses uniforms actifs dans `.u`, pour
  // éviter un getUniformLocation à chaque frame.
  program(gl, vsSource, fsSource) {
    const vs = GL.compile(gl, gl.VERTEX_SHADER, vsSource);
    const fs = GL.compile(gl, gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`Édition de liens échouée :\n${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    prog.u = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, '');
      prog.u[name] = gl.getUniformLocation(prog, name);
    }
    return prog;
  },

  // ── Matrices 4×4, stockage colonne-majeur (convention GLSL) ───────────────

  perspective(fovYdeg, aspect, near, far) {
    const f = 1 / Math.tan((fovYdeg * Math.PI / 180) / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },

  lookAt(eye, center, up) {
    const [ex, ey, ez] = eye;
    let zx = ex - center[0], zy = ey - center[1], zz = ez - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * ex + xy * ey + xz * ez),
      -(yx * ex + yy * ey + yz * ez),
      -(zx * ex + zy * ey + zz * ez),
      1,
    ]);
  },

  multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                       + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  },

  // '#8f9aa8' → [0.56, 0.60, 0.66], directement injectable en vec3.
  hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  },

  /**
   * Table de correspondance classification → couleur, en texture 256×1.
   *
   * Une texture plutôt qu'un tableau d'uniforms : les classes LiDAR montent
   * jusqu'à 67 côté IGN, et un `uniform vec3[68]` consommerait l'essentiel du
   * budget d'uniforms d'un GPU intégré pour une donnée qui ne change jamais.
   */
  paletteClasses(gl, couleurs, defaut) {
    const px = new Uint8Array(256 * 4);
    const [dr, dg, db] = GL.hexToRgb(defaut).map((v) => v * 255);
    for (let i = 0; i < 256; i++) {
      px[i * 4] = dr; px[i * 4 + 1] = dg; px[i * 4 + 2] = db; px[i * 4 + 3] = 255;
    }
    for (const [cls, hex] of Object.entries(couleurs)) {
      const [r, g, b] = GL.hexToRgb(hex).map((v) => v * 255);
      const i = Number(cls);
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // NEAREST impératif : une interpolation entre deux classes voisines
    // produirait une couleur qui ne correspond à aucune classe réelle.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  },
};
