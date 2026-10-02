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

**5 tâches restent.** Les deux premières sont marquées *(prioritaire)* : ce
sont les seules dont l'issue est incertaine. Les suivantes (#3, #4, #6)
sont ce que le relief piloté par la vue laisse hors de ses plans (spec
`docs/superpowers/specs/2026-09-26-flux-vue-design.md`). #5 (un relief de
secours pour les vues trop larges) est tranché le 27 septembre 2026 : rien
que du COPC, la carte voilée et la dernière image gardée (CLAUDE.md, « Le
calcul de la vue »).

**Retours du forum** : les demandes arrivées après la publication du profil
(1er et 2 octobre 2026) sont numérotées **R1 à R7**, à part des #, dans la
section « Retours du forum » en fin de fichier.

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

Un essai sur une dalle de haute montagne (`#d=542,6196`) a montré un piège à
ne pas reproduire : une ligne repérée à l'œil sur une miniature basse
résolution ne tenait plus à l'examen serré — la réponse vesselness y est
dense et chaotique sur toute la dalle (terrain d'éboulis), et rien de propre
n'en ressort à cet endroit précis. Repérer un candidat demande donc de
regarder à pleine résolution dans l'outil, pas sur un cliché réduit.

**Démasqué le 20 août 2026** (`SENTIERS_MASQUES` dans `app.js`, indépendant
d'`ANALYSE_MASQUEE` qui garde les structures fermées) : le bouton, les
réglages et les tracés trouvés sont maintenant visibles et actifs dans
l'interface réelle, sur les trois onglets. Objectif : des retours sur de
vraies dalles plutôt que sur des cas synthétiques.

**Premier retour, et premier bogue trouvé grâce à lui** : sur Beille, les
tracés ressemblaient à des points reliés au hasard, pas à des courbes
cohérentes — deux amas d'une centaine de mètres où ils s'entrecroisaient et
rebouclaient sur eux-mêmes. Cause : `vectoriser` referme parfois un cycle du
squelette en boucle plutôt qu'en ligne ouverte, et rien ne l'écartait. Corrigé
par un filtre de compacité (longueur du tracé / distance à vol d'oiseau entre
ses deux bouts, voir `CONFIG.sentiers.compaciteMax` et le point dédié plus
haut dans ce document) : 133 tracés retenus avant sur Beille, 110 après, les
deux amas disparus du rendu. La leçon vaut d'être notée : ni les sept tests
synthétiques ni les mesures précédentes sur Beille n'avaient vu venir ce
défaut, parce qu'aucun ne regardait la **forme** d'ensemble d'un tracé — un
compte de tracés retenus ne dit rien de leur cohérence visuelle.

Un compte d'auto-croisements du tracé simplifié (`autocroisements`, affiché
dans chaque fiche sous « croise ») a été ajouté au passage pour le diagnostic,
mesuré mais pas encore filtré — sur Beille après le filtre de compacité,
seuls 4 tracés sur 110 en ont au moins un (max 1). Pas assez net pour justifier
un seuil dur pour l'instant ; à surveiller si un terrain plus accidenté en
produit davantage.

**Piste testée et écartée : l'ouverture de Yokoyama comme signal d'entrée, à
la place du relief local.** Sur une suggestion de remplacer le relief local
(LRM) par une couche déjà validée ailleurs dans l'outil, essayé sur données
réelles de Beille (hors dépôt, harnais jetable) : ouverture positive (le
signe attendu pour un creux, par analogie avec « l'intérieur de l'enclos » du
banc de `lignes.js`) et négative, à rayon standard (10 m) et resserré (3 m),
seuil d'hystérésis standard et abaissé de moitié. Dans tous les cas la
réponse reste diffuse plutôt que sélective — non nulle sur ~70 % de la dalle
mais jamais franchement piquée — et produit beaucoup moins de matière que le
relief local à réglages comparables : 69 chaînes brutes contre 997, 1 tracé
retenu contre 76 même au seuil le plus permissif testé. Le rendu visuel des
deux réponses se ressemble dans l'ensemble (même terrain sous-jacent) mais
celle de l'ouverture est nettement moins contrastée, sans jamais dépasser le
niveau où l'hystérésis peut trier. Hypothèse pour l'expliquer, non vérifiée
plus avant : l'ouverture est déjà un lissage directionnel sur son rayon de
balayage, quand le relief local est construit spécifiquement pour préserver
le résidu fin après soustraction d'une tendance large — le second capture
mieux une dépression étroite (0,6 à 4 m) que le premier. Le relief local
reste donc le signal d'entrée, sans changement de code.

**Remasqué le 20 août 2026** (`SENTIERS_MASQUES` remis à `true`) après ce
premier usage réel : le bogue des pelotes corrigé, ce qui restait ne
convainquait toujours pas à l'œil sur plusieurs dalles — vraisemblablement
encore beaucoup de ravinement naturel sous une signature qui ne se
distingue pas d'un chemin. Livrer une fonction qui promet et ne rend pas
grand-chose de crédible est le pire des choix — ça se lit comme un défaut de
*l'outil*, pas de cette chaîne précisément. Rien n'est perdu : le filtre de
compacité, le diagnostic à cinq couches et la piste de l'ouverture écartée
restent acquis pour la prochaine tentative, qui demandera un vrai chemin
connu pour se calibrer plutôt que d'autres essais à l'aveugle.

### #3 — « Compléter le sol par les non classés » en vue normale

Fait le 27 septembre 2026 : sélection d'un point, mesure en chaîne,
recherche par coordonnées, info-bulle au curseur, réglages du SVF et
lissage, sur la carte en vue normale (voir CLAUDE.md, « Le calcul de la
vue »). Reste la case « Compléter le sol par les retours non classés »,
masquée : son effet n'a pas convaincu à l'usage. Le réglage par défaut
(`CONFIG.relief.inclureSursol`, activé) s'applique toujours. À vérifier sur
une ruine connue avant de la rendre, ou de la retirer pour de bon.

### #4 — La 3D qui télécharge (étape 2)

L'étape 1 est faite (27 septembre 2026, voir CLAUDE.md, « La 3D de la
vue ») : l'onglet 3D montre le nuage de la zone vue sur la carte, avec les
points déjà chargés. Reste que la **caméra 3D pilote le téléchargement** :
blocs les plus gros à l'écran d'abord (taille projetée, comme Potree), du
fin près de la caméra et du grossier au loin, et la « fourchette » de
l'utilisateur comme seuil d'hystérésis pour ne pas retélécharger au moindre
mouvement. À faire après usage de l'étape 1.

