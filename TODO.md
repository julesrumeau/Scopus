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
masquée : son effet n'a pas convaincu à l'usage. Le réglage
(`CONFIG.relief.inclureSursol`) est **désactivé par défaut depuis le 4 octobre 2026**
(il faisait les étoiles du SVF, voir R14) ; les non classés s'ajoutent aux classes
du sol. À vérifier sur une ruine connue avant de rendre la case, ou de la retirer.

### #4 — La 3D qui télécharge (étape 2)

L'étape 1 est faite (27 septembre 2026, voir CLAUDE.md, « La 3D de la
vue ») : l'onglet 3D montre le nuage de la zone vue sur la carte, avec les
points déjà chargés. Reste que la **caméra 3D pilote le téléchargement** :
blocs les plus gros à l'écran d'abord (taille projetée, comme Potree), du
fin près de la caméra et du grossier au loin, et la « fourchette » de
l'utilisateur comme seuil d'hystérésis pour ne pas retélécharger au moindre
mouvement. À faire après usage de l'étape 1.

**État des lieux du code (4 octobre 2026) : gros chantier, à ne pas lancer tout de suite.** Aujourd'hui la carte 2D pilote tout : `flux.js` reçoit un **rectangle** et un pas unique ; la 3D est un instantané (`construire3D` range les points déjà là, `definirNuage` renvoie tout le nuage au GPU, figé) ; les couleurs « hauteur » et « relief drapé » se lisent dans la surface de la vue 2D. Il faudrait : (1) un choix de blocs à la Potree par taille projetée (`blocsPourCamera`, pur, à côté de `blocsPourVue` ; les niveaux de l'octree s'additionnent, charger plus fin ajoute) ; (2) un `flux.js` qui accepte autre chose qu'un rectangle (le seuil de 60 km² n'a plus de sens en 3D oblique : un plafond de points) ; (3) un nuage qui s'étoffe par morceaux (un tampon par bloc) au lieu d'être refait, ce qui **casse** le dessin en part de paquets de hachage (`drawArrays(0, k)`) ; (4) une hystérésis ; (5) hauteurs et drapé hors du rectangle 2D. Gain : un lien 3D ouvrirait directement la 3D (règle R13 à la racine). Deux voies : **2a**, projeter la vue de la caméra au sol en rectangle pour le flux existant (rapide, mais un seul niveau de détail, nuage refait en entier) ; **2b**, la vraie, avec spec d'abord et plusieurs jours. **Raison du report :** publier d'abord, voir ce que disent les utilisateurs de la 3D ; si le lien 3D reste la seule gêne, le correctif de cadrage (R13, première partie) coûte une heure.

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
d'acquisition, numérotées **R1 à R14** (R1, R3 et R5 sont faits : retirés ; R8 à R14 viennent des deux retours du 3-4 octobre) pour ne pas les mêler aux #. Aucun nom
n'est écrit ici : le dépôt est public, et le fil du forum dit qui a demandé quoi.

**Rythme décidé** : répondre vite à chacun (« noté », « je regarde », ou « pas
prévu, parce que… »), mais **livrer par petits lots**, pas à chaque message ;
une annonce courte par livraison, qui mentionne les demandeurs. Répondre n'est
pas livrer. Ce qui ne colle pas à l'outil se refuse en le disant, et la raison
s'écrit dans CLAUDE.md pour ne pas la rediscuter.

| Lot | Contenu | État |
|---|---|---|
| A — mesure et aide | R1 et R3 sont faits (sur `dev`) ; R6 est codé sur sa branche | R6 à tester, puis fusion |
| B — lien | R2 | à concevoir d'abord |
| en attente | R4 | réponse du demandeur |
| à décider | R7 | comprendre ce qui est demandé |
| C — défauts | R13, R14 | à corriger d'abord (bogues, rapides) |
| D — interface | R11, R12 | petits changements d'ergonomie |
| E — fonds et ombrage | R8, R9 | OSM et ombrage monochrome réglable |
| F — comparaison | R10 | après E (plus de fonds à comparer) |

### R2 — Le lien porte la bande et la vue — publié le 4 octobre 2026

Fait : la bande, le point sélectionné, la règle de la carte et les classes du sol (si
différentes du défaut) sont dans le lien et se remettent à l'ouverture (CLAUDE.md, « Le
lien porte la bande et la vue »). Paramètres nommés et lisibles, clés françaises, sûrs
dans le forum, un paramètre abîmé ignoré en bloc.

