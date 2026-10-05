// La page d'accueil : voir un exemple, ou entrer avec ses propres coordonnées ; elle s'efface au premier des
// deux gestes, définitivement.

function creerAccueil({ $, carte, basculerVue, CONFIG, PROJ }) {
  //
  // Sans elle, qui ouvre Scopus tombe sur une carte de France et doit deviner où
  // cliquer : tout le reste de l'outil devient inatteignable. Elle ne pose qu'une
  // question — voir un exemple, ou entrer avec ses propres coordonnées — et
  // s'efface au premier des deux gestes, définitivement.

  function masquerAccueil() {
    $('accueil').hidden = true;
  }

  // Un `mailto:` suppose un client de bureau configuré — de moins en moins
  // vrai, la plupart ne lisant leur courrier que dans le navigateur, où cliquer
  // le lien ne fait alors rien de visible. Copier l'adresse marche partout,
  // même repli sur `prompt()` que le lien partageable (`copierLien`) si le
  // presse-papiers refuse. Reconstruite plutôt qu'écrite en clair dans le HTML :
  // freine les moissonneurs de spam les plus bêtes, sans prétendre à une vraie
  // protection.
  $('lien-contact').addEventListener('click', async (e) => {
    e.preventDefault();
    const adresse = `${'jules.rumeau1'}@${'gmail.com'}`;
    try {
      await navigator.clipboard.writeText(adresse);
    } catch {
      prompt('Copiez cette adresse :', adresse);
      return;
    }
    const lien = e.target;
    const texteAvant = lien.textContent;
    lien.textContent = 'Adresse copiée !';
    setTimeout(() => { lien.textContent = texteAvant; }, 2000);
  });

  function entrerDansLaCarte() {
    masquerAccueil();
    basculerVue('carte');
    // « J'ai déjà des coordonnées » : le champ les accepte telles quelles
    // (« 42.74, 1.68 »), autant y poser le curseur plutôt que de le faire viser.
    $('recherche').focus();
  }

  $('btn-exemple').addEventListener('click', () => {
    masquerAccueil();
    basculerVue('carte');
    // Le Bois des Caures cadré : le relief de la vue arrive seul.
    const { x, y } = CONFIG.carte.dalleExemple;
    const c = PROJ.versWGS84(x * 1000 + 500, y * 1000 + 500);
    requestAnimationFrame(() => { carte.invalider(); carte.allerA(c.lon, c.lat, 16); });
  });
  $('btn-carte-directe').addEventListener('click', entrerDansLaCarte);
  // La croix : la carte telle qu'elle est, sans rien viser (ni exemple, ni champ de
  // recherche). Fermer l'accueil rend au panneau sa colonne : `invalider()` d'abord.
  $('accueil-croix').addEventListener('click', () => {
    masquerAccueil();
    basculerVue('carte');
    requestAnimationFrame(() => carte.invalider());
  });

  return { masquerAccueil };
}