### #6 — Laissé de côté par l'audit du 27 septembre 2026

Relevé en relisant la branche du relief piloté par la vue, sans y toucher,
parce que ça changerait un comportement ou demanderait une décision :

- **Les deux côtés du rideau peuvent tomber sur deux surfaces.** Ils sont
  demandés l'un après l'autre ; un bloc arrivé entre les deux fait refaire
  la surface, et la couche du premier côté sort du mémo — l'info-bulle n'y
  lit plus de valeur jusqu'au calcul suivant. Transitoire (vu sous
  émulation), à régler en demandant les deux côtés dans un seul message.
- **Le rangement sur la carte graphique** (`GPU_RELIEF.ajouterBloc`,
  `retirerBloc`, `surfaceVue`, shaders `accuVS`, `accuFS`, `solPrepFS`,
  `surfaceFS`) ne sert plus qu'avec `&gpu` : juste, pas plus rapide, et il
  gèle la page. Gardé pour comparer ; à retirer si le plan 3D n'en veut pas.
- **Décodage et réseau dans `flux.js`** : un bloc attend sa place réseau
  même quand ses octets sont en cache ; un décodage en parallèle pourrait
  raccourcir la seconde visite. À mesurer avant.
- **L'image du worker en PNG** : `ImageBitmap` éviterait l'encodage et le
  décodage, au prix d'un chemin de plus pour le repli.
- **`app.js` enveloppe la vue normale** dans un bloc de ~600 lignes : à
  sortir dans son propre fichier quand l'ancien parcours (`?dalle`) partira.

- **Le panneau latéral recouvre la barre d'outils entre 600 et 900 px**, ouvert
  par défaut : le bouton Profil (comme Déplacement, Sélection et Mesure) est
  inaccessible tant qu'on ne l'a pas replié avec la languette. Vu en paysage sur
  un téléphone (800 × 380) et sur tablette.
- **Petits points du profil**, relevés à la relecture : sur une bande en
  diagonale, un point exactement sur le bord peut être écarté par arrondi de
  flottant (`vue-relief.js`) ; le champ de largeur de la modale n'a pas de
  garde si A ou B est nul ; pendant « Calcul… », l'ancien graphique reste
  cliquable ; le glisser des poignées A et B et le pincement sur le graphique
  n'ont pas été essayés au doigt.

---

## Retours du forum OSM-FR (depuis le 1er octobre 2026)

