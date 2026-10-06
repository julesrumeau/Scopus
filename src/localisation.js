// « Ma position » : le GPS de l'appareil centre la carte. Rien n'est envoyé nulle part, la position reste dans
// l'onglet. `navigator.geolocation` exige un contexte sécurisé (HTTPS, ce qu'est le site en ligne). Une
// fabrique à dépendances explicites : la carte, l'affichage des messages et la géolocalisation arrivent par `d`.

const LOCALISATION = (() => {
  /** Un message en clair pour une erreur de `getCurrentPosition` : jamais le texte brut du navigateur. */
  function messageErreur(erreur) {
    switch (erreur?.code) {
      case 1: return 'Position refusée : autorisez la localisation pour ce site dans les réglages du navigateur, puis réessayez.';
      case 2: return 'Position indisponible : l’appareil ne trouve pas sa position (pas de signal, ou localisation désactivée).';
      case 3: return 'La position met trop de temps à venir : réessayez, de préférence en plein air.';
      default: return 'Impossible de vous localiser.';
    }
  }

  /** Le zoom où cadrer une position selon sa précision (mètres) : serrée, on zoome ; vague, on recule. 17 sans précision. */
  function zoomPour(precisionM) {
    if (!Number.isFinite(precisionM) || precisionM < 0) return 17;
    if (precisionM <= 30) return 18;
    if (precisionM <= 150) return 17;
    if (precisionM <= 600) return 16;
    if (precisionM <= 3000) return 14;
    return 12;
  }

  return { messageErreur, zoomPour };
})();

/**
 * Le bouton : un clic demande la position, la carte se recentre. Un seul appel à la fois (le bouton est grisé le
 * temps de la réponse).
 * @param {{bouton: HTMLElement, geolocalisation: ?object, centrer: (lat:number, lon:number, zoom:number, precisionM:number) => void,
 *          dire: (texte: string) => void, alerter: (texte: string) => void}} d
 */
function creerLocalisation({ bouton, geolocalisation, centrer, dire, alerter }) {
  let enCours = false;
  const fini = () => { enCours = false; bouton.disabled = false; bouton.classList.remove('en-cours'); };

  bouton.addEventListener('click', () => {
    if (enCours) return;
    if (!geolocalisation) { alerter('Ce navigateur ne sait pas se localiser.'); return; }
    enCours = true;
    bouton.disabled = true;
    bouton.classList.add('en-cours');
    dire('Recherche de votre position…');
    geolocalisation.getCurrentPosition((p) => {
      fini();
      const { latitude, longitude, accuracy } = p.coords;
      centrer(latitude, longitude, LOCALISATION.zoomPour(accuracy), accuracy);
    }, (erreur) => {
      fini();
      alerter(LOCALISATION.messageErreur(erreur));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}
