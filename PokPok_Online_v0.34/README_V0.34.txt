POK POK ONLINE V0.34
====================

OBJECTIF DE CETTE VERSION
-------------------------
V0.34 réunit le socle multijoueur de V0.29 avec le rendu, la densité visuelle et les animations de la V0.27 PC qui servait de référence.

PARTIE / RENDU V0.27 RÉINTÉGRÉ
-------------------------------
- structure de table et charte graphique reprises de V0.27 ;
- cartes joueur agrandies sur PC ;
- disposition téléphone portrait + paysage conservée et renforcée ;
- 5, 6, 7 ou 8 cartes adaptatives sur mobile ;
- nombres de cartes restantes retirés de Pioche / Défausse ;
- chrono de tour 45 secondes avec avertissement visuel ;
- bouton Quitter pendant la partie ;
- surbrillance des cartes jouables/sélectionnées ;
- distribution rapide carte par carte, joueur par joueur ;
- main visible pour pioche et défausse ;
- Voleur : animation prendre + rendre face cachée ;
- Pêcheur : 1/2/3 pioches visibles mais accélérées ;
- Bombe : défausse complète + nouvelle main animées ;
- Chance / Blocage : effets visuels renforcés ;
- annonce POK POK : halo, paillettes et scintillements plus riches ;
- joueur actif mis en évidence ;
- musique menu plus basse que la musique de partie ;
- règles intégrées.

ONLINE / COMPTES / RUBIS
------------------------
- comptes avec identifiant + mot de passe/PIN haché côté serveur ;
- 50 rubis à la création ;
- bonus quotidien de 50 rubis les jours suivants ;
- Débutant 10 / Intermédiaire 20 / Expert 50 / Légende 100 rubis par joueur ;
- 2, 3, 4, 5 ou 6 joueurs ;
- objectifs 500 ou 1000 points ;
- matchmaking automatique par niveau + nombre de joueurs + objectif ;
- salons privés par code ;
- pot = mise x nombre de joueurs, versé au(x) gagnant(s) à la fin de la partie ;
- mains adverses conservées côté serveur et non envoyées aux autres navigateurs ;
- reconnexion temporaire après perte de connexion.

MENU V0.34
----------
- navigation Jouer / Roulette / Boutique / Profil ;
- sélecteur d'avatar graphique 100 % intégré au jeu (pas de menu natif du téléphone) ;
- roulette quotidienne avec gains possibles : 5 / 10 / 20 / 30 / 50 / 100 rubis ;
- boutique affichée avec les packs demandés :
    50 rubis   = 1,49 €
    100 rubis  = 1,99 €
    250 rubis  = 2,99 €
    500 rubis  = 4,99 €
    1000 rubis = 7,99 €

IMPORTANT BOUTIQUE
------------------
Les boutons de prix sont une maquette fonctionnelle d'interface : aucun paiement réel n'est effectué et aucun rubis n'est crédité par un achat dans cette V0.34. Un fournisseur de paiement / achat intégré devra être branché et sécurisé avant publication.

IMPORTANT STOCKAGE
------------------
Les comptes/rubis sont enregistrés dans data/users.json pour le prototype. Sur un hébergement gratuit avec disque éphémère, ils peuvent être perdus lors d'un redéploiement/redémarrage. Avant une publication réelle, utiliser une base persistante (ex. PostgreSQL).

LANCEMENT / TEST
----------------
Local : npm start
Tests : npm test
Render : Build Command = npm install ; Start Command = npm start


V0.34 - changements ciblés
- Bonus Chance : la seconde défausse peut activer un autre Bonus normalement avant POK POK.
- Plus de salons privés : matchmaking uniquement, les mises en rubis sont toujours utilisées.
- 50 rubis uniquement à la création du compte, puis 1 roulette gratuite/jour.
- Roulette : 10 / 20 / 40 / 50 / 80 / 100, équiprobables, moyenne = 50 rubis/jour.
- 50 et 100 rubis mis en avant visuellement.
- Livret : zoom + / - sur PC et pincement à deux doigts sur mobile.
- Mobile : garde anti-chevauchement des textes + repositionnement dynamique des actions.
- Musique : pause dès que la page/app passe en arrière-plan et reprise au retour si Musique=ON.
- Google / Facebook / Téléphone : intégration Firebase prête, à activer via variables Render (AUTH_FIREBASE.txt).


V0.34 - corrections ciblées
- table mobile recentrée en portrait et paysage
- sélection tactile sans saut
- résultats de fin de manche plus lisibles sur téléphone
- logo d’accueil PC centré
- roulette PC plus compacte et texte statistique retiré
- textes de tour/POK POK/Bonus recentrés
- Blocage : gorille + banane ; Voleur : prise et restitution animées


V0.34 - CORRECTIONS CIBLEES
----------------------------
- suppression du clignotement/saut mobile : la main est mise à jour sans recréer toutes les images ;
- sélection de carte avec léger soulèvement comme V0.27 ;
- Pêcheur : sélection simultanée de 3 cartes puis défausse des 3 en une fois ;
- Voleur : fenêtre de 5 cartes cachées façon V0.27, avec raton laveur ;
- cibles Blocage / Bombe / Voleur : surbrillance sans déplacement des cases joueurs ;
- suppression de l’icône joker/bouffon dans Voleur et la confirmation Quitter ;
- zone joueur mobile légèrement abaissée pour libérer PIOCHE / DÉFAUSSE.
