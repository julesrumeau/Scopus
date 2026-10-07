// File de requêtes HTTP à parallélisme borné, avec réessai.
//
// La passerelle IGN annonce `x-ratelimit-limit-second: 1` et `ratelimit-limit: 10`,
// et le plafond mord pour de bon : une rafale de 24 requêtes lancées 4 par 4 a
// été refusée en totalité. Charger une zone en demande des centaines, et se
// faire couper au milieu laisserait un nuage troué sans que rien ne le signale.
// On borne donc les requêtes en vol, on réessaie les refus temporaires, et on
// disperse les reprises.

// Deux files, parce que deux services aux limites sans rapport :
//
//  - `defaut` : le téléchargement des COPC, le WFS, le géocodage. L'API de
//    téléchargement est limitée à 10 requêtes par seconde et par IP, et c'est
//    elle qui a dicté les 3 requêtes en vol.
//  - `tuiles` : les tuiles WMTS de la photo aérienne et du plan. Mesuré sans
//    un seul refus jusqu'à ~145 tuiles par seconde, rafales comprises. Les
//    faire passer par la file des COPC les bridait à une dizaine par seconde :
//    6 à 30 s pour la centaine de tuiles d'une dalle.
const files = {
  defaut: { enVol: 0, attente: [], max: () => CONFIG.reseau.requetesParallèles },
  tuiles: { enVol: 0, attente: [], max: () => CONFIG.reseau.requetesParallelesTuiles },
};

function suivant(f) {
  if (f.enVol >= f.max()) return;
  const tache = f.attente.shift();
  if (!tache) return;
  f.enVol++;
  tache.run().then(tache.ok, tache.ko).finally(() => { f.enVol--; suivant(f); });
}

function enfiler(run, nom = 'defaut') {
  const f = files[nom] || files.defaut;
  return new Promise((ok, ko) => { f.attente.push({ run, ok, ko }); suivant(f); });
}

const sommeil = (ms) => new Promise((r) => setTimeout(r, ms));

// La dernière requête restée sans réponse, et qui le demande. L'IGN laisse
// parfois pendre une requête près d'une minute (mesuré le 28 septembre 2026 :
// deux fins de fichier sur trois à 50–59 s avant le premier octet, la
// troisième à 0,5 s). Le réessai repart vite, mais le relief arrive quand
// même par à-coups : mieux vaut le dire que laisser croire à une panne de
// Scopus.
let derniereLenteur = -Infinity;
const ecouteursLenteur = [];
function noterLenteur() {
  derniereLenteur = Date.now();
  for (const f of ecouteursLenteur) f();
}
/** Une requête est-elle restée sans réponse ces `CONFIG.reseau.fenetreLenteurMs` dernières ms ? */
const lenteRecente = () => Date.now() - derniereLenteur < CONFIG.reseau.fenetreLenteurMs;
/** `f` est appelée à chaque requête restée sans réponse. */
const surLenteur = (f) => { ecouteursLenteur.push(f); };

/**
 * Recul exponentiel avec dispersion aléatoire.
 *
 * La dispersion n'est pas un raffinement : toutes les requêtes en vol se font
 * refuser au même instant, et sans elle elles repartiraient toutes ensemble à
 * l'instant suivant. Le limiteur de l'IGN les refuserait de nouveau en bloc,
 * indéfiniment. Le facteur aléatoire brise ce synchronisme.
 */
const recul = (essai) =>
  CONFIG.reseau.reculInitialMs * 2 ** essai * (0.6 + Math.random() * 0.8);

/**
 * GET avec réessai. `signal` permet d'abandonner tout un chargement.
 * @param {string} url
 * @param {{plage?:[number,number], fin?:number, signal?:AbortSignal, type?:'buffer'|'json'|'texte', file?:'defaut'|'tuiles'}} opts
 *   `fin` : les `fin` derniers octets du fichier ; la promesse rend alors
 *   `{ octets, total }`, `total` étant la taille du fichier.
 */
