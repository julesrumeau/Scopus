// Cache disque des octets compressés des blocs COPC.
//
// Une zone déjà vue ne doit plus coûter de réseau, même le lendemain : le
// débit de l'IGN (~4 dalles/s au niveau 0, ~4 Mo/s au-delà) est la seule
// limite qu'on ne contrôle pas. On garde les octets **compressés** (5 à 10
// octets par point), sous un quota, le moins récemment lu effacé d'abord.
//
// Le cache ne fait jamais échouer un chargement : navigation privée,
// IndexedDB refusé ou quota du navigateur atteint, il se tait et le réseau
// sert tout.

const CACHE_DISQUE = (() => {
  function creer(stockage, quotaOctets, maintenant = Date.now) {
    let meta = null;   // Map<cle, {taille, acces}>
    let total = 0;
    let enPanne = false;

    async function ouvrir() {
      if (meta || enPanne) return;
      try {
        const m = new Map();
        let t = 0;
        for (const [cle, v] of await stockage.meta()) { m.set(cle, v); t += v.taille; }
        meta = m;
        total = t;
      } catch {
        enPanne = true;
      }
    }

    async function lire(cle) {
      await ouvrir();
      if (enPanne || !meta.has(cle)) return null;
      try {
        const o = await stockage.get(cle);
        if (!o) { total -= meta.get(cle).taille; meta.delete(cle); return null; }
        const v = meta.get(cle);
        v.acces = maintenant();
        stockage.putMeta(cle, v).catch(() => {});
        return o;
      } catch {
        return null;
      }
    }

    async function ecrire(cle, octets) {
      await ouvrir();
      if (enPanne || octets.byteLength > quotaOctets || meta.has(cle)) return;
      try {
        const parAge = [...meta.entries()].sort((a, b) => a[1].acces - b[1].acces);
        while (total + octets.byteLength > quotaOctets && parAge.length) {
          const [vieux, v] = parAge.shift();
          await stockage.del(vieux);
          meta.delete(vieux);
          total -= v.taille;
        }
        const v = { taille: octets.byteLength, acces: maintenant() };
        await stockage.put(cle, octets, v);
        meta.set(cle, v);
        total += v.taille;
      } catch {
        // Quota du navigateur, disque plein : on continue sans ce bloc.
      }
    }

    return { lire, ecrire, total: () => total };
  }

  function stockageMemoire() {
    const octets = new Map();
    const metas = new Map();
    return {
      meta: async () => [...metas.entries()].map(([k, v]) => [k, { ...v }]),
      get: async (cle) => octets.get(cle) || null,
      put: async (cle, o, v) => { octets.set(cle, o.slice()); metas.set(cle, { ...v }); },
      putMeta: async (cle, v) => { if (metas.has(cle)) metas.set(cle, { ...v }); },
      del: async (cle) => { octets.delete(cle); metas.delete(cle); },
    };
  }

  function stockageIndexedDB(nom = 'scopus-flux') {
    let base = null;
    const ouvrir = () => base || (base = new Promise((ok, ko) => {
      const r = indexedDB.open(nom, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('octets');
        r.result.createObjectStore('meta');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    }));
    const requete = async (magasin, mode, action) => {
      const db = await ouvrir();
      return new Promise((ok, ko) => {
        const tx = db.transaction(magasin, mode);
        const r = action(tx.objectStore(magasin));
        tx.oncomplete = () => ok(r?.result);
        tx.onerror = () => ko(tx.error);
        tx.onabort = () => ko(tx.error);
      });
    };
    return {
      async meta() {
        const db = await ouvrir();
        return new Promise((ok, ko) => {
          const out = [];
          const r = db.transaction('meta', 'readonly').objectStore('meta').openCursor();
          r.onsuccess = () => { const c = r.result; if (!c) { ok(out); return; } out.push([c.key, c.value]); c.continue(); };
          r.onerror = () => ko(r.error);
        });
      },
      get: async (cle) => {
        const v = await requete('octets', 'readonly', (s) => s.get(cle));
        return v ? new Uint8Array(v) : null;
      },
      put: async (cle, o, v) => {
        await requete('octets', 'readwrite', (s) => s.put(o.slice().buffer, cle));
        await requete('meta', 'readwrite', (s) => s.put(v, cle));
      },
      putMeta: (cle, v) => requete('meta', 'readwrite', (s) => s.put(v, cle)),
      del: async (cle) => {
        await requete('octets', 'readwrite', (s) => s.delete(cle));
        await requete('meta', 'readwrite', (s) => s.delete(cle));
      },
    };
  }

  return { creer, stockageMemoire, stockageIndexedDB };
})();
