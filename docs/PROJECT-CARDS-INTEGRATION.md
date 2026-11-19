# Fiches Auto et Immobilier — préparation à l’intégration

Kevin a autorisé l’implémentation après le bilan du 19 novembre, dans la PR #312 existante. Ce passage prépare l’intégration ; il n’autorise ni fusion ni publication. FH-PROJECT-001, FH-VEHICLE-001, FH-PROPERTY-001 et FH-UX-002 ; suivi #305 existant, inchangé.

## Périmètre final

- Cartes mobiles courtes : adéquation au projet, premier critère manquant/non respecté, date propre à l’offre et prix explicitement non évalué.
- Détail : points à vérifier en premier ; notes/sources/dates complètes à la demande ; modèle/année/version distincts de l’exemplaire ; statut, historique déclaré, inconnus et frais strata connus/inconnus conservés.
- Comparaison immobilière : cardinalité, unicité et appartenance exacte aux annonces sélectionnées ; une réponse valide réordonnée reste admissible.
- Fraîcheur immobilière côté web seulement : la date de consultation du statut compte autant que l’observation. Les réponses de lecture et de comparaison d’un worker existant peuvent être optimistes ; le client recalcule sa qualification. Statut inconnu, futur ou plus ancien que 48 heures ne devient pas disponible. Les faits/date source et le suivi manuel ne sont jamais réécrits.
- Dialogue natif partagé, clavier/Escape, retour du focus, cibles tactiles et contraste vérifiés sur les parcours synthétiques.

La précédente proposition dans le modèle partagé sous `apps/worker` a été retirée pour respecter le nouveau périmètre. **Différence nulle de cette PR par rapport à main dans `apps/worker`, les tests worker historiques, les workflows et le verrou de dépendances.** Aucun nouveau protocole, stockage, schéma, score économique, alerte, recherche ou collecte. Aucun accès au worker installé, à une source familiale ou à un profil utilisateur.

## État vérifié avant la continuation

Main est `3710eb1a29caecd06fa0d007277564a9f0915473`. La PR #312 à `5736e4b` est ouverte, en brouillon, sans conflit, commentaire ou revue déposée. CI 44559699400 réussie en tentative 2 ; l’échec initial d’un test synthétique assureur et l’unique relance sont conservés dans le bilan précédent. Aucun de ces tests n’est modifié ici. Les PR #304/#311 et les autres chantiers ne sont pas intégrés.

Les instructions AGENTS/REQUIREMENTS/README/architecture et le workflow existant sont relus. Aucun skill n’est présent sous `.agents/skills` dans cette copie ou la racine de travail ; les guides frontend-design/better-interface/accessibilité/Playwright déjà disponibles dans le catalogue local restent les références utilisées. Pas de nouvelle installation.

## Validation du périmètre final

Typechecks et build plugin-only, tests client/modèle/projet et preuve de différence nulle du worker. Le test de fraîcheur a été déplacé côté client : réponse optimiste du backend, statut ancien/inconnu, frontière exacte de 48 h / futur, et même garde appliquée à la comparaison. Le navigateur reçoit explicitement un état `available:true, stale:false` appuyé par une ancienne preuve et doit afficher À actualiser.

Les huit parcours isolés Auto/Immobilier à 320/390/768/1440 px sont relancés sur données fictives : motif au premier écran, sources/inconnus, mauvais comparables refusés, suivi 409/relecture/reload, absence de répétition des écritures, hors-ligne/vide, clavier et navigation. Aucune donnée privée n’est nécessaire. Les captures du bilan demeurent des captures d’implémentation fictives, pas une preuve téléphone ou de production.

Le head distant et la CI exacte du périmètre final sont consignés dans la description de la PR et le retour terminal. Ne pas réutiliser la CI de l’ancien head pour qualifier le nouveau. Les suites complètes et .NET sont vérifiées par la CI existante ; .NET n’est pas disponible localement. Pas de lecteur d’écran, téléphone physique ou source réelle certifié.

## Chemin normal de mise en service

1. Revue et décision de fusion séparées, avec recontrôle du head et des contrôles GitHub. Le brouillon et l’absence d’auto-merge sont conservés pendant ce passage.
2. Une fusion sur main déclenche automatiquement le workflow existant : compilation, unitaires, .NET, quatre shards navigateur, porte `build`, puis publication de l’artefact testé sur GitHub Pages via `deploy`. Ce passage ne modifie aucun déclencheur, job ou réglage.
3. Après cette autorisation et cette publication : vérifier le SHA servi par `release.json`, les assets et la prise en compte par un rechargement PWA ordinaire. Ces actions ne sont pas réalisées sur la production pendant cette préparation.
4. Aucun déploiement/redémarrage worker, migration, nouveau pairing, permission ou secret requis par ces changements web. Les endpoints et décisions existants sont réutilisés. Les sources réelles et la couverture du prochain passage naturel restent des validations séparées de #305/#309.

GitHub retourne une liste vide de rulesets pour ce dépôt. La lecture administrative de la protection de main est refusée 403 (`Resource not accessible by integration`) ; aucun contournement ou changement d’accès n’est tenté. La porte et les jobs du workflow sont vérifiables, mais les éventuelles règles administratives supplémentaires devront être confirmées dans GitHub lors de la revue/fusion normale.
