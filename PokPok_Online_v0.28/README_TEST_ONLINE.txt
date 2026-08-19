POK POK ONLINE V0.28 — PROTOTYPE 1 CONTRE 1
================================================

IMPORTANT
---------
Ta V0.27 PC reste séparée et intacte. Cette V0.28 sert uniquement à tester le multijoueur en ligne.
Il n'y a volontairement ni rubis, ni compte permanent, ni classement pour l'instant.

CE QUI EST DÉJÀ DANS CE PROTOTYPE
---------------------------------
- 2 vrais joueurs, chacun sur son navigateur.
- Salon privé avec code à 5 caractères.
- Match rapide 1 contre 1.
- Main de l'adversaire jamais envoyée au navigateur : elle reste cachée côté serveur.
- Pioche / défausse synchronisées.
- Bonus Chance, Blocage, Voleur, Pêcheur et Bombe.
- POK POK + dernier tour + révélation des mains.
- Scores 500 / 1000 points.
- Reconnexion avec le même navigateur pendant environ 60 secondes.
- Réactions emoji.

TEST SUR UN ORDINATEUR MODERNE
------------------------------
1. Installer Node.js.
2. Dézipper ce dossier.
3. Ouvrir un terminal dans le dossier.
4. Taper : npm start
5. Ouvrir http://localhost:8080 dans deux navigateurs / deux onglets.
6. Dans le premier : Créer un salon privé.
7. Dans le second : saisir le code et Rejoindre.
8. Le joueur qui a créé le salon clique sur Lancer la partie.

POUR JOUER DEPUIS DEUX ENDROITS DIFFÉRENTS
------------------------------------------
Il faudra héberger ce petit serveur Node.js sur Internet. C'est l'étape suivante.
On pourra ensuite brancher l'application Android sur exactement le même serveur.

PROCHAINES ÉTAPES PRÉVUES
-------------------------
1. Héberger le serveur en ligne.
2. Tester 1v1 sur deux vraies connexions Internet.
3. Étendre à 3, 4, 5 et 6 joueurs.
4. Comptes joueurs.
5. Rubis quotidiens.
6. Salons Débutant / Intermédiaire / Expert / Légende.
7. Matchmaking selon la mise et le nombre de joueurs.
