// Du texte venu d'ailleurs, écrit dans le HTML de la page.

/**
 * Neutralise le HTML d'une chaîne avant insertion.
 *
 * Les noms de dalle, dates et natures de bâtiment viennent des services de
 * l'IGN, pas de l'utilisateur. Le risque est donc théorique — mais ces valeurs
 * traversent le réseau avant d'atterrir dans un `innerHTML`, et rien ne garantit
 * qu'un champ de la BD TOPO ne contiendra jamais de chevron. Échapper coûte une
 * ligne ; s'en remettre à la bonne tenue d'une source tierce, non.
 */
function echapper(v) {
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ligneDetail(cle, valeur) {
  return `<dt>${echapper(cle)}</dt><dd>${echapper(valeur).replace(/\n/g, '<br>')}</dd>`;
}
