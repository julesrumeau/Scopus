# Scopus — Reste à faire

Topo du 5 octobre 2026, fin de journée. `main` est au commit `4b4d7f1` ; `dev` a quelques commits d'avance (pincement du profil, 3D à rectangle borné). Le détail de chaque point est plus bas ; les numéros `#N` sont les anciennes tâches, `R1…R19` les retours reçus du forum OSM-FR (depuis le 1er octobre).

**Ce qui reste, dans l'ordre proposé**
1. **R18, profil** (le plus récent, une vraie personne attend) : *fait* — points gardés et montrés sur la carte, déplacer et retirer (souris et appui long), croix du tableau, pincement à deux doigts. *Reste* : déplacer les points de la **carte** aussi (marqueurs non interactifs) ; l'**insertion** entre deux points (question à poser à la personne) ; l'**export** `.osm`/GeoJSON **en pause** (il attend un axe défini finement, donc la polyligne) ; l'import d'un way OSM et la polyligne (gros chantier, à décider).
2. **R20, mesure à angle droit** (6 octobre) : tracer des lignes **verticales ou horizontales** avec la mesure (Shift + clic, convention des logiciels de dessin), surtout dans le **profil** pour lire une hauteur au-dessus du sol ; peut servir sur la carte et en 3D. Fait (6 octobre) : Shift + clic, 0° / 90°, mesure de la carte et du profil, aperçu pointillé (voir la section R20 et CLAUDE.md).
3. **R21 et R22** (6 octobre, une même personne) : un « **bouton localisation** » dont le sens est à clarifier (GPS de l'appareil, ou ouvrir l'endroit ailleurs : question à poser) ; une **intégration OpenSwitchMaps** — **écartée telle quelle** (l'extension n'est plus mise à jour) ; à la place, élargir « Ouvrir ailleurs » (voir R21).
4. **Petits fixes** (#6) : *faits le 5 octobre sur `fix/petits-fixes`* — panneau latéral sous la barre (601–900 px), point pile sur le bord d'une bande oblique, garde sans A/B, graphique grisé pendant « Calcul… », HUD dans la carte survolée. *Reste* : les deux côtés du rideau sur deux surfaces (demander les deux côtés dans un seul message au worker : changement de protocole, transitoire et sans conséquence visible, à ne faire qu'avec une raison).
5. **R15b / R15c, ombrage** (multidirectionnel « cramé », « trop lissé » face à l'IGN) : à mesurer avant d'agir.
6. **À vérifier sur de vrais appareils** (aucun accès ici) : appui long et pincement du profil, poignées A/B au doigt, icônes sur Safari iOS (R19), lien 3D sur téléphone.
7. **R19, pas urgent** : fichiers servis sans version (`max-age=600`), test de fumée versionné (`tools/fumee.js`). Le dernier incident (la page figée après « Voir un exemple », attrapée à la main) en rappelle l'intérêt.

**En attente d'autrui ou de décision** : R8 fond OpenStreetMap France (**demande envoyée le 5 octobre**, en attente : accord du CA d'OSM France, pas avant la semaine du 12 octobre) ; R7 combler le sol (à ne pas commencer) ; #3 case « non classés » (à vérifier sur une ruine connue). Détection de structures et de sentiers (#1, #2) : code retiré (tag `archive-avant-retrait-dalle`).

**Fait les 5 et 6 octobre** : fond OpenStreetMap, Réinitialiser le soleil, échelles égales du profil, listes de couches par famille, une seule carte et deux cartes synchronisées, retrait de `?dalle`, découpage d'`app.js` et de `Vue3D`, **correctif du bouton Profil** (publié), **profil qui garde son état, déplacer/retirer/pincer**, **3D à rectangle borné** (lien 3D, échelle et angles repris, nuage qui s'étoffe seul : #4 phase 1 et R13), mentions OpenStreetMap (ODbL) dans le pied de page et le README ; **Maj + clic : mesure à angle droit** (profil et carte) ; **bouton « Ma position »** ; petits fixes (panneau sous la barre en tablette, bande oblique, graphique grisé pendant le calcul, HUD de la seconde carte). Tout est publié sur `main` (`c97145f`).

**Branches** : ménage fait le 6 octobre 2026 — il ne reste que `dev` et `main` (`dev` = `main`). Les deux branches non fusionnées sont gardées par étiquettes : `archive/traces-detecteur` (12 commits d'un détecteur de tracés arrêté le 27 septembre) et `archive/plein-ecran` ; plus `archive-avant-retrait-dalle`. `git checkout archive/traces-detecteur` pour les retrouver.

**À annoncer au prochain message** : voir plus bas.

## Dette de structure : audit SOLID (5 octobre 2026)

Mesuré, pas ressenti (mesureur `test/taille-code.js`, validé contre acorn). Garde-fou : `test/taille-code.test.js` et son cliquet (une fonction 100 lignes propres, une classe 400, un fichier 1000 ; ce qui dépasse déjà ne peut que baisser, et `node test/taille-code.js --ecrire` ne doit jamais inscrire un nouveau dépassement). Contraintes : scripts classiques et espace lexical global (pas de modules ES, `file://`), workers composés du **texte** des fonctions, aucune dépendance. Méthode des extractions : une fabrique `creerX(deps)` à dépendances explicites, aucun changement visible, vérifié en Chromium avant et après (le même scénario sur `dev` et sur la branche).

**Fait (5 octobre 2026)**
- `app.js` : 3 834 → 710 lignes, plus aucun fichier au-dessus du seuil de 1000. Retrait du parcours `?dalle` (Vue2D, détection, sentiers : tag `archive-avant-retrait-dalle`), puis une fabrique ou un module par métier : `creerVueCartes`, `creerProfilUI`, `creerPanneauRelief` (+ l'objet `reglages`), `creerCalculRelief`, `creerNuage3D`, `creerPanneau3D`, `creerOutilsCarte`, `creerOutilsPoint`, `creerPartage`, `creerRechercheLieu`, `creerChrono`, `creerPanneauMobile`, `creerAccueil`, et deux modules purs testés : `creerCatalogueVue` (couches et fonds du rideau) et `STATUT_RELIEF` (phrases du statut) ; `html.js` (`echapper`).
- `Vue3D` : 1 252 → 663 lignes (méthodes mortes retirées, gestes et animations dans `ControlesVue3D`).

**Reste, par ordre d'intérêt**
1. `app.js` n'est plus que la racine de composition (deux IIFE de ~200 lignes propres) : ce qui reste, c'est le câblage lui-même (ordre de démarrage, `liaisons` posées après coup). Le dernier gain serait de le rendre déclaratif ; pas urgent.
2. `Vue3D` (663) : tampons GPU du nuage + EDL, pointé, `_rendre` (147 lignes).
3. **Registre déclaratif des couches** (ouvert/fermé) : `catalogue-vue.js` en est le premier pas (une seule liste des fonds et couches du rideau) ; reste `relief.js` `COUCHES` (calcul), `choix-couches.js` (famille) et `BALAYAGE`/`OMBRAGES` dans `panneau-relief.js`, à fondre dans une entrée par couche.
4. **`etat`** rendu à ses propriétaires (il ne porte plus que `restaurationPartage` et `nuage`) ; **`CONFIG`** passé par sections aux fabriques.
5. `ProfilGraphique` (438), `relief.js` (fabriqueRelief 330, preparer 169, balayerHorizons 163), `vue-relief.creer` (115), `flux.creer` (101), `carte.js` constructor (105).

## À annoncer au prochain message

Publié sur le site mais **pas encore annoncé** sur le forum (liste tenue à jour à chaque publication ; une fois le message envoyé, la vider). Annoncer par lots, quand il y a quelque chose que quelqu'un a demandé.

*Fait sur `dev`, pas encore publié :* **le zoom à deux doigts sur le profil** (il n'existait pas, signalé par la personne qui teste) ; **la 3D à rectangle borné** : un lien 3D ouvre la 3D (zoom, orientation, inclinaison repris), la bascule garde la même zone et la même échelle, le nuage s'étoffe tout seul (R13).

*Publié le 5 octobre, pas encore annoncé :* **le mode « deux cartes synchronisées »** (R10, le naturaliste) ; **le profil garde ses points** (chaîne, référence, outil, classes) et les montre sur la carte, **déplacer et retirer un point** de la mesure (souris, appui long au doigt, croix du tableau) (R18, la personne des mesures de pente) ; le bouton Profil qui avait disparu, corrigé.

*Publié le 5 octobre 2026 :*
- **Bouton « Réinitialiser le soleil »** pour l'ombrage (R15, demande du naturaliste).
- **Échelles égales du profil** : une case « Échelles égales », cochée par défaut, même échelle en distance et en altitude (R16, un utilisateur).
- **Fond « OpenStreetMap (standard) »** dans les listes du rideau (R8, demandé par les deux).
- **Bouton « une seule carte »** sous le zoom, avec une seule liste de couches (R10, le naturaliste : suppression du rideau, premier des trois modes prévus).
- **Listes de couches rangées par famille**, l'une sous l'autre (R17, remarque de l'utilisateur lui-même).

*À dire aussi, en attente :* OSM France a répondu que le fond « OpenStreetMap France » est jouable (point à l'ordre du jour du CA, pas avant la fin de la semaine du 12 octobre) ; le multidirectionnel « cramé » et l'ombrage « trop lissé » sont à l'étude (R15b, R15c).

### #1 — Rallumer la détection, ou renoncer *(prioritaire)*

*Le code a été retiré le 5 octobre 2026 avec `?dalle` (tag `archive-avant-retrait-dalle`) : renoncer est devenu le défaut ; rallumer = repartir du tag.*

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

### #4 — La 3D qui télécharge (étape 2) — phase 1 faite sur `feat/3d-rectangle` (5 octobre 2026)

**Phase 1 faite** : rectangle fixe d'après le lien ou la carte, caméra bornée, angles et échelle repris, nuage qui s'étoffe seul (voir CLAUDE.md, « La 3D de la vue »). **Phase 2 écartée** (décision du 5 octobre) : une 3D qui télécharge plus fin en zoomant. Texte d'origine ci-dessous.

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

- **Faits le 5 octobre 2026** (`fix/petits-fixes`) : le panneau latéral qui recouvrait toute la barre (onglets et outils) entre 601 et 900 px (il commence maintenant sous la barre, `--hauteur-barre`) ; l'arrondi de flottant sur une bande **oblique** qui écartait des points pile sur le bord (tolérance d'un millionième de centimètre, testé sur un axe 5-12-13 : 8 points sur 3 339 perdus) ; le champ de largeur sans A ni B ; le graphique qui restait cliquable pendant « Calcul… » (grisé) ; le HUD de la seconde carte (il suit la carte survolée). Reste : le glisser des poignées A/B au doigt, à essayer sur un vrai appareil.

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

**MNT et MNS ombrés (retour 1) : faits sur `feat/mnx-ign`** (4 octobre 2026) : « MNT ombré (IGN) » et « MNS ombré (IGN) » dans les listes de chaque côté du rideau, tuiles WMTS de l'IGN (`IGNF_LIDAR-HD_MNT/MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW`, png, CORS ouvert, niveau 18 au plus), même mécanisme que « Plan IGN ». Éclairage fixe, pas de curseur ; marchent à tous les zooms, y compris en vue large où notre relief dit « Zoomez ». Notre ombrage n'est pas touché. Idées non faites : le MNH ombré de l'IGN (`..._MNH_...SHADOW`), un MNS calculé par nous sur `sommet` avec les curseurs de soleil. **Couper ce téléchargement : pas sûr du tout (5 octobre 2026).** Ça peut poser problème à la 3D, qui se construit avec les blocs que le flux a déjà chargés pour la vue : sans relief affiché, plus de blocs, donc un nuage 3D vide ou incomplet. À ne pas faire sans avoir regardé ce que la 3D en attend. Constat de départ : avec deux fonds de tuiles, le flux télécharge quand même les blocs LiDAR (« Affinage… 189 blocs »), à couper si aucun côté ne porte de relief.

### R10 — Comparer deux fonds côte à côte (1)

Demande du naturaliste : **deux cartes côte à côte, navigation synchronisée, curseur synchronisé** — **pas tout de suite.**
Gros chantier : le relief n'est posé que sur **une** carte Leaflet (`CalqueRelief`), il
faudrait une seconde carte avec son relief et son fond, liées (`move`/`zoom`), un repère qui
suit la souris de l'autre côté, et sur téléphone un empilement haut/bas qui rend peu de place.
À concevoir (spec) **après R8** (le fond OSM est ce qui rend la comparaison utile). Avant :
demander au demandeur ce qu'il ne peut pas faire avec le rideau à 50 % — si c'est surtout
« voir les deux en entier », la poignée du rideau au bord suffit peut-être.

**État des lieux du code (4 octobre 2026), pour quand on s'y mettra** : faisable, ni trivial ni insurmontable. Propre : `CalqueRelief` est autonome (un second sur une seconde carte, un seul côté visible), le relief est déjà calculé côté par côté, le flux ne change pas (deux cartes synchronisées regardent la même zone), 16 références seulement à `reliefCalque`. Moins propre : sélection, mesure, profil, HUD et marqueurs sont tous liés à `carte.map` (donc **première version en lecture seule**) ; `Carte` est trop lourde pour une seconde instance (un `L.map` simple + les fonds) ; `ecran`/`bornes` à calculer par côté ; disposition (`#vue-carte` est la carte elle-même) ; téléphone (deux cartes empilées, moitié de hauteur chacune, à décider). Ordre : façade des volets sans changement visible → seconde carte + synchro → image par côté → curseur synchronisé → lien (`cartes=2`) et téléphone → vérification. Environ 300–400 lignes.

**Premier mode fait sur `feat/mode-carte` (5 octobre 2026)** : un petit bouton à deux états sur la carte, sous le zoom (carte scindée par le rideau / **une seule carte** en pleine page, `src/mode-carte.js` testé d'abord). En une seule carte : le rideau est rangé au bord (sans trait ni poignée), **la gauche est toujours montrée, avec une seule liste** (« Couche affichée ») ; la liste de droite, « Échanger » et « Rideau au centre » disparaissent du panneau ; le côté caché n'est **ni calculé ni chargé** (pas de tuiles) ; le retour à « scindée » remet le rideau et la droite telles quelles. Pas encore dans le lien (le rideau à 100 s'y écrit déjà). Le troisième état (deux cartes synchronisées) s'ajoutera à ce bouton.

**Précision du demandeur (5 octobre 2026)** : pas de plein écran sans menus, seulement la suppression du rideau, par un **petit bouton discret sur la carte** avec une icône parlante, qui à terme donnerait accès aux cartes synchronisées. Trois modes : **1 carte scindée par le rideau** (l'actuel), **2 cartes synchronisées** (50 % / 50 %), **1 seule carte pleine page**. Un **sélecteur à trois états** semble bon à l'utilisateur ; le détail de l'UX est à décider plus tard. Ordre : le mode « une seule carte » d'abord (petit), les cartes synchronisées ensuite (gros chantier, voir plus haut).

**Deux cartes synchronisées : le code est assez propre, une petite refacto d'abord (5 octobre 2026).** Lu, pas essayé. Propre : `CalqueRelief` est autonome (un par carte), le relief est déjà demandé côté par côté, `MODE_CARTE` est pur, `carte.nouveauFond` donne des couches posables sur une autre carte. Gênant, sans être bloquant : le bloc de la vue normale est une seule fermeture de ~1150 lignes (`app.js`) où seuls ~15 endroits touchent `carte.map` (écran du calcul, bornes du flux, curseur, outils) et 10 appels `reliefCalque`. Pas de grosse refonte nécessaire (ne pas découper le bloc pour l'occasion). Ordre proposé, une branche chacune : (1) **façade des volets — faite sur `refactor/volets` (5 octobre 2026)** : `src/volets.js` (`VOLETS.voletDe`, `ecran`, `coteSous`, testé d'abord), `volets` dans `app.js`, plus aucun appel par côté ne passe directement par `reliefCalque` (seuls restent ceux du rideau), vérifié sans changement visible ; sans changement visible : un volet = { carte, calque, côtés } ; `calculerRelief`, `majCotes`, le curseur passent par lui (un seul volet aujourd'hui) ; (2) `CalqueRelief.definirUnique(côté)` et `MODE_CARTE` pour montrer la **droite** seule (la carte B) — **faite sur `feat/calque-cote` (5 octobre 2026)** : `definirUnique('gauche' | 'droite' | null)`, `MODE_CARTE.partRideau(côté, partAvant)`, `cotesDe`, `coteUnique`, testés d'abord ; vérifié sur une seconde `L.map` de test (droite seule : rideau à 0, retour à la position d'avant) ; (3) la seconde carte : `L.map` simple + son calque, disposition (un conteneur autour des deux cartes), synchronisation (déplacement et zoom, garde contre l'écho), repère du curseur sur l'autre carte ; (4) lien (`cartes=2`), téléphone, bouton à trois états. Décisions à prendre : outils (sélection, mesure, profil) **désactivés** en deux cartes dans la première version ; téléphone : empilées ou côte à côte ; en deux cartes le panneau garde ses deux listes (Gauche = carte de gauche, Droite = carte de droite), « Rideau au centre » disparaît.

**Deux cartes synchronisées : faites sur `feat/deux-cartes` (5 octobre 2026), version en lecture seule.** Le bouton passe à trois états (scindée / une seule / deux cartes). `SYNCHRO` (déplacement et zoom dans les deux sens, verrou contre l'écho, repère du curseur sur l'autre carte), `MODE_CARTE` par modes (`cartes`, `panneau`), seconde `L.map` créée au premier passage, empilées sous 600 px, panneau à deux listes (« Échanger » reste, « Rideau au centre » disparaît), lien `cartes=2`, outils grisés dans ce mode. Tests écrits d'abord (`synchro`, `mode-carte`, `lien-partage`), vérifié en navigateur (bureau et téléphone). **Reste** : les outils (sélection, mesure, profil) sur les deux cartes ; le curseur d'info (HUD) est affiché dans la carte de gauche même quand on survole l'autre.

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

### R13 — Défauts du lien 3D et de la sélection (2) — désélection faite ; lien 3D fait le 5 octobre (`feat/3d-rectangle`)

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


### R17 — Rendre la liste des choix de relief plus claire (utilisateur, 5 octobre 2026) — fait sur `feat/liste-relief`

Les listes de gauche et de droite sont rangées en cinq familles par des `<optgroup>` (`src/choix-couches.js`, testé d'abord) : **Fonds de carte** (Photo aérienne, Plan IGN, OpenStreetMap (standard)), **Relief : lumière et ombres** (ombrages 4, 1 et 3 soleils), **Relief : formes du terrain** (Sky-View Factor, ouvertures, micro-relief), **Relief : mesures du sol** (hauteur, trous), **Relief de l'IGN** (MNT et MNS ombrés). Clés et libellés inchangés (les liens partagés restent valables). Une couche qu'aucune famille ne connaît tombe dans « Autres », en dernier : elle ne disparaît pas. Ajouter une couche : l'ajouter à sa famille dans `FAMILLES`. Les deux listes sont **l'une sous l'autre, intitulé à gauche** (grille à deux colonnes) : côte à côte, chacune faisait 170 px et les libellés étaient coupés ; elles font 289 px, à 1400 px comme à 380 px. Reste ouvert : les listes de l'ancien parcours `?dalle`, non touchées.

### R18 — Profil : points de la mesure, export OSM, polyligne (utilisateur, 5 octobre 2026)

Même personne que les mesures de pente (escalier, chemin en paliers et marches). Quatre demandes, de la plus petite à la plus grosse :

1. **Les points cliqués sur le profil disparaissent** *(fait sur `fix/profil-etat-conserve`, 5 octobre 2026 : chaîne, référence, outil, classes et échelles égales gardés tant que A→B ne bouge pas, et la chaîne dessinée sur la carte ; tests écrits d'abord)*. Ancien constat : « Si je reviens vers la carte, je ne peux pas voir les points cliqués sur le profil. En retournant vers le profil, tous les points ont disparu. » Deux causes dans le code : (a) les points de la mesure du graphique n'existent que dans la modale, jamais sur la carte (un point du graphique est `{ s, z }`, distance sur l'axe et altitude : la position sur la carte se déduit de A, B et `s`) ; (b) chaque ouverture de la modale repart de zéro (`validerProfil` remet l'outil sur la mesure et `calculerProfil` refait `afficherMesureProfil([])`). Piste : garder la chaîne tant que la bande (A, B, largeur) ne change pas, la dessiner sur la carte (SVG du volet des outils, comme la mesure de la carte), et la remettre à la réouverture. À décider : la chaîne entre dans le lien ? (non, comme le reste de la modale, voir « La modale du profil n'est pas dans le lien »).
2. **Déplacer les points de la mesure, en ajouter, en supprimer** sur le graphique. *(Déplacer et supprimer : faits sur `feat/profil-points-editables`, 5 octobre 2026 ; ajouter : seulement à la fin pour l'instant, la question de l'insertion entre deux points est à poser à la personne ; déplacer les points sur la **carte** aussi : à faire ; tactile à vérifier sur un vrai téléphone.)* Aujourd'hui : un clic pose un point à la suite, Retour arrière retire le dernier, « Effacer » tout. À faire : saisir un point et le glisser (il reste accroché au point visible le plus proche), le supprimer (clic droit ou touche), en insérer un entre deux. Le clic ne doit rester que de la pose en bout de chaîne ; le glisser des points est un nouveau geste, à distinguer du glisser du graphique.
3. **EN PAUSE (décision du 5 octobre 2026) — Export des géométries au format OSM.** Le point délicat : un point du profil est `(s, z)`, sa position sur l'**axe** A→B et une altitude ; le vrai retour LiDAR est ailleurs dans la largeur de la bande (écart latéral, rendu par le worker). Une idée écartée : accrocher chaque point à un vrai retour pour lui donner sa position exacte (`A + u·s + n·d`) : la forme tracée serait **aléatoire**, alors que le but est des points **sur un axe précis** à exporter. Le modèle retenu est donc : *position = sur l'axe défini par la personne, altitude = lue au profil* (ce que fait déjà l'affichage sur la carte). Ce qui manque pour un export sérieux, c'est un **axe défini finement** (une polyligne tracée sur la carte, point 4) plutôt qu'une droite A→B avec une bande ; l'export attend donc ça, et la personne avait de toute façon demandé la polyligne. Ne pas relancer sans en reparler. Ancien texte : Rejoint **R4 (GeoJSON)** : même sujet, le besoin est maintenant formulé : exporter **la chaîne mesurée** (pas les points bruts), avec `ele` par point. Deux formats : **GeoJSON** (LineString + Points avec `ele`) et **`.osm`** (XML : nœuds `ele=*` et un way, ouvrable dans JOSM). Rien d'envoyé nulle part, comme le reste (fichier téléchargé). Dépend de 1 (une chaîne qui reste, avec ses positions sur la carte).
4. **Tracer une polyligne sur la carte (et/ou charger un way OSM), avec interaction entre carte et profil.** Gros chantier : aujourd'hui une bande est **droite** (A, B, largeur) ; une polyligne demande une bande qui suit des segments (distances cumulées, coins, recouvrements) dans `profil.js` et dans le worker (`VUE_RELIEF.profil`). Charger un way OSM : une requête Overpass (CORS ouvert, mais un service de plus, avec sa politique d'usage). À concevoir (spec) **après** 1 à 3 ; demander à la personne si une bande droite par segment suffit (profil de chaque tronçon d'un escalier).

**Ce qui est demandé « au format OSM » (à ne pas confondre avec R8, le fond de carte)** :
- **Export** (point 3) : la chaîne mesurée en fichier **`.osm`** (nœuds `ele=*`, un way ; ids négatifs pour JOSM) et en GeoJSON. Nos propres points : aucun souci de licence ODbL.
- **Import** (point 4) : **charger un way OSM** (chemin, escalier) pour en faire le profil. Passe par Overpass ; les données importées sont **© les contributeurs d'OpenStreetMap (ODbL)** : mention visible à l'affichage, et ne pas les réexporter sans cette mention.

Ordre proposé : **1**, puis **2**, puis **3** ; **4** seulement si 1 à 3 ne suffisent pas à l'usage.

### R19 — Ce qui s'est cassé en ligne : icônes invisibles, rechargement, test de fumée (utilisateurs, 5 octobre 2026) — pas urgent

*Un seul retour, d'une personne qui complétait celui du bug du profil : à garder en tête, sans y travailler tout de suite.*

Deux retours : « soit il suffit de recharger la page (constaté entre deux versions), soit il faut changer de navigateur » ; une personne ne voit **pas les icônes** sur son téléphone (**Safari sous iOS**), le demandeur sous **Chrome Android**.

Ce qui est établi :
- **Le bouton Profil a vraiment disparu** de tout le site publié après le retrait de `?dalle` (une règle `body:not([data-mode="vue"]) #mode-profil { display: none }` restée alors que plus rien ne posait l'attribut). Corrigé et publié (`18d9bd3`), avec un test qui interdit toute règle `body[data-mode]`. C'est sans doute le cas « Chrome Android ». Les autres boutons de la barre (déplacement, sélection, mesure) restaient visibles.
- **Les fichiers sont servis avec `cache-control: max-age=600`** (GitHub Pages) et sans version dans leur adresse (`styles.css`, `src/*.js`). Pendant dix minutes après une publication, un navigateur peut avoir un `index.html` neuf avec un `styles.css` ou un script d'avant (ou l'inverse) : des éléments qui manquent, des erreurs sans cause visible. « Recharger suffit entre deux versions » est exactement ce symptôme. Un rechargement forcé règle ; un changement de navigateur aussi (autre cache).

À faire :
1. **Version dans l'adresse des fichiers**, sans étape de construction : un petit script `tools/estamper.js` écrit dans `index.html` un `?v=<empreinte>` (hachage du contenu de `styles.css` et de `src/`) sur chaque fichier local ; un test échoue si l'empreinte écrite n'est plus celle du contenu (on a oublié de l'estamper). Deux fichiers jamais mélangés : une publication change l'adresse de tout ce qui a changé. À lancer avant chaque publication (un `git push` déploie toujours : le test oblige à y penser).
2. **Test de fumée versionné** (`tools/fumee.js`, à la main avant une publication, hors `npm test` pour garder zéro dépendance) : ouvrir la page, l'exemple, cliquer **chaque bouton de la barre d'outils** (le profil jusqu'à la modale), la 3D, un lien complet ; échouer si un bouton est invisible, une erreur de console, un script en 404.
3. **Safari iOS** : non reproductible ici (Chromium seulement). Demander à la personne quelles icônes manquent (la barre d'outils ? les trois boutons sous le zoom ?), la version d'iOS, et si un rechargement force les voir. Pistes si cela persiste : les icônes sont des `<svg>` en ligne dont la couleur vient de `fill: currentColor` ; vérifier un contraste de bouton non défini par Safari, `focusable`, et les `fill-opacity` des trois modes de la carte.

### R20 — Mesure à angle droit : lignes verticales ou horizontales (utilisateur, 6 octobre 2026) — fait sur `feat/mesure-angle-droit`

Demande (même genre de personne que R18, qui trouve l'outil « déjà excellent ») : « tracer des lignes verticales ou horizontales avec l'outil Mesure », « touche Shift maintenue + clic ⇒ le point se pose automatiquement sur l'axe vertical (ou horizontal) », comme un logiciel de dessin vectoriel. Surtout pour le **profil** : une ligne **verticale** (même distance `s`, autre altitude) donne **une hauteur au-dessus du sol** sans viser le point exact ; une ligne **horizontale** (même altitude) compare deux niveaux. Utile aussi sur la **carte** et en **3D**.

**Conventions relevées** (recherche du 6 octobre) :
- **Shift maintenu pendant le tracé = contraindre l'angle** : Figma, InDesign, Illustrator, GIMP, Inkscape, Word ; le plus répandu pour une ligne (0° / 90°, souvent aussi 45°, ou des multiples de 15° dans Okular).
- **AutoCAD** : mode **Ortho** en **bascule** (F8), et **Shift** le renverse **temporairement** (« temporary override ») ; un mode « polar tracking » (F10) ajoute des angles et affiche un **guide pointillé**.
- **QGIS** (numérisation avancée) : on **verrouille** un angle, une distance ou une coordonnée dans un panneau (touches A, D, X, Y), en verrou souple ou dur.
- **JOSM** : la touche **A** bascule l'« angle-snapping » ; Ctrl désactive l'accrochage, **Shift y a un autre sens** (nœuds isolés) : la convention n'est donc pas universelle.
- Pas de touche Shift sur **téléphone** : il faut un **bouton** à bascule.

**Pièges propres à Scopus :** Shift+glisser **pivote** la 3D et sert à zoomer en boîte sur la carte Leaflet (Shift+clic sans glisser reste un clic) ; Ctrl a des sens de navigateur (zoom de page, clic droit sous macOS) : à éviter ; la mesure du profil **s'accroche aux points LiDAR**, ce qui s'oppose à une position contrainte sur un axe.

**Décision du 6 octobre 2026 (garder simple, pas un QGIS) :** seulement la **2D** (mesure de la carte) et le **profil** (mesure du graphique), **pas la 3D** ; seulement **0° et 90°** ; **Shift + clic** = le point se pose sur l'axe (vertical ou horizontal, le plus proche de la direction du curseur) du **point précédent** ; un **aperçu pointillé** tant que Shift est tenu, pour que le contrôle ne surprenne pas ; pas de verrou à bascule, pas de magnétisme automatique, pas de panneau de contraintes. Dans le profil : verticale = même distance `s` (la hauteur au-dessus du sol), horizontale = même altitude. Écartés pour l'instant : le tactile (pas de Shift), la 3D (Shift+glisser y pivote), Shift pendant le déplacement d'un point existant. Une ligne d'aide près de l'outil le dit (« Maj + clic : à angle droit »).

### R21 — OpenSwitchMaps, MapSwap et les liens vers les outils d'OSM (utilisateur, 6-7 octobre 2026) — MapSwap à tester

Demande : une intégration à **OpenSwitchMaps** (extension de *tankaru*, MIT : son dépôt dit qu'elle **ne peut plus être mise à jour**, on recommande le bookmarklet ; 21 tickets, 3 demandes de fusion ouverts) → **écartée**. Un contributeur a répondu : « regarde du côté de **MapSwap** » (<https://mapswap.trailsta.sh/>, *TrailStash*, GitLab `trailstash/mapswap`, 142 commits, un **bookmarklet** « pour aller d'une carte à l'autre en gardant la vue »). Fonctionnement (README) : un JSON de cartes `{ name, icon, template }`, le gabarit prenant `{x}` (longitude), `{y}` (latitude), `{z}` (zoom Mapbox/MapLibre), `{Z}` / `{Zr}` (zoom Google / Leaflet-osm.org, un de plus), `{zr}` (entier) ; un JSON personnalisé peut être hébergé (CORS) et installé par `whitelabel.html?maps=…`.

**Pour Scopus** : le lien a déjà le format d'osm.org (`#map=zoom/lat/lon`, zoom Leaflet), donc **Scopus comme destination** est une simple entrée : `{ name: "Scopus", icon: <logo>, template: "https://julesrumeau.github.io/Scopus/#map={Zr}/{y}/{x}" }`. **À vérifier** (rien d'essayé ici) : que le bookmarklet **lit** bien une adresse Scopus comme source (notre fragment porte des paramètres de plus : `&profil=…`, `&gauche=…`) ; essai à faire en installant le bookmarklet et en le lançant depuis Scopus. Si ça marche, **rien à coder** ; sinon, demander au mainteneur de MapSwap d'ajouter Scopus, ou d'accepter les paramètres en plus. À côté, « Partager » propose déjà « Ouvrir dans OpenStreetMap » ; d'autres destinations en un clic (éditeur iD, Géoportail, Mapillary) restent possibles, de simples liens.

### R22 — « Peut-être un bouton localisation ? » (même personne, 6 octobre 2026) — fait sur `feat/localisation` (lecture A : « Ma position »), la question à la personne reste ouverte

Le message dit seulement : « Et aussi peut-être un bouton localisation ? » (juste après OpenSwitchMaps). **Deux lectures** : **A**, la géolocalisation (« Ma position » : le GPS de l'appareil centre la carte — `navigator.geolocation`, HTTPS exigé, rien d'envoyé, refus et délai à gérer) ; **B**, lié à l'idée précédente : ouvrir l'endroit affiché dans un autre outil, ce que « Point sélectionné » (Google Maps, OpenStreetMap) et « Partager → Ouvrir dans OpenStreetMap » font déjà. **Question à poser à la personne** : « Tu penses à un bouton "Ma position" qui centre la carte sur ton GPS, ou à ouvrir l'endroit affiché dans un autre outil ? » Si c'est A : petit (une heure), utile sur le terrain, dans le panneau Lieu et/ou sous le zoom. Si c'est B : déjà couvert, on ferme (et R21 élargit les destinations).

### Export de la mesure (suite de R18 n°3) — une piste que le retour R21 rouvre

Ce qui bloquait l'export, c'était la **position** d'un point du profil (un point `(s, z)` n'a pas de position précise dans la largeur de la bande). Mais la **mesure de la carte** est déjà une polyligne dont chaque point a une position **exacte** (cliquée sur la carte, ou posée à angle droit avec Maj) et une altitude (`sol` + `hauteur`). Son export est donc sans ambiguïté : **GeoJSON** (`LineString` + points `[lon, lat, ele]`) et **`.osm`** (nœuds avec `ele`, ids négatifs, un way), ouvrables dans JOSM, QGIS, uMap. À faire **avant** la polyligne du profil, qui reste en pause.

