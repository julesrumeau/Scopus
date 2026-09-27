// Un encodeur PNG minimal (RVB 8 bits), pour les images des bancs : zlib est
// dans Node, le reste tient en trente lignes.

import { deflateSync } from 'node:zlib';

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(octets) {
  let c = 0xffffffff;
  for (const o of octets) c = TABLE[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloc(type, donnees) {
  const t = Buffer.from(type, 'ascii');
  const b = Buffer.alloc(12 + donnees.length);
  b.writeUInt32BE(donnees.length, 0);
  t.copy(b, 4);
  Buffer.from(donnees).copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([t, Buffer.from(donnees)])), 8 + donnees.length);
  return b;
}

/** PNG d'une image RVB (`rvb` : W × H × 3 octets, ligne 0 en haut). */
export function png(rvb, W, H) {
  const brut = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    brut[y * (W * 3 + 1)] = 0;   // filtre « aucun »
    Buffer.from(rvb.buffer, rvb.byteOffset + y * W * 3, W * 3).copy(brut, y * (W * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut, { level: 6 })), bloc('IEND', Buffer.alloc(0)),
  ]);
}