function recuperer(url, opts = {}) {
  const { plage, fin, signal, type = 'buffer', file = 'defaut' } = opts;

  return enfiler(async () => {
    let dernierEchec;

    for (let essai = 0; essai < CONFIG.reseau.tentatives; essai++) {
      if (signal?.aborted) throw new DOMException('Chargement abandonné', 'AbortError');

      try {
        const entetes = plage ? { Range: `bytes=${plage[0]}-${plage[1]}` }
          : fin ? { Range: `bytes=-${fin}` } : undefined;

        // Délai maximal **par tentative**, en plus du signal de l'appelant.
        //
        // `fetch` n'en a aucun : une requête que la passerelle laisse pendre
        // occupe une des trois places en vol indéfiniment, et le chargement
        // entier s'arrête sans message. Observé sur `data.geopf.fr` un jour de
        // charge — un `GetCapabilities` à 22 s, la même requête de blocs à 48 s
        // puis en échec, alors qu'elle répond en 0,2 s en temps normal.
        //
        // Couper et reprendre vaut mieux qu'attendre : le recul exponentiel
        // laisse au serveur le temps de se dégager, et la place en vol repart
        // servir une autre requête entre-temps.
        //
        // Deux délais : `delaiReponseMs` jusqu'à la réponse (les en-têtes),
        // `delaiMaxMs` pour la requête entière. Une requête qui pend ne dit
        // rien avant d'avoir répondu : c'est là qu'on la coupe tôt. Un corps
        // lent à arriver, lui, est une grosse plage sur une connexion lente,
        // qu'il ne faut pas couper pour autant.
        const limite = AbortSignal.timeout(CONFIG.reseau.delaiMaxMs);
        const sansReponse = new AbortController();
        const minuteur = setTimeout(
          () => sansReponse.abort(new DOMException('pas de réponse', 'TimeoutError')),
          CONFIG.reseau.delaiReponseMs);
        let rep;
        try {
          rep = await fetch(url, {
            headers: entetes,
            signal: AbortSignal.any([limite, sansReponse.signal, ...(signal ? [signal] : [])]),
          });
        } finally {
          clearTimeout(minuteur);
        }

        // 429, 5xx **et 400** sont transitoires : on recule et on repart.
        //
        // Le 400 surprend, et c'est mesuré, pas supposé : `data.geopf.fr` répond
        // par intermittence `400 InvalidParameterValue — Layer
        // ORTHOIMAGERY.ORTHOPHOTOS unknown` à une URL parfaitement valide, qui
        // renvoie 200 à l'essai suivant. Relevé sur vingt requêtes identiques :
        // quatre refusées en parallèle, huit en série. La passerelle est
        // répartie sur plusieurs nœuds et certains ignorent la couche.
        //
        // Le prix à payer est qu'une requête réellement malformée sera réessayée
        // six fois avant d'échouer. C'est peu cher : elle échoue quand même, et
        // le message final la désigne.
        if (rep.status === 400 || rep.status === 429 || rep.status >= 500) {
          dernierEchec = new Error(`HTTP ${rep.status} sur ${url}`);
          const entete = rep.headers.get('retry-after');
          await sommeil(entete ? Number(entete) * 1000 : recul(essai));
          continue;
        }
        if (!rep.ok) throw new Error(`HTTP ${rep.status} sur ${url}`);

        if (type === 'json') return await rep.json();
        if (type === 'texte') return await rep.text();

        const buf = new Uint8Array(await rep.arrayBuffer());

        // Fin de fichier : la taille totale est dans « Content-Range » (bytes
        // a-b/total). Sans lui, le serveur a ignoré la plage et le fichier
        // entier est là : on n'en garde que la fin demandée.
        if (fin) {
          const m = /\/(\d+)\s*$/.exec(rep.headers.get('content-range') || '');
          if (m) return { octets: buf, total: Number(m[1]) };
          // Un 206 dont Content-Range n'est pas lisible : l'IGN n'expose pas cet
          // en-tête aux pages web (CORS), la taille du fichier est inconnue.
          // L'appelant la retrouve autrement (COPC.lireFin, table des blocs).
          if (rep.status === 206) return { octets: buf, total: null };
          // Un 200 qui porte au plus les octets demandés : c'est le cache HTTP
          // du navigateur qui a servi la plage (voir « Pièges connus »), pas le
          // fichier entier — la taille reste inconnue.
          if (buf.length <= fin) return { octets: buf, total: null };
          return { octets: buf.length > fin ? buf.subarray(buf.length - fin) : buf, total: buf.length };
        }
        if (!plage) return buf;

        // Le verdict se prend sur la **taille reçue**, jamais sur le statut.
        //
        // Un 200 en réponse à un Range ne veut pas dire que le serveur a ignoré
        // l'en-tête : le cache HTTP du navigateur a le droit de servir la plage
        // lui-même, et il annonce alors 200 avec exactement les octets demandés.
        // Observé en conditions réelles sur data.geopf.fr après un réessai qui
        // avait rempli le cache. Refuser sur le statut faisait échouer un
        // chargement dont les données étaient pourtant justes.
        const attendu = plage[1] - plage[0] + 1;
        if (buf.length === attendu) return buf;

        // Plus long que demandé : là, le Range a bien été ignoré et c'est le
        // fichier entier qui arrive. On extrait la tranche voulue plutôt que de
        // jeter des dizaines de mégaoctets déjà payés — mais on le signale, car
        // répété, ce comportement rend l'outil inutilisable.
        if (buf.length > attendu) {
          console.warn(`Plage ignorée par le serveur (${buf.length} octets pour ${attendu} demandés) — découpe locale.`);
          return buf.subarray(plage[0], plage[1] + 1);
        }

        // Plus court : normal quand la plage dépasse la fin du fichier, ce que
        // fait volontairement la lecture d'en-tête. L'appelant s'en accommode.
        return buf;

      } catch (e) {
        // Seul l'abandon **de l'appelant** est définitif : c'est l'utilisateur
        // qui a annulé, ou une nouvelle dalle qui remplace l'ancienne. Le délai
        // maximal, lui, arrive aussi sous la forme d'un abandon, et doit au
        // contraire être réessayé — les confondre rendait un chargement
        // définitivement perdu pour une seule requête trop lente.
        if (signal?.aborted) throw e;
        const delai = e.name === 'TimeoutError' || e.name === 'AbortError';
        if (delai) noterLenteur();
        dernierEchec = delai ? new Error(`délai dépassé sur ${url} : pas de réponse de l’IGN`) : e;
        // Une panne réseau franche mérite aussi un réessai : le Wi-Fi qui
        // hoquette au milieu de 400 requêtes est le cas nominal, pas l'exception.
        if (essai < CONFIG.reseau.tentatives - 1) await sommeil(recul(essai));
      }
    }
    throw dernierEchec;
  }, file);
}

