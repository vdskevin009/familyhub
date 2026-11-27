# Avis de prix des annonces suivies — FH-NOTIF-008

Candidat isolé du comité du 23 novembre 2026, suivi #314. Non activé en production. Complément aux fiches de #312 ; aucun score de prix ni nouvelle collecte.

## Parcours et règles

Le cœur « Suivre » existant reste l'unique sélection. Le scanner de notifications lit les observations immuables et les décisions de suivi existantes. La première lecture de chaque période de suivi établit une référence silencieuse. Une lecture ultérieure peut produire un avis dans Notifications, ouvrant directement le dossier exact. Les faits avant/après et leur date sont dans « Sources et contexte ». Une annonce absente donne un état explicite, jamais un autre dossier.

Le modèle exige une identité stable, deux prix CAD connus et différents, un prix et un statut actif vérifiés depuis moins de 48 heures, sans date future ni conflit. Il utilise les dates des faits, pas la seule date de capture. Toute variation est admise, hausse comprise : aucun seuil d'intérêt économique n'est prétendu. L'absence d'information n'est pas une baisse ni un prix nul. Une identité changée ou un inconnu rétablit une référence silencieuse. Les changements de statut seuls et les nouvelles annonces sont hors périmètre.

Les 48 heures sont un horizon interne de revérification, pas une validité commerciale. Les dates de preuve sont affichées dans le fuseau Vancouver. La source ne fournit pas de date indépendante de réception par FamilyHub : l'avis décrit un changement daté dans les sources, pas un fait prétendument appris à cet instant.

## Conservation et dédoublonnage

Seul `notifications/history.json` reçoit un curseur supplémentaire `projectPrices`. Les fichiers d'observation, le suivi, les décisions financières et les collecteurs ne sont pas modifiés. L'enregistrement reste atomique et sérialisé. La corruption échoue sans remplacer le fichier. Une source indisponible conserve ses anciens avis ; elle n'empêche pas l'autre domaine de progresser.

L'identité d'avis combine domaine, annonce, identité de source/véhicule et prix final. Les identifiants d'observation et les dates de relecture n'arment pas un nouvel avis. Une réapparition du même prix ne crée pas un second avis et ne réécrit pas la preuve déjà lue : l'ancien rappel reste historique. C'est volontairement conservateur : une seconde occasion au même prix ne sera pas signalée. Les identités dédupliquées persistent au-delà des 500 événements affichés. L'historique de décision conserve les règles existantes.

Aucun Push pour cette catégorie : candidat non éligible, préférence désactivée, activation refusée côté bibliothèque et aucun réglage présenté. Aucune permission de navigateur, clé ou appareil n'est créé par cette fonctionnalité.

## Compatibilité et future mise en service

Le frontend demande `GET/POST /notifications?projectPrices=1`. Sans ce paramètre, la réponse masque le nouveau type d'événement pour les anciennes interfaces, sans toucher l'historique ni sa révision. `projectPricesSupported` permet à la nouvelle interface de signaler un ancien worker qui ne produit pas ces avis. Les anciennes préférences restent valides.

Une fusion sur `main` déclenche normalement CI puis GitHub Pages. Ce lot demande seulement une PR brouillon. Une éventuelle autorisation de mise en service doit coordonner frontend et worker, vérifier les sources réelles autorisées et préserver un état privé frais. Une simple publication web n'active pas le scanner du worker installé. Un ancien worker ne sait pas relire le nouveau type/cursor : ne pas restaurer un ancien fichier d'historique pour revenir en arrière ; prévoir un lecteur compatible ou une désactivation revue, sans perte des décisions.

Le candidat combiné avec #312 devra être revalidé lors de son intégration. Aucun score, comparable vendu, fiabilité mécanique, estimation immobilière, coût global ni économie réalisée n'est fourni par cet avis.

## Validation synthétique

- Modèle pur : suivi, référence initiale, dates/inconnus/conflits, identité, retard, contrôle au même prix, retour au prix antérieur, reprise et centimes.
- Bibliothèque sur répertoires temporaires : persistance, lecture, corruption, indépendance des sources, projection anciens clients et aucun Push même avec appareil fictif inscrit.
- PWA sur localhost : quatre largeurs, source/dossier exact, clavier/Échap/focus, rechargement, ancien worker, dossier absent, vide, erreur puis récupération. Sources fictives inchangées.

Voir [rapport et commandes](COMMITTEE-2026-11-23.md). Ces vérifications ne constituent pas une acceptation sur téléphone physique ou production.
