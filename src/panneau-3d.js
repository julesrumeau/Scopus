// Le panneau « Affichage » de la 3D : coloration, taille des points, exagération verticale, légende des
// classes (c'est aussi leur filtre), export LAS/PLY, et la ligne d'état du nuage (HUD). La logique de
// l'export (quoi écrire, bouton actif ou non) est dans `SORTIE`, testée sans navigateur.

function creerPanneau3D(d) {
  const { $, vue3d, etat, CONFIG, SORTIE, classesMasquees, NOMS_CLASSES, milliers, octets, majLien, DIAGNOSTIC } = d;
  /** Posé plus tard par le bloc du relief : recharge la couleur par point (hauteur, relief drapé). */
  const liaisons = { majAttributVue: null };


  $('coloration').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const autre of $('coloration').children) autre.classList.toggle('actif', autre === b);
    CONFIG.rendu.coloration = b.dataset.mode;
    majLien();   // la couleur du nuage est dans le lien
    majLegende();
    await majAttributNuage();
    vue3d?.invalider();
  });

  /**
   * Recharge l'attribut par point que le mode courant consomme : la hauteur au-dessus du sol ou la valeur de la
   * couche de relief drapée (même tampon de sommet, réécrit au changement de mode — un second attribut coûterait
   * 18 Mo de mémoire graphique pour une donnée dont on n'a jamais besoin des deux à la fois). Voir `majAttributVue`.
   */
  async function majAttributNuage() {
    await liaisons.majAttributVue?.();
  }

  $('taille-point').addEventListener('input', (e) => {
    CONFIG.rendu.taillePoint = Number(e.target.value);
    $('val-taille').textContent = CONFIG.rendu.taillePoint.toFixed(1);
    vue3d?.invalider();
  });

  $('exag').addEventListener('input', (e) => {
    CONFIG.rendu.exagerationZ = Number(e.target.value);
    $('val-exag').textContent = `×${CONFIG.rendu.exagerationZ.toFixed(1)}`;
    vue3d?.invalider();
  });

  /**
   * Légende et filtre des classifications — c'est le même contrôle.
   *
   * Chaque entrée est cliquable : elle dit ce que la couleur signifie et ce que
   * la vue montre. Deux listes séparées obligeraient à faire l'aller-retour entre
   * elles pour savoir ce qui est masqué.
   *
   * Seules les classes réellement présentes sont listées : en afficher onze
   * laisserait croire à une richesse que la dalle n'a pas.
   */
  function majLegende() {
    const l = $('legende');
    if (!etat.nuage) { l.innerHTML = ''; majExportPoints(); return; }

    const echelle = {
      hauteur: 'Sombre = sol · jaune = 1–3 m · rouge = &gt; 5 m',
      relief: 'La couche de l’onglet Relief, plaquée sur les points',
      elevation: 'Bleu = point bas · blanc = point haut de la dalle',
      intensite: 'Réflectance brute du laser, normalisée sur 16 bits',
    }[CONFIG.rendu.coloration];

    const presentes = [...etat.nuage.parClasse.entries()].sort((a, b) => b[1] - a[1]);
    l.innerHTML =
      (echelle ? `<div class="echelle">${echelle}</div>` : '')
      + '<div class="titre-filtre">Classes affichées</div>'
      + presentes.map(([cls, n]) => {
        const couleur = CONFIG.rendu.couleursClasse[cls] || CONFIG.rendu.couleurClasseDefaut;
        const part = (100 * n / etat.nuage.n).toFixed(1);
        const off = classesMasquees.has(cls) ? ' off' : '';
        return `<button class="cls${off}" data-cls="${cls}" title="Afficher ou masquer">`
          + `<i style="background:${couleur}"></i>${NOMS_CLASSES[cls] || `classe ${cls}`}`
          + `<b>${part} %</b></button>`;
      }).join('');
    majExportPoints();
  }

  /**
   * Export des points de la 3D : le bouton ouvre une fenêtre (`#dlg-export`) où
   * l'on choisit le format. LAS : tous les points, la classe est dans le fichier.
   * PLY : les classes cochées dans la fenêtre — toutes au départ, et sans lien
   * avec les cases de la légende. La logique (quoi écrire, bouton actif ou non)
   * est dans `SORTIE.resumerExport` / `exporterPoints`, testée sans navigateur.
   */
  const exportExclues = new Set();

  function majExportPoints() {
    $('export-points').hidden = !etat.nuage;
    if (!etat.nuage && $('dlg-export').open) $('dlg-export').close();
  }

  function formatExport() {
    return document.querySelector('input[name="fmt-export"]:checked')?.value || null;
  }

  function majFenetreExport() {
    const format = formatExport();
    $('exp-classes').hidden = format !== 'ply';
    const r = SORTIE.resumerExport(etat.nuage, format, exportExclues);
    $('exp-telecharger').disabled = !r.actif;
    $('exp-info').textContent = r.actif ? `${milliers(r.n)} points, ~${octets(r.octets)}.` : r.message;
  }

  function listerClassesExport() {
    const presentes = [...etat.nuage.parClasse.entries()].sort((a, b) => b[1] - a[1]);
    $('exp-liste-classes').innerHTML = presentes.map(([cls, n]) => {
      const couleur = CONFIG.rendu.couleursClasse[cls] || CONFIG.rendu.couleurClasseDefaut;
      return `<label class="case"><input type="checkbox" data-cls="${cls}" checked>`
        + `<i style="background:${couleur};width:11px;height:11px;border-radius:2px;flex:none"></i>`
        + `<span>${NOMS_CLASSES[cls] || `classe ${cls}`} <small>${milliers(n)} points</small></span></label>`;
    }).join('');
  }

  $('exp-ouvrir').addEventListener('click', () => {
    if (!etat.nuage) return;
    exportExclues.clear();          // toutes les classes cochées, à chaque ouverture
    for (const r of document.querySelectorAll('input[name="fmt-export"]')) r.checked = false;
    listerClassesExport();
    majFenetreExport();
    $('dlg-export').showModal();
  });
  $('exp-fermer').addEventListener('click', () => $('dlg-export').close());
  $('dlg-export').addEventListener('change', (e) => {
    const c = e.target.closest('input[data-cls]');
    if (c) {
      const cls = Number(c.dataset.cls);
      if (c.checked) exportExclues.delete(cls); else exportExclues.add(cls);
    }
    majFenetreExport();
  });
  $('exp-telecharger').addEventListener('click', () => {
    const format = formatExport();
    if (!etat.nuage || !format) return;
    const f = SORTIE.exporterPoints(etat.nuage, format, exportExclues);
    SORTIE.telecharger(f.nom, new Blob(f.parties), 'application/octet-stream');
    $('dlg-export').close();
  });

  $('legende').addEventListener('click', (e) => {
    const b = e.target.closest('button.cls');
    if (!b) return;
    const cls = Number(b.dataset.cls);
    if (classesMasquees.has(cls)) classesMasquees.delete(cls); else classesMasquees.add(cls);
    b.classList.toggle('off', classesMasquees.has(cls));
    vue3d?.definirClassesMasquees(classesMasquees);
    majLien();   // les classes cachées sont dans le lien
  });

  function majHUD() {
    if (!etat.nuage) { $('hud').textContent = ''; return; }
    const e = etat.nuage.emprise;
    $('hud').innerHTML = `${milliers(etat.nuage.n)} points · ${Math.round(e.xmax - e.xmin)} × ${Math.round(e.ymax - e.ymin)} m<br>`
      + `altitudes ${(etat.nuage.origine[2] + etat.nuage.zmin).toFixed(0)} – ${(etat.nuage.origine[2] + etat.nuage.zmax).toFixed(0)} m`
      // Avec &debug ou &chrono : la part dessinée pendant le dernier geste.
      + (DIAGNOSTIC && vue3d?.dernierMouvement
        ? `<br>en mouvement : ${milliers(vue3d.dernierMouvement.dessines)} points`
          + ` (${Math.round((100 * vue3d.dernierMouvement.dessines) / vue3d.dernierMouvement.total)} %)` : '');
  }

  return { majLegende, majHUD, majAttributNuage, liaisons };
}