Demandes reçues après la publication du profil topographique et de la date
d'acquisition, numérotées **R1 à R7** (R5 est fait : retiré) pour ne pas les mêler aux #. Aucun nom
n'est écrit ici : le dépôt est public, et le fil du forum dit qui a demandé quoi.

**Rythme décidé** : répondre vite à chacun (« noté », « je regarde », ou « pas
prévu, parce que… »), mais **livrer par petits lots**, pas à chaque message ;
une annonce courte par livraison, qui mentionne les demandeurs. Répondre n'est
pas livrer. Ce qui ne colle pas à l'outil se refuse en le disant, et la raison
s'écrit dans CLAUDE.md pour ne pas la rediscuter.

| Lot | Contenu | État |
|---|---|---|
| A — mesure et aide | R1, R3 (R6 les rejoint si son UI/UX est tranchée à temps) | prêt à faire |
| B — lien | R2 | à concevoir d'abord |
| en attente | R4 | réponse du demandeur |
| à décider | R7 | comprendre ce qui est demandé |

### R1 — Pente d'un segment mesuré *(mesure d'un escalier)* — décidé

Une colonne **« Pente »** dans le tableau de mesure — donc dans le profil comme
sur la carte, c'est le même (`MESURE.tableauHtml`) —, par segment, en degrés et
en pourcentage : « 32° (62 %) ».

- Pente = arctan(dénivelé / horizontale), signée comme le dénivelé (montée +,
  descente −).
- « — » si l'horizontale est nulle (pente verticale sans valeur à afficher) ou
  si une altitude est inconnue : jamais une valeur inventée.
- **Pas de pente totale** : comme pour le dénivelé, une somme signée ne dirait
  rien de juste.
- Tests à écrire d'abord : un triangle 3-4-5, une descente, une horizontale
  nulle, une altitude inconnue.

### R2 — Le lien porte le profil — à concevoir

Constat : le lien actuel ne porte que `#map=zoom/lat/lon` (plus les angles en
3D). Il manque la bande du profil, les points, les classes visibles. Contrainte
à garder : le début du fragment reste lisible par osm.org (`OSM.parseHash`
ignore ce qui suit `&`, voir CLAUDE.md « Le lien partageable »).