**Décision (3 octobre)** : la **modale du profil n'est pas dans le lien** (ni coupe, ni
classes, ni mesure, ni référence). Un lien pose la bande et le mode Profil ; « Valider »
reste à celui qui ouvre. Raison : une ouverture automatique pouvait ouvrir la modale deux
fois, et rien ne dit sur quelle partie du profil zoomer. Si un jour on veut une coupe
partageable, il faudra aussi y mettre le zoom et la tranche.

**Écart avec la demande d'origine** : le demandeur voulait aussi, dans l'URL, « la sélection
des points » et « les classes visibles » du profil. Ne sont pas portés : les classes
visibles et les points de mesure **de la modale du profil** (les classes visibles de la
3D, la règle de la carte et le point sélectionné le sont). À lui dire en répondant.

**R2b — les réglages de la vue, codés sur la même branche, à tester** : couches de chaque
côté du rideau (`gauche`, `droite`), position du rideau (`rideau`, 0–100), `contraste`,
`svf=directions/rayon`, `lisse=0`, et pour la 3D `couleur`, `plafond` (millions de points),
`edl=0`, `cachees=` (classes masquées) ; plus la règle de la carte `regle=lat/lon/…`.
Décisions : **jamais l'onglet** (ouvrir un lien ne lance pas la 3D : un nuage à télécharger
et à bâtir, trop lourd, surtout au téléphone) ; le plafond de points est écrit quand même
(celui qui ouvre le change à sa guise) ; un seul lien, la barre d'adresse porte tout ;
seul ce qui diffère du défaut est écrit. *(La tranche et le zoom du graphique ne sont pas
dans le lien, par choix.)* Vérifié en navigateur (30 contrôles pour la vue, 6 pour la règle).

### R4 — Export GeoJSON — en attente

Demande : exporter des points en GeoJSON avec `ele` et `height` en propriétés.
Non fait : le besoin n'est pas formulé. Une question a été posée au demandeur (à quoi
cela servirait — JOSM, QGIS, uMap — et sur quels points : toute la bande, ou
ceux que l'on mesure).

- Sans sol reconstitué (voir R7), **pas de `height` par point** : seulement `ele`,
  la classe, la distance sur l'axe, la date d'acquisition.
- Poids : jusqu'à ~80 Mo pour 1 M de points, ~500 Ko pour quelques milliers.

### R6 — Point de référence — publié le 4 octobre 2026

Demande : dire « ce point est l'altitude 0 à partir de maintenant », comme dans
la méthode QGIS pour les bâtiments : un sol de référence, puis plusieurs points
sur plusieurs coupes, sans refaire les soustractions à la main (donc moins
d'erreurs de calcul). **Elle demande le zéro, pas l'affichage de hauteurs en
plus.**

Remarque d'un autre contributeur : une constante n'est pas un MNT (la hauteur est
MNS − MNT, pas MNS − X) ; la référence vaut sur un sol plat ou pour un seul
bâtiment. **À dire tel quel dans l'aide**, la question du sol comblé étant à part
(R7).

**Décisions d'interface**
- **Une barre d'outils dans la modale**, comme celle de la carte : Déplacement,
  Point de référence, Mesure. **Mesure par défaut** : cliquer un point du graphique
  mesure, comme aujourd'hui. Le glisser et la molette déplacent et zooment dans
  tous les outils ; seul le **clic** dépend de l'outil. L'outil actif se voit
  (en couleur, curseur en croix, courte consigne).
- **Outil « Point de référence »** : un seul point à la fois, chaque clic remplace
  le précédent (comme « Point sélectionné »). Il s'accroche au point visible le
  plus proche, comme la mesure.
- **Rendu** : un repère propre (une croix marquée « 0 »), distinct des points A, B,
  C de la mesure. Les axes passent en **relatif** : le 0 au point de référence,
  positif en haut et à droite, négatif en bas et à gauche, comme un graphe. Sans
  référence, les altitudes restent absolues. **Pas de bascule absolu / relatif.**
- **Rien de plus dans le tableau** : pas de colonnes « Cote » ni « Dist. depuis la
  réf. ». On lit sur l'axe, ou on mesure de la référence au point. *Idée mise de
  côté si quelqu'un la demande :* un petit tableau « Points » (distance et cote de
  chaque point depuis la référence) ; deux colonnes de plus ne tiennent pas sur
  téléphone.
