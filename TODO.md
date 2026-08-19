# Scopus — Reste à faire

Liste renumérotée le 19 août 2026 : les tâches achevées depuis la version
précédente ont été retirées d'ici et, quand elles laissaient un fait mesuré
sans autre trace écrite, repliées dans la section du document qui décrit
l'endroit du code concerné (la carte pour #17 et #12 ; les autres n'avaient
rien à replier, leur détail vivait déjà plus haut). Les numéros ne
correspondent donc plus à ceux des versions antérieures de ce fichier — les
renvois `(#N)` ailleurs dans le document ont été mis à jour en conséquence.
L'ordre reste celui d'origine ; seuls les *(prioritaire)* sont un jugement de
priorité explicite, le reste est classé par ancienneté et non par urgence.

**2 tâches restent**, et les deux sont marquées *(prioritaire)* : ce sont les
seules dont l'issue est incertaine.

### #1 — Rallumer la détection, ou renoncer *(prioritaire)*

Masquée le 18 août 2026 (`ANALYSE_MASQUEE`), les deux chaînes avec. La question
à trancher n'est pas « comment la réparer » mais **à quoi elle sert**, puisque
l'ouverture et le SVF montrent les mêmes formes à l'œil et sans seuil.

Trois issues possibles, à départager par l'usage réel de l'outil, pas par le
raisonnement :

1. **Rallumer telle quelle** dès qu'un contrôle positif existe — une ruine
   géolocalisée règle les seuils en une après-midi, et les deux voies ont chacune
   leur cas propre (`test/voies.test.js`).
2. **La réduire à une aide à la lecture** : ne plus prétendre décider, seulement
   pointer les endroits où regarder, en assumant les faux positifs.
3. **Y renoncer** et faire de Scopus un lecteur de relief, ce qu'il est déjà et
   fait bien.

Premier point en faveur de l'option 3 : une ruine réelle connue de l'utilisateur,
peu visible sur le terrain, se lit sans ambiguïté dans le relief calculé — sans
détecteur. Un seul cas ne tranche pas encore ; ne rien décider tant que la
lecture visuelle n'a pas été pratiquée sur plusieurs dalles, c'est elle qui dira
si un détecteur manque vraiment.

### #2 — Débloquer la détection de sentiers *(prioritaire)*

Rédigé quand la chaîne rendait **zéro tracé**. Depuis, elle en remonte 147 sur
Beille ; ce qui reste entier, c'est qu'**aucun chemin connu n'a servi de contrôle
positif** — rien ne dit que ces 147 sont des sentiers.

Ce qui rend le diagnostic possible : des sentiers connus sont **nets** dans le
relief, micro-relief comme SVF. La donnée porte donc le signal, et toute panne
restante est en aval — c'est un bug localisable, plus une impasse.

Méthode, en descendant la chaîne avec le relief pour référence : prendre un
chemin visible à l'œil dans l'onglet 2D et noter ses coordonnées, puis, à cet
endroit, comparer le `relief` de `sentiers.js` à la couche Micro-relief de
`relief.js` — celle-ci est vérifiée contre des surfaces à réponse connue, une
divergence désigne le lissage ou la marge de bord. Ensuite `rugosite` (surestimée,
elle rend le seuil inatteignable partout), `vesselness` (réponse non nulle sur le
tracé ? échelles 1/2/4 m contre la largeur réelle ?), `hysteresis`, le squelette
avant vectorisation, enfin les filtres — `stats.rejets` dit déjà lequel coupe.
Les durées et les compteurs par étape sont affichés : s'en servir plutôt que
deviner.

Le moyen d'y voir clair existe désormais : un panneau « Diagnostic (étapes
internes) » dans le volet Sentiers (`#diag-sentiers`) affiche au choix chacune
de ces cinq étapes en niveaux de gris, à la résolution native de la grille de
travail — relief local, rugosité, réponse vesselness brute, masque après
hystérésis, squelette aminci. Vérifié en navigateur réel sur la dalle de
Beille : les cinq couches se dessinent avec un contenu non uniforme, aux
dimensions attendues (2000×2000 à 50 cm pour 1 km²). Reste masqué avec le
reste de l'analyse (`ANALYSE_MASQUEE`) — un développeur y accède en repassant
le drapeau à `false`, comme pour tout le volet.

Une recherche bibliographique (hollow ways/sunken lanes, CarcassonNet,
extraction de crêtes/vallées par tensor voting) confirme que la famille
d'algorithme retenue — hessienne sur un relief local, hystérésis, squelette —
est la bonne piste : c'est celle que la littérature utilise pour ce type
d'objet, et ce que le seuil relatif à la rugosité locale et le recollement
directionnel de `relier()` couvrent déjà rejoint ce qu'elle propose de mieux
en dehors de l'apprentissage automatique (écarté ici, voir CLAUDE.md). Rien
n'indique donc qu'il faille changer d'algorithme — seulement voir, avec le
diagnostic ci-dessus et un vrai sentier connu, où le signal se perd.

**Repli acceptable avant publication :** marquer le volet Sentiers
« expérimental », ou le retirer. Livrer une fonction qui promet et rend zéro est
le pire des trois choix — l'utilisateur conclura que c'est *l'outil* qui est
cassé.