/**
 * Traduit une panne en une phrase qui dit **quoi faire**.
 *
 * « HTTP 429 sur https://data.geopf.fr/… » est exact et parfaitement inutile :
 * l'utilisateur ne sait pas si c'est sa faute, si ça se répare, ni s'il doit
 * attendre. Or chaque panne a une conduite à tenir différente — attendre pour un
 * 429, relancer pour un délai dépassé, vérifier son réseau pour un échec de
 * connexion — et c'est cette conduite qui manque, pas le code d'erreur.
 *
 * Le message brut est rendu tel quel quand il n'est pas reconnu : mieux vaut une
 * phrase technique qu'une phrase rassurante et fausse.
 */
function expliquer(e) {
  const m = String((e && e.message) || e || '');

  // L'état hors ligne prime sur tout le reste : c'est la seule cause qui rende
  // les autres diagnostics trompeurs.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'Vous êtes hors ligne. Scopus lit les données de l’IGN en direct : '
      + 'rétablissez la connexion, puis relancez.';
  }
  if (/HTTP 429/.test(m)) {
    return 'L’IGN limite le nombre de requêtes et vient de refuser les nôtres. '
      + 'Attendez une minute avant de relancer : une résolution plus grossière en demande moins.';
  }
  if (/HTTP 5\d\d/.test(m)) {
    return 'Le service de l’IGN est en difficulté (erreur serveur). '
      + 'Rien à corriger de votre côté : réessayez dans quelques minutes.';
  }
  if (/HTTP 404/.test(m)) {
    return 'L’IGN ne trouve pas cette donnée (404). La zone n’est peut-être pas couverte.';
  }
  if (/délai dépassé/.test(m)) {
    return 'Les serveurs de l’IGN semblent très sollicités en ce moment et n’ont pas pu répondre à temps. '
      + 'Rien à faire de votre côté : vous pouvez réessayer d’ici quelques minutes.';
  }
  if (/Failed to fetch|NetworkError|network error|Load failed/i.test(m)) {
    return 'La connexion à data.geopf.fr a échoué. Vérifiez votre réseau : '
      + 'un bloqueur de contenu ou un VPN peut aussi couper l’accès.';
  }
  return m;
}

const RESEAU = { recuperer, expliquer, lenteRecente, surLenteur };