- **Durée de vie** : la référence est supprimée **à la fermeture de la modale**.
  Changer la largeur dans la modale la garde (même ligne A–B, le point existe
  toujours sur le profil recalculé). Pour plusieurs coupes avec le même sol, il
  faut recliquer le point au sol à chaque coupe ; garder l'altitude d'une coupe à
  l'autre si des retours le demandent.
- **Effacer** : un bouton « Effacer la référence », dans la zone de l'outil, visible
  seulement quand une référence existe, et Retour arrière / Suppr quand l'outil est
  actif — comme les boutons de la mesure. « Point sélectionné » n'a pas de bouton
  (un nouveau clic le remplace) ; ici il en faut un pour revenir aux altitudes sans
  fermer la modale. *(proposé, à confirmer)*

**Aide du profil** : mise à jour dans la même branche (entrée 6 « Les outils », avec
la limite sol plat ou un seul bâtiment). Reste à la relire si R7 aboutit : la
phrase « chaque point est un vrai retour du LiDAR » devrait alors changer.

**À voir avec R2 (le lien)** : la référence est un état de la modale ouverte,
supprimée à sa fermeture.

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


## Retours du 3-4 octobre 2026 (R8 à R14)

Deux retours : un d'un naturaliste (mesure d'arbres, outil partagé dans sa
communauté), un d'un utilisateur mobile qui valide aussi les points du premier.
Regroupés par thème ; chaque demande dit qui la porte (1 = naturaliste,
2 = utilisateur mobile).

### R8 — Fonds de carte : OSM, et MNT/MNS ombrés IGN (1 et 2)

- **OpenStreetMap** dans les listes déroulantes de chaque côté du rideau : demandé
  deux fois, « OSM Carto et/ou OSM-fr ». Cas simple : une couche de tuiles de plus,
  comme « Plan IGN » (volet du côté). Attribution OSM obligatoire ; vérifier la
  politique d'usage des tuiles osm.org (le serveur public n'est pas fait pour un
  fort trafic ; OSM-fr est une alternative francophone).
- **MNT et MNS ombrés via les flux IGN** (1) : **écarté en septembre** (commit
  `90c7321`, CLAUDE.md « Sous le relief, la carte voilée ; rien que du COPC ») : on ne
  saurait plus d'où vient ce qu'on voit. **Proposition** : répondre par R9 (ombrage
  calculé depuis le COPC), pas par les flux IGN. À confirmer avec le demandeur.

**Conditions données par OSM France (5 octobre 2026)** : après la mise à jour du rendu par cquest, « ça semble jouable ». Le site doit être **gratuit**, **identifiable par le Referer** (ou X-Referer), et il doit être **clair que c'est OSM ou OSM-FR, avec un lien vers le copyright**. Il faut qu'**un point soit mis à l'ordre du jour du CA** d'OSM France (à demander : formulaire de contact de openstreetmap.fr, forum, ou la personne qui répond) ; elle-même ne sera pas disponible avant la fin de la semaine suivante. Alternative signalée : des serveurs professionnels gratuits (clé ou compte, voir la liste du wiki « Raster tile providers » : Stadia, Geoapify, Lima Labs…, et sans clé OpenTopoMap). **Côté code, faisable maintenant** : une couche OSM avec `referrerPolicy` de Leaflet (`origin`), attribution visible « © OpenStreetMap contributors » avec lien vers `openstreetmap.org/copyright` ; en `file://` il n'y a pas de Referer (tuile « Referer is required »), accepté. Blocages éventuels : dépôt `openstreetmap/tile-attribution`. **Étape 1 faite sur `feat/fond-osm` (5 octobre 2026)** : « OpenStreetMap (standard) » (`src/fonds-osm.js`, `FONDS_OSM.standard`, clé `osm`) dans les listes de chaque côté du rideau, avec `referrerPolicy: 'origin'` et attribution « © OpenStreetMap contributors » liée au copyright, testés d'abord (`test/fonds-osm.test.js`) ; vérifié en navigateur (Referer envoyé en http, absent en `file://`, tuiles servies dans les deux cas). L'entrée **France reste à faire** après l'accord (un test garde son absence).

