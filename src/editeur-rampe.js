// L'éditeur de la rampe « Hauteur/sol » de la 3D : un bouton « Réglages » qui déplie, dans le panneau (sans rien cacher de la scène), un
// mode (dégradé ou paliers), des préréglages, une jauge de 0 à 50 m dont les limites se glissent et se retirent (on en ajoute par un bouton), une
// couleur par tranche. Tout l'état est dans `RAMPE_HAUTEUR` (pur, testé) ; ici le DOM seulement.
// Chaque retouche remplit la texture lue par le shader (`GL.textureRampe`), met à jour la légende et le lien, et redessine la scène.

function creerEditeurRampe({ $, CONFIG, vue3d, majLegende, majLien }) {
  const R = RAMPE_HAUTEUR;
  const jauge = $('rampe-jauge');
  const etat = () => CONFIG.rendu.rampe;
  const pct = (h) => `${(h / R.portee) * 100}%`;
  const el = (nom, attrs = {}, texte) => {
    const e = document.createElement(nom);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (texte !== undefined) e.textContent = texte;
    return e;
  };

  /** Les couleurs de la jauge : des aplats (paliers) ou un dégradé (le CSS interpole entre les limites, comme la rampe). */
  function fondJauge(e) {
    const arrets = e.couleurs.map((c, i) => `${c} ${i === 0 ? 0 : (e.bornes[i - 1] / R.portee) * 100}%`);
    if (e.mode === 'degrade') return `linear-gradient(to right, ${arrets.join(', ')})`;
    const bandes = e.couleurs.map((c, i) => `${c} ${i === 0 ? 0 : (e.bornes[i - 1] / R.portee) * 100}% ${i === e.bornes.length ? 100 : (e.bornes[i] / R.portee) * 100}%`);
    return `linear-gradient(to right, ${bandes.join(', ')})`;
  }

  /** Les tranches : une couleur par ligne, la limite haute modifiable au clavier, la limite retirable. */
  function dessinerTranches() {
    const e = etat(), liste = $('rampe-tranches');
    liste.replaceChildren();
    e.couleurs.forEach((c, i) => {
      const ligne = el('div', { class: 'rampe-tranche' });
      ligne.append(el('input', { type: 'color', value: c, 'data-bande': i, 'aria-label': `Couleur de la tranche ${i + 1}` }));
      const bas = i === 0 ? 0 : e.bornes[i - 1];
      if (i === e.bornes.length) { ligne.append(el('span', {}, `${R.formaterM(bas)} et plus`)); liste.append(ligne); return; }
      ligne.append(el('span', {}, `${String(bas).replace('.', ',')} à`));
      ligne.append(el('input', { type: 'number', min: R.pas, max: R.portee, step: R.pas, value: e.bornes[i], 'data-borne': i, 'aria-label': `Limite haute de la tranche ${i + 1}, en mètres` }));
      ligne.append(el('span', {}, 'm'));
      const retirer = el('button', { type: 'button', class: 'rampe-retirer', 'data-retirer': i, title: 'Retirer cette limite', 'aria-label': `Retirer la limite de ${R.formaterM(e.bornes[i])}` }, '×');
      if (e.bornes.length <= 1) retirer.disabled = true;
      ligne.append(retirer);
      liste.append(ligne);
    });
  }

  /** Les poignées de la jauge : recréées quand le nombre de limites change, seulement replacées pendant un glissé. */
  function dessinerPoignees() {
    jauge.replaceChildren();
    etat().bornes.forEach((b, i) => jauge.append(el('button', { type: 'button', class: 'rampe-poignee', role: 'slider', 'data-borne': i, 'aria-valuemin': R.pas, 'aria-valuemax': R.portee, 'aria-valuenow': b, 'aria-label': `Limite ${i + 1}`, 'aria-valuetext': R.formaterM(b), style: `left:${pct(b)}` })));
  }

  function placer() {
    const e = etat();
    jauge.style.background = fondJauge(e);
    jauge.querySelectorAll('.rampe-poignee').forEach((p, i) => { p.style.left = pct(e.bornes[i]); p.setAttribute('aria-valuenow', e.bornes[i]); p.setAttribute('aria-valuetext', R.formaterM(e.bornes[i])); });
    for (const b of $('rampe-mode').children) b.classList.toggle('actif', e.mode === b.dataset.mode);
  }

  /** Ce que toute retouche entraîne : la texture du shader, la légende, le lien, la scène. */
  function appliquer() {
    const v = vue3d();
    if (v) GL.textureRampe(v.gl, R.texels(etat()), v.rampe);
    majLegende();
    majLien();
    v?.invalider();
  }

  const tout = () => { dessinerPoignees(); dessinerTranches(); placer(); };
  const changer = (e, { structure = false } = {}) => {
    CONFIG.rendu.rampe = R.normaliser(e);
    if (structure) tout(); else { placer(); dessinerTranches(); }
    appliquer();
  };

  function pointerSurJauge(ev) { const r = jauge.getBoundingClientRect(); return ((ev.clientX - r.left) / r.width) * R.portee; }

  jauge.addEventListener('pointerdown', (ev) => {
    const p = ev.target.closest('.rampe-poignee');
    if (!p) return;   // un clic dans la barre ne fait rien : on ajoute une limite par le bouton (un clic raté en créait une)
    p.setPointerCapture(ev.pointerId);
    p.focus();
    ev.preventDefault();
  });
  jauge.addEventListener('pointermove', (ev) => {
    const p = ev.target.closest('.rampe-poignee');
    if (p && p.hasPointerCapture(ev.pointerId)) changer(R.deplacerBorne(etat(), Number(p.dataset.borne), pointerSurJauge(ev)));
  });
  jauge.addEventListener('keydown', (ev) => {
    const p = ev.target.closest('.rampe-poignee');
    if (!p) return;
    const i = Number(p.dataset.borne), pas = (ev.shiftKey ? 10 : 1) * R.pas;
    const touche = { ArrowLeft: -pas, ArrowDown: -pas, ArrowRight: pas, ArrowUp: pas }[ev.key];
    if (touche !== undefined) { ev.preventDefault(); changer(R.deplacerBorne(etat(), i, etat().bornes[i] + touche)); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); changer(R.retirerBorne(etat(), i), { structure: true }); }
  });
  jauge.addEventListener('dblclick', (ev) => {
    const p = ev.target.closest('.rampe-poignee');
    if (p) changer(R.retirerBorne(etat(), Number(p.dataset.borne)), { structure: true });
  });

  $('rampe-tranches').addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.bande !== undefined) changer(R.colorerBande(etat(), Number(t.dataset.bande), t.value));
  });
  $('rampe-tranches').addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.borne !== undefined) changer(R.deplacerBorne(etat(), Number(t.dataset.borne), Number(t.value)), { structure: true });
  });
  $('rampe-tranches').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-retirer]');
    if (b) changer(R.retirerBorne(etat(), Number(b.dataset.retirer)), { structure: true });
  });
  $('rampe-ajouter').addEventListener('click', () => {
    const e = etat(), bornes = [0, ...e.bornes, R.portee];
    let meilleur = 0;
    bornes.forEach((b, i) => { if (i && b - bornes[i - 1] > bornes[meilleur + 1] - bornes[meilleur]) meilleur = i - 1; });
    changer(R.ajouterBorne(e, (bornes[meilleur] + bornes[meilleur + 1]) / 2), { structure: true });
  });
  $('rampe-mode').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) changer(R.changerMode(etat(), b.dataset.mode));
  });
  $('rampe-preset').addEventListener('change', (ev) => {
    if (ev.target.value) changer(R.preset(ev.target.value), { structure: true });
    ev.target.value = '';
  });
  $('btn-rampe').addEventListener('click', () => {
    const ouvert = $('editeur-rampe').hidden;
    $('editeur-rampe').hidden = !ouvert;
    $('btn-rampe').setAttribute('aria-expanded', String(ouvert));
    if (ouvert) tout();
  });
  /** Un lien ouvert a changé l'état hors de l'éditeur : tout redessiner et refaire la texture. */
  $('champ-rampe').addEventListener('rampe:externe', () => { tout(); appliquer(); });

  return { appliquer };
}
