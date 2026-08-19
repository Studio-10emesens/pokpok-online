POK POK ONLINE V0.31
====================

OBJECTIF DE CETTE VERSION
-------------------------
V0.31 réunit le socle multijoueur de V0.29 avec le rendu, la densité visuelle et les animations de la V0.27 PC qui servait de référence.

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

MENU V0.31
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
Les boutons de prix sont une maquette fonctionnelle d'interface : aucun paiement réel n'est effectué et aucun rubis n'est crédité par un achat dans cette V0.31. Un fournisseur de paiement / achat intégré devra être branché et sécurisé avant publication.

IMPORTANT STOCKAGE
------------------
Les comptes/rubis sont enregistrés dans data/users.json pour le prototype. Sur un hébergement gratuit avec disque éphémère, ils peuvent être perdus lors d'un redéploiement/redémarrage. Avant une publication réelle, utiliser une base persistante (ex. PostgreSQL).

LANCEMENT / TEST
----------------
Local : npm start
Tests : npm test
Render : Build Command = npm install ; Start Command = npm start
