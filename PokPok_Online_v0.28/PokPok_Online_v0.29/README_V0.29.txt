POK POK ONLINE V0.29
====================

Cette version part du prototype online V0.28 et ajoute le socle prévu pour le futur jeu en ligne :
- compte joueur avec identifiant + mot de passe/PIN (haché côté serveur) ;
- 50 rubis offerts à la création puis 50 rubis récupérables chaque jour ;
- salons Débutant 10 / Intermédiaire 20 / Expert 50 / Légende 100 rubis PAR JOUEUR ;
- 2, 3, 4, 5 ou 6 joueurs ;
- matchmaking automatique séparé par salon, nombre de joueurs et objectif ;
- salons privés par code ;
- pot = mise x nombre de joueurs, remis au(x) gagnant(s) en fin de partie ;
- logique POK POK multi-joueurs : tours, dernier tour de tous les adversaires, scores, Bonus ;
- mains adverses non envoyées au navigateur ;
- animations renforcées : distribution une par une, main pioche/défausse, Bonus, Voleur, Bombe, Pêcheur, POK POK et scintillements ;
- interface PC + responsive téléphone portrait/paysage ;
- main adaptative pour 5 à 8 cartes sans sortir de l'écran.

IMPORTANT PROTOTYPE
-------------------
Les comptes/rubis sont enregistrés dans data/users.json sur le serveur. C'est suffisant pour les tests locaux et un serveur avec stockage persistant. Sur un hébergement gratuit dont le disque est éphémère, les comptes peuvent être perdus lors d'un redéploiement/redémarrage. Avant une vraie mise en ligne publique, brancher une base de données persistante (PostgreSQL par exemple) sera nécessaire.

Lancement local : node server.js
Test automatique : npm test
Render : Build Command = npm install ; Start Command = npm start
