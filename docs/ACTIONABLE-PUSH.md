# Avis qui appellent une action

FH-NOTIF-001/002, suivi #170. Cette intégration de #319 réutilise en lecture les preuves officielles de projet et ouvre l’annonce exacte. Elle n’inclut ni la règle de variation de prix ni l’état de #315.

## Trajet vérifiable

1. L’écran Notifications → Préférences lit la permission Web, le service worker actif et l’abonnement de ce navigateur. Le diagnostic compare localement son empreinte avec les inscriptions exposées par le PC. La configuration d’Android, son canal d’affichage et la réception actuelle nécessitent le téléphone.
2. Le worker en activité examine les preuves enregistrées environ toutes les quinze minutes. Le premier passage par source est silencieux. Les préférences contrôlent les futurs envois. Un retrait de permission, un PC hors ligne, une source indisponible ou le premier passage peuvent chacun expliquer un silence. La cause sur l’appareil de Kevin reste inconnue.
3. Pour une action encore valable, le worker réserve la livraison avant transport, sous le budget commun d’un avis par jour de 8 h à 21 h à Vancouver. Un identifiant opaque ouvre le centre puis le dossier correspondant. Le service worker affiche uniquement le libellé générique. Une acceptation par le fournisseur, une expiration et un résultat incertain ont des états distincts. Le test manuel emprunte directement ce transport.
4. Kevin rapporte avoir déjà reçu un test Push. Les suivis consultés #170, #265 et #305 ne contiennent pas de reçu horodaté pour ce téléphone. Son observation historique est compatible avec un silence ultérieur lors de la sélection automatique. Aucun accès aux profils ou données d’installation pendant cette revue.

## Catégories proposées

- **Dossier de remboursement ouvert depuis 14 jours**. Date de changement de statut, dossier ouvert, attente d’un assureur, solde potentiel positif, pièce source présente, couverture complète sans message retenu, dernière lecture de moins de sept jours. Le rappel invite à vérifier la transmission. Le modèle n’a pas de date confirmée d’envoi pour calculer un délai contractuel de remboursement. Une absence de preuve ou une clôture empêche l’envoi.
- **Nouveau bien à visiter**. Annonce active apparue depuis moins de 48 heures. Budget, quartier, chambres et entrées satisfont les quatre critères, avec une source récente propre à chaque fait. Le lien ouvre le bien exact, sans conclure sur sa valeur de marché.
- **Nouvelle auto à examiner**. SUV d’occasion AWD dans le projet, année/version et kilométrage sourcés. Au moins trois autres annonces du Grand Vancouver de même configuration, à 10 000 km près, ont chacune un prix affiché au moins assez élevé pour que l’annonce examinée soit 10 % sous le moins cher des trois. Les références du prix sont datées et accessibles dans le centre. Des vendeurs peuvent republier la même voiture sous d’autres URL. L’utilisateur vérifie NIV, état, frais et inspection avant de considérer l’offre.

Les trois préférences sont initialement désactivées. La relecture, le redémarrage et l’activation ultérieure ne réexpédient pas un événement déjà traité. Un client plus ancien conserve les nouvelles préférences. Le serveur réserve les nouveaux événements aux clients qui demandent le format compatible.

## Validation et acceptation restante

Les tests emploient une bibliothèque privée temporaire, un expéditeur en mémoire et des annonces fictives. Le navigateur utilise la PWA locale, son service worker et un abonnement simulé. Les tests couvrent le budget existant, la sélection, les limites de dates/prix/kilométrage, les informations manquantes, l’identité du dossier et le diagnostic d’inscription. Aucun fournisseur n’est appelé. L’acceptation physique requiert ultérieurement un événement éligible, un appareil inscrit, un envoi autorisé puis une observation écran verrouillé et une ouverture du bon dossier. Aucune installation ni opération de livraison réelle pendant cette préparation.

[Capture synthétique du diagnostic à 390 px](reviews/actionable-push-20261127/missing-registration-390.png).


## Activation sur le PC jumelé

Pages publie la PWA uniquement. Les nouvelles catégories s’affichent seulement lorsque le PC retourne les préférences correspondantes (worker 2.30.3, capacité `actionable-push-v1`). Sauvegarder l’historique privé des notifications avant de remplacer le worker, sans déplacer les secrets VAPID ni la configuration de pairage. Tester la reprise du service avec la lecture de santé et un historique conservé; n’activer aucune catégorie, ne réinscrire aucun appareil et n’envoyer aucun test à la mise en service. La réception physique reste à confirmer séparément.

La version 2.30.2 ne lit pas l’état enrichi par 2.30.3. Préserver un point de restauration privé avant démarrage; si retour arrière nécessaire, arrêter d’abord le worker et conserver à part l’état enrichi avant le retour au binaire et au schéma compatibles. Ne pas remettre en file des livraisons traitées ou incertaines.
