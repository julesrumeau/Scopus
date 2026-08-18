// File de requêtes HTTP à parallélisme borné, avec réessai.
//
// La passerelle IGN annonce `x-ratelimit-limit-second: 1` et `ratelimit-limit: 10`,
// et le plafond mord pour de bon : une rafale de 24 requêtes lancées 4 par 4 a
// été refusée en totalité. Charger une zone en demande des centaines, et se
// faire couper au milieu laisserait un nuage troué sans que rien ne le signale.
// On borne donc les requêtes en vol, on réessaie les refus temporaires, et on
// disperse les reprises.

let enVol = 0;
const attente = [];

function suivant() {
  if (enVol >= CONFIG.reseau.requetesParallèles) return;
  const tache = attente.shift();
  if (!tache) return;
  enVol++;
  tache.run().then(tache.ok, tache.ko).finally(() => { enVol--; suivant(); });
}

function enfiler(run) {
  return new Promise((ok, ko) => { attente.push({ run, ok, ko }); suivant(); });
}

const sommeil = (ms) => new Promise((r) => setTimeout(r, ms));

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
 * @param {{plage?:[number,number], signal?:AbortSignal, type?:'buffer'|'json'|'texte'}} opts
 */
function recuperer(url, opts = {}) {
  const { plage, signal, type = 'buffer' } = opts;

  return enfiler(async () => {
    let dernierEchec;

    for (let essai = 0; essai < CONFIG.reseau.tentatives; essai++) {
      if (signal?.aborted) throw new DOMException('Chargement abandonné', 'AbortError');

      try {
        const entetes = plage ? { Range: `bytes=${plage[0]}-${plage[1]}` } : undefined;

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
        const limite = AbortSignal.timeout(CONFIG.reseau.delaiMaxMs);
        const rep = await fetch(url, {
          headers: entetes,
          signal: signal ? AbortSignal.any([signal, limite]) : limite,
        });

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
        dernierEchec = e.name === 'TimeoutError' || e.name === 'AbortError'
          ? new Error(`délai de ${CONFIG.reseau.delaiMaxMs} ms dépassé sur ${url}`)
          : e;
        // Une panne réseau franche mérite aussi un réessai : le Wi-Fi qui
        // hoquette au milieu de 400 requêtes est le cas nominal, pas l'exception.
        if (essai < CONFIG.reseau.tentatives - 1) await sommeil(recul(essai));
      }
    }
    throw dernierEchec;
  });
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
      + 'Attendez une minute avant de relancer — une résolution plus grossière en demande moins.';
  }
  if (/HTTP 5\d\d/.test(m)) {
    return 'Le service de l’IGN est en difficulté (erreur serveur). '
      + 'Rien à corriger de votre côté : réessayez dans quelques minutes.';
  }
  if (/HTTP 404/.test(m)) {
    return 'L’IGN ne trouve pas cette donnée (404). La zone n’est peut-être pas couverte.';
  }
  if (/délai de \d+ ms dépassé/.test(m)) {
    return 'L’IGN n’a pas répondu à temps. C’est fréquent aux heures chargées : '
      + 'relancez, ou choisissez une résolution plus grossière.';
  }
  if (/Failed to fetch|NetworkError|network error|Load failed/i.test(m)) {
    return 'La connexion à data.geopf.fr a échoué. Vérifiez votre réseau — '
      + 'un bloqueur de contenu ou un VPN peut aussi couper l’accès.';
  }
  return m;
}

const RESEAU = { recuperer, expliquer };