Pas de code avant une spec (brainstorming). Questions ouvertes :
- **Quoi mettre** : la bande (A, B, largeur) ; les classes cochées dans la
  modale ; les points de mesure ; le point sélectionné ; la référence (R6) ; les
  classes du sol ? Quoi laisser : le zoom et la tranche du graphique (plutôt non :
  de l'affichage, et un lien plus lourd).
- **Format** : A et B en WGS84 ou en coordonnées locales ; précision ; longueur
  du lien ; ordre et noms des paramètres.
- **À l'ouverture** : la modale s'ouvre-t-elle toute seule ? que faire si les
  blocs ne sont pas encore chargés ; compatibilité avec les liens déjà publiés ;
  un lien de profil survit-il à un changement de territoire ?

### R3 — Aide « Comment lire un profil » — décidé

Les curseurs de largeur de bande et de tranche ne se comprennent pas du premier
coup. Une pastille **`i`** (même apparence que la `?` existante, `.aide-info`)
qui ouvre une **petite fenêtre** (`dialog`, comme celle de l'export) : les
infobulles `title` ne s'affichent pas au toucher, et on utilise l'outil sur
téléphone. Une pastille dans l'en-tête de la modale, une dans la fenêtre
flottante.

Contenu court, à rédiger au moment de faire :
- **La bande** : l'épaisseur autour du trait A–B ; plus large, plus de points,
  utile pour trouver une cime.
- **La tranche** (curseurs du dessous) : ne garder qu'une part de la bande, de la
  gauche à la droite de l'axe, vu de A vers B ; ne recalcule rien.
- **Les classes**, **la mesure** (clic, accrochage au point le plus proche,
  enchaînement, annuler, effacer), **la référence** (R6), **le zoom** (molette,
  glisser, « Vue entière »).

Renommer « Tranche de la bande » en quelque chose de plus parlant. Un schéma de
la bande vue de dessus pourra venir ensuite.

### R4 — Export GeoJSON — en attente

Demande : exporter des points en GeoJSON avec `ele` et `height` en propriétés.
Non fait : le besoin n'est pas formulé. Une question a été posée au demandeur (à quoi
cela servirait — JOSM, QGIS, uMap — et sur quels points : toute la bande, ou
ceux que l'on mesure).

- Sans sol reconstitué (voir R7), **pas de `height` par point** : seulement `ele`,
  la classe, la distance sur l'axe, la date d'acquisition.
- Poids : jusqu'à ~80 Mo pour 1 M de points, ~500 Ko pour quelques milliers.

### R6 — Point de référence — décidé dans le principe, UI/UX à trancher avant tout code

Demande : dire « ce point est l'altitude 0 à partir de maintenant », comme dans
la méthode QGIS pour les bâtiments : un sol de référence, puis plusieurs points
sur plusieurs coupes, sans refaire les soustractions à la main (donc moins
d'erreurs de calcul). Aujourd'hui le tableau ne donne que des écarts entre deux
points consécutifs.

Remarque d'un autre contributeur : une constante n'est pas un MNT (la hauteur est MNS − MNT, pas
MNS − X) ; la référence vaut sur un sol plat ou pour un seul bâtiment. **À dire
tel quel dans l'aide (R3)** ; la question du sol comblé est traitée à part, en R7.

Idées retenues :
- Une rubrique « Référence » dans la modale. Son bouton **arme le prochain clic
  seulement** : il s'accroche comme la mesure, puis on revient à la mesure ;
  Échap annule. Sans cela, un clic du graphique serait ambigu (point de mesure ou
  référence).
- La référence a son propre repère (une croix marquée « 0 »), distinct de A, B, C.
- Le graphique se recentre : un 0 vertical et un 0 horizontal, avec des
  graduations négatives à gauche et en dessous.
- Le tableau gagne **« Cote »** (altitude depuis la référence) et **« Dist.
  depuis la réf. »**, seulement quand une référence existe.
- **Le 0 vertical persiste d'une coupe à l'autre** (c'est une altitude réelle,
  ce que demande le demandeur) ; **le 0 horizontal est propre à la coupe** (une
  position sur cet axe : sur un nouvel axe, il revient au point A). À dire dans
  l'aide.
- Un bouton **« Effacer la référence »** supprime les deux zéros et l'altitude
  gardée.

**À trancher en UI/UX, pas maintenant** : où placer la rubrique dans une modale
déjà dense (réglages, graphique, tranche, classes, mesure) ; comment montrer que
le clic est « armé » ; le rendu des axes relatifs (garder l'altitude absolue
lisible ?) ; le comportement dans le lien (R2).

### R7 — Combler le sol : hauteur = MNS − MNT — à décider, pas maintenant

**Réponse faite pour l'instant : non**, on laisse la personne choisir ses points.
Mais ce n'est pas fermé : on veut d'abord **comprendre précisément ce qui est
demandé**. À ne pas commencer.

Ce qui a été dit (deux messages) :
- Extrapoler le sol sous les arbres (classe sol) pour « faciliter le calcul des
  valeurs `height` ».
- À propos du point de référence (R6) : une référence donne une hauteur
  MNS − X, avec X constante, qui ne vaut que sur un sol horizontal ou pour un
  seul bâtiment. Le MNT est préféré parce que la hauteur est MNS − MNT.

Vocabulaire : le **MNS** est la surface (cimes, toits), le **MNT** le sol nu.
Une hauteur est l'altitude du dessus **moins l'altitude du sol à cet endroit**.
Avec une constante, une pente fausse le résultat : à 20 %, deux points distants
de 10 m ont un sol à 2 m d'écart.

Ce qu'on a déjà : un sol comblé existe dans l'outil (le relief et la couleur
« hauteur au sol » de la 3D), mais il n'est pas dans le profil.

Pourquoi non pour l'instant : sous un houppier dense il y a peu de points sol, le
sol comblé y est une **estimation** et non une mesure ; et « la hauteur de quoi,
par rapport à quoi » n'a pas de réponse unique (cime ou premier retour, pied du
tronc ou milieu de la bande, pente).

**Questions à poser** à la personne :
- Que voudrait-elle voir : une **ligne de sol** tracée dans le profil, la
  **hauteur calculée** d'un point mesuré, ou une `height` exportée (R4) ?
- Pour quel usage : poser `height` sur des arbres et des bâtiments dans OSM, ou
  des analyses dans QGIS ?
- Quel écart accepterait-elle sur un sol estimé sous couvert dense ?

Pistes à évaluer si on y revient : une ligne de sol **en pointillé, nettement
distincte des vrais points sol** et marquée « estimé » ; une colonne « hauteur au
sol estimé » **facultative, éteinte par défaut** ; les risques (sol faux sous
couvert dense, pas de grille ≥ 50 cm, pente). Dépend de R4 et R6.
