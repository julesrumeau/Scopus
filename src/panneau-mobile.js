// Le panneau sous 900 px.
// Sous 600 px, une feuille tirée du bas à trois hauteurs (`data-feuille`) ;
// de 600 à 900 px, un panneau latéral replié par une languette (`.replie`).
// La forme est dans styles.css : au-delà de 900 px, rien de ceci n'a d'effet
// visible. Non modal dans les deux cas — la carte reste utilisable.

function creerPanneauMobile({ $ }) {
  const HAUTEURS_FEUILLE = ['replie', 'mi', 'plein'];
  /** Hauteur en pixels de chaque état, pour aimanter la feuille lâchée. */
  function hauteursFeuille() {
    const repliee = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--feuille-repliee')) || 136;
    return { replie: repliee, mi: window.innerHeight * 0.5, plein: window.innerHeight - 46 };
  }
  function poserFeuille(etat) {
    const p = $('panneau');
    p.dataset.feuille = etat;
    p.style.height = '';
    // Repliée, elle montre le haut de la section principale, pas un milieu.
    if (etat === 'replie') p.scrollTop = 0;
    $('poignee-panneau').setAttribute('aria-expanded', String(etat !== 'replie'));
  }
  function feuilleSuivante() {
    const i = HAUTEURS_FEUILLE.indexOf($('panneau').dataset.feuille);
    poserFeuille(HAUTEURS_FEUILLE[(i + 1) % HAUTEURS_FEUILLE.length]);
  }
  {
    // Tirer la poignée suit le doigt ; lâchée, la feuille va à la hauteur la
    // plus proche. Un appui sans glisser passe à la hauteur suivante.
    const poignee = $('poignee-panneau');
    let tire = null;
    poignee.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      tire = { y: e.clientY, h: $('panneau').getBoundingClientRect().height, bouge: false };
      $('panneau').classList.add('tiree');
      try { poignee.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    });
    poignee.addEventListener('pointermove', (e) => {
      if (!tire) return;
      const dy = tire.y - e.clientY;
      if (Math.abs(dy) > 6) tire.bouge = true;
      if (tire.bouge) {
        const h = hauteursFeuille();
        $('panneau').style.height = `${Math.max(h.replie * 0.6, Math.min(h.plein, tire.h + dy))}px`;
      }
    });
    const lacher = () => {
      if (!tire) return;
      $('panneau').classList.remove('tiree');
      if (!tire.bouge) { tire = null; feuilleSuivante(); return; }
      const actuelle = $('panneau').getBoundingClientRect().height;
      const h = hauteursFeuille();
      const proche = HAUTEURS_FEUILLE.reduce((a, b) => (Math.abs(h[b] - actuelle) < Math.abs(h[a] - actuelle) ? b : a));
      tire = null;
      poserFeuille(proche);
    };
    poignee.addEventListener('pointerup', lacher);
    poignee.addEventListener('pointercancel', lacher);
    poignee.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); feuilleSuivante(); }
    });
  }
  function replierLateral(replie) {
    $('panneau').classList.toggle('replie', replie);
    const l = $('languette-panneau');
    l.textContent = replie ? '▶' : '◀';
    l.setAttribute('aria-expanded', String(!replie));
    l.setAttribute('aria-label', replie ? 'Déplier le panneau' : 'Replier le panneau');
  }
  $('languette-panneau').addEventListener('click', () => replierLateral(!$('panneau').classList.contains('replie')));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('dlg-profil').open || $('dlg-aide-profil').open) return;   // Échap ferme la fenêtre, pas le panneau
    poserFeuille('replie');
    replierLateral(true);
  });
}