**Décidé (5 octobre 2026) : proposer les deux fonds dans Scopus**, en deux temps. (1) **« OpenStreetMap »** (`tile.openstreetmap.org`, rendu mondial) tout de suite : serveur de la Fondation, ouvert à tout site qui respecte sa politique (Referer, attribution, pas de téléchargement en masse), **aucune autorisation à demander**. (2) **« OpenStreetMap France »** (clé `osmfr`, `tile.openstreetmap.fr/osmfr`, rendu français) **seulement après l'accord d'OSM France** : serveurs de l'association, accès limité par liste blanche de Referer. Pourquoi les deux : mêmes données, rendus différents, et pouvoir comparer les deux est utile pour voir où une contribution manque. Tant que l'accord n'est pas là, l'entrée France n'existe pas dans les listes.

### R9 — Ombrage monochrome réglable, MNT et MNS ombrés (2, rejoint 1) — fait, publié le 4 octobre 2026

Fait : « Ombrage » (4 soleils) et « Ombrage simple » (1 soleil) reviennent dans les listes de la vue normale (l'ombrage gris en avait été retiré pour sa pâleur), et deux curseurs, **azimut** et **hauteur** du soleil, règlent ces deux couches et l'ombrage coloré (l'azimut est celui du premier soleil, les autres suivent à 90° ou 120°). Dans le lien : `soleil=azimut/hauteur`, seulement s'il diffère de 315/45. **Reste** : choisir la surface éclairée, sol (MNT) ou dessus (MNS), demandé par le retour 1 ; et regarder si le gris à quatre soleils reste trop pâle (le contraste ou un seul soleil aident).

Ombrage gris (un soleil) et multidirectionnel, **avec azimut et hauteur du soleil
réglables** : rien n'est pré-rendu, tout se calcule dans le worker. Existe déjà :
l'ombrage coloré à trois soleils fixes (`RELIEF.ombrageRGB`) et les couches
d'ombrage de `RELIEF.COUCHES`. À regarder : ce qui manque est surtout les curseurs
(azimut, hauteur) et leur place dans le lien (`reglagesVue`, seul ce qui diffère du
défaut). Complément du SVF, ce qui répond à la demande 1 sans passer par l'IGN.

**L'azimut est grisé avec « Ombrage (4 soleils) »** (4 octobre 2026) : quatre soleils à 90° s'annulent deux à deux, l'azimut ne change rien (sauf sur de fortes pentes ou avec un soleil bas) ; une note le dit et renvoie à « Ombrage simple ». Actif dès qu'un côté porte l'ombrage simple ou coloré.

**MNT et MNS ombrés (retour 1) : faits sur `feat/mnx-ign`** (4 octobre 2026) : « MNT ombré (IGN) » et « MNS ombré (IGN) » dans les listes de chaque côté du rideau, tuiles WMTS de l'IGN (`IGNF_LIDAR-HD_MNT/MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW`, png, CORS ouvert, niveau 18 au plus), même mécanisme que « Plan IGN ». Éclairage fixe, pas de curseur ; marchent à tous les zooms, y compris en vue large où notre relief dit « Zoomez ». Notre ombrage n'est pas touché. Idées non faites : le MNH ombré de l'IGN (`..._MNH_...SHADOW`), un MNS calculé par nous sur `sommet` avec les curseurs de soleil. À noter : avec deux fonds de tuiles, le flux télécharge quand même les blocs LiDAR (« Affinage… 189 blocs »), à couper si aucun côté ne porte de relief.

### R10 — Comparer deux fonds côte à côte (1)

Demande du naturaliste : **deux cartes côte à côte, navigation synchronisée, curseur synchronisé** — **pas tout de suite.**
Gros chantier : le relief n'est posé que sur **une** carte Leaflet (`CalqueRelief`), il
faudrait une seconde carte avec son relief et son fond, liées (`move`/`zoom`), un repère qui
suit la souris de l'autre côté, et sur téléphone un empilement haut/bas qui rend peu de place.
À concevoir (spec) **après R8** (le fond OSM est ce qui rend la comparaison utile). Avant :
demander au demandeur ce qu'il ne peut pas faire avec le rideau à 50 % — si c'est surtout
« voir les deux en entier », la poignée du rideau au bord suffit peut-être.

**État des lieux du code (4 octobre 2026), pour quand on s'y mettra** : faisable, ni trivial ni insurmontable. Propre : `CalqueRelief` est autonome (un second sur une seconde carte, un seul côté visible), le relief est déjà calculé côté par côté, le flux ne change pas (deux cartes synchronisées regardent la même zone), 16 références seulement à `reliefCalque`. Moins propre : sélection, mesure, profil, HUD et marqueurs sont tous liés à `carte.map` (donc **première version en lecture seule**) ; `Carte` est trop lourde pour une seconde instance (un `L.map` simple + les fonds) ; `ecran`/`bornes` à calculer par côté ; disposition (`#vue-carte` est la carte elle-même) ; téléphone (deux cartes empilées, moitié de hauteur chacune, à décider). Ordre : façade des volets sans changement visible → seconde carte + synchro → image par côté → curseur synchronisé → lien (`cartes=2`) et téléphone → vérification. Environ 300–400 lignes.

**Précision du demandeur (5 octobre 2026)** : pas de plein écran sans menus, seulement la suppression du rideau, par un **petit bouton discret sur la carte** avec une icône parlante, qui à terme donnerait accès aux cartes synchronisées. Trois modes : **1 carte scindée par le rideau** (l'actuel), **2 cartes synchronisées** (50 % / 50 %), **1 seule carte pleine page**. Un **sélecteur à trois états** semble bon à l'utilisateur ; le détail de l'UX est à décider plus tard. Ordre : le mode « une seule carte » d'abord (petit), les cartes synchronisées ensuite (gros chantier, voir plus haut).

### R11 — Accueil : une croix pour fermer (1) — fait, publié le 4 octobre 2026

La croix est posée (bureau et téléphone vérifiés en Chromium). Reste ouvert : mémoriser la fermeture pour un habitué (décision à part).

« Voir un exemple » n'a plus d'intérêt depuis le chargement à la volée ; une petite
croix ferme la présentation et passe en navigation (comme « J'ai déjà des
coordonnées »). Un `location.hash` non vide saute déjà l'accueil. Garder
l'exemple du Bois des Caures en lien discret si on le juge utile.

### R12 — Interface : gagner de la place (2) — fait, publié le 4 octobre 2026

- **Outils à côté des boutons Carte / 3D** pour gagner une ligne et agrandir la
  carte.
- **Bouton « Partager » réduit à une icône** (menu inchangé).
- **Poignée du rideau poussée au bord** : introuvable, et sur Android le geste
  depuis le bord déclenche « retour ». Garder la poignée visible (butée avant le
  bord, ou languette) ; mobile = `pointer: coarse`, bande déjà à 44 px.

### R13 — Défauts du lien 3D et de la sélection (2) — désélection faite ; lien 3D en suspens

- **EN SUSPENS — décision à prendre (4 octobre 2026).** Le lien 3D est laissé de côté : la vraie réponse est sans doute la 3D qui pilote le téléchargement (#4), qui ferait d'un lien une caméra et supprimerait le double cadrage ; en attendant, on pourrait seulement corriger le cadrage à la bascule manuelle (reprendre l'échelle de la carte, petit et indépendant). À trancher : faire #4 d'abord (conception avant code), ou le correctif seul ; `ouvrirLien` en vue normale ignore aujourd'hui orientation et inclinaison (seul `?dalle` les relit). Texte d'origine ci-dessous.
- **Un lien de partage pris en 3D n'ouvre pas la 3D**, et en basculant à la main
  le point de vue est **trop zoomé**. Attention : CLAUDE.md dit « jamais l'onglet »
  pour les liens (ouvrir un lien ne doit pas lancer la 3D, millions de points) ;
  décision à rouvrir. Piste moins coûteuse : **corriger le cadrage** à la
  bascule manuelle (même zone que la carte), et peut-être proposer la 3D plutôt
  que l'imposer.
- **(fait sur `feat/deselection`) Impossible de désélectionner un point** : bouton « Effacer le point » sous Google Maps / OpenStreetMap dans « Point sélectionné » ; passer à Déplacement ne l'efface **pas** (on place un point puis on navigue). Fenêtre flottante comme le profil : écartée pour l'instant, à rouvrir si la fiche est pénible à lire au téléphone. Ancien texte : ; retirer `sel=` de l'URL ne rafraîchit
  rien (`hashchange` ne suit pas nos `replaceState` mais devrait suivre une
  édition à la main : à vérifier). Passer à l'outil de déplacement devrait tout
  effacer (point sélectionné, et la règle ?). À décider : ce que « tout » comprend.

### R14 — Artefacts en étoile du Sky-View Factor (2) — corrigé, publié le 4 octobre 2026

Cause trouvée (4 octobre 2026) : la **complétion par les non classés** (`inclureSursol`, plafond 3 m, active par défaut sans que sa case soit visible). Une plante ou un rebord de toit (cellule sans retour sol, retour non classé au-dessus) y faisait une tour dans un sol lisse, d'où l'étoile à huit branches. Corrigé en la désactivant par défaut : les classes du sol choisies décident seules de l'altitude (CLAUDE.md, « Lecture du relief »). La personne qui parlait des directions atténuait seulement le symptôme. La case d'essai pour comparer a été retirée après comparaison (le résultat apporte plus de contraste et de détail). Reste ouvert : voir une ruine connue en « non classé » sans retour sol, pour savoir si elle se lit assez avec les non classés ajoutés aux classes du sol.


### R15 — Ombrage : réinitialiser, trop lissé, multidirectionnel « cramé » (naturaliste, 5 octobre 2026)

- **Bouton « Réinitialiser le soleil »** : fait sur `feat/ombrage-reinit` (remet 315° / 45°, grisé quand le soleil est déjà au défaut, `RELIEF.soleilParDefaut` / `soleilEstParDefaut`, testés d'abord).
- **« Trop lissé » par rapport à l'IGN** (celui de l'IGN est plus net) : à **mesurer** avant d'agir. Notre grille est au pas du pixel, jamais sous 50 cm, avec comblement et lissage réglés en mètres ; les tuiles IGN sont servies à leur résolution native. Comparer sur un même lieu.
- **Le multidirectionnel est « trop cramé »**, on y voit moins de détails que dans l'ombrage simple. Rejoint ce qu'on a mesuré : quatre soleils opposés s'annulent deux à deux, ne reste presque qu'une carte de pente. Piste : une autre façon de combiner (pondération des directions, comme les hillshades multidirectionnels classiques à plusieurs azimuts pondérés, non vérifié ici) ; le demandeur renvoie à swisstopo, qui montre côte à côte le mono- et le multidirectionnel au même endroit (lien de comparaison à la frontière suisse, `#map=17/46.142244/6.111714` avec `gauche=ombrage-simple&droite=ombrage`).

### R16 — Profil : mêmes échelles en X et en Y (utilisateur, 5 octobre 2026) — fait sur `feat/profil-echelles`

Le graphique ajustait l'échelle verticale à la fenêtre et aux points, ce qui déformait les proportions. Fait : une case **« Échelles égales »**, **cochée par défaut** (mesurer sur un graphique déformé ne se lit pas), dans la ligne de réglages de la fenêtre du profil. À échelle égale la portée verticale se **déduit** de l'horizontale (`PROFIL.etendueEgale`) et « Vue entière » cadre tout le profil (`PROFIL.cadrageEgal` : la dimension la plus contraignante fixe les mètres par pixel, du vide reste de chaque côté) ; le zoom garde le point sous le curseur et l'égalité ; la fenêtre peut dépasser la bande tant que la bande reste dedans. Décochée : l'ancienne vue. Tests écrits d'abord (`profil.test.js`, `profil-graphique.test.js`).


### R17 — Rendre la liste des choix de relief plus claire (utilisateur, 5 octobre 2026)

Les listes de gauche et de droite du rideau portent maintenant beaucoup d'éléments : Photo aérienne, Plan IGN, OpenStreetMap (standard), MNT ombré (IGN), MNS ombré (IGN), Sky-View Factor, Ombrage (4 soleils), Ombrage simple (1 soleil), Ouvertures positive et négative, Micro-relief, Hauteur des structures, Trous dans le sol, Ombrage coloré (3 soleils)… À rendre plus lisible, **sans idée arrêtée** : regrouper par famille (fonds de carte / relief calculé par nous / relief de l'IGN), séparateurs ou titres de groupe dans la liste (`<optgroup>`), ordre par usage, descriptions plus courtes. À décider plus tard ; les clés des couches ne changent pas (les liens partagés restent valables).
