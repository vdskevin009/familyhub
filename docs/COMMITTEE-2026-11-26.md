# Comité FamilyHub — 26 novembre 2026

## Résultat et limites d'exécution

Une amélioration web bornée est retenue : signaler les sources écartées du bilan mensuel PC Express avant les montants et distinguer un historique vide de sources présentes mais inutilisables. Le calcul prudent existant est conservé. Aucun moteur de commandes, rapprochement de paiement, collecteur ou score supplémentaire n'est ajouté.

Exécution sur kevinpc, worktree isolé `review/committee-20261126`, base exacte `c72eb6933ecf968a7c58dd97bd31f636dcb1e9d9`. Aucun autre cycle du 26 visible dans les agents, worktrees et travaux GitHub consultés ; absence globale non certifiée sans accès à l'orchestrateur. AGENTS, README, architecture, sections pertinentes de REQUIREMENTS et décisions récentes consultés. Les exigences font 243 Ko : cette revue approfondit FH-GROCERY-011/015 et les contrats critiques, pas une nouvelle certification de chaque exigence historique.

La PR [#316](https://github.com/vdskevin009/familyhub/pull/316) est fusionnée à cette base. Sa [CI/main 45737876984](https://github.com/vdskevin009/familyhub/actions/runs/45737876984) est terminée avec succès ; ce résultat antérieur n'est pas un test exécuté aujourd'hui. Le correctif n'est pas refait. La lecture publique de `release.json` n'a pas abouti via l'outil Web, donc aucune nouvelle vérification de l'interface de production n'est revendiquée. La section historique des exigences qualifie encore #316 de brouillon : décalage documentaire constaté, non assimilé à l'état GitHub vérifié.

## Problème reproduit et solution minimale

Deux confirmations fictives enregistrées pour une même référence, 60 et 80 CAD, restent présentes mais sont exclues par `pcExpressMonthlySpending`. Sur la base, l'écran à 320/390 px affiche seulement un état vide invitant implicitement à attendre un import. Le motif du conflit reste dans « Couverture et méthode », fermé. Ajouter un reçu final indépendant de 25 CAD affiche correctement 25 CAD, mais le texte affirme que tous les achats sont inclus et l'exclusion reste invisible.

Le candidat change uniquement `GroceryMonthlySpending.tsx` dans le produit : un détail natif « Historique : N cas écartés des montants » apparaît avant les chiffres ; ses motifs et son périmètre global sont à la demande. L'état sans montant indique désormais que des sources sont présentes. La reprise suit le parcours existant Archives ou achat récent → Plus d'infos → Provenance → vérification du ticket. Aucun enregistrement n'est nécessaire pour consulter ou fermer.

Alternative plus petite écartée : modifier seulement le texte caché laisse l'omission silencieuse. Alternative plus grande écartée : additionner les expéditions, choisir le dernier montant ou ajouter un rapprochement bancaire inventerait une autorité que les sources n'ont pas. Un nouveau graphique n'aiderait pas à expliquer ce cas.

Les compteurs portent sur tout l'historique enregistré. Un conflit d'identités peut compter par enregistrement plutôt que par commande : le mot **cas** est volontaire. Aucun avertissement absent ne certifie une collecte exhaustive. Le modèle et les montants ne sont pas modifiés.

## Chaîne de preuves et audit transversal

| Parcours | Preuves du 26 | Ce qui reste inconnu |
|---|---|---|
| Courses, source → stockage → montant | 25 tests existants de parseur/store passent ; 7 assertions supplémentaires utilisent de nouveaux répertoires temporaires et les vrais helpers de persistance/projection. Livraison = estimation ; répétition = octets identiques ; trois messages incompatibles rejetés ; livraison ultérieure ou estimation modifiée = conflit sans remplacement. | Pas de mail réel, d'appel à un marchand ou de collecte. Le contrat PC Express ne constitue pas un moteur générique multi-expéditions. |
| Courses, réponse → cache → écran | Réponses API fictives issues de readbacks synthétiques, écran réel, états vide/incomplet/conflit/valide/zéro, conflit hors année et hors devise, référence ambiguë. Cache hors ligne, nouvelle réponse après reconnexion et parcours de vérification sans écriture. | Pas de serveur familial ni de téléphone physique. Les API sont substituées au transport HTTP, pas présentées comme une intégration réelle. |
| Aujourd'hui, Sources, Remboursements | Lecture des contrats de fraîcheur/couverture et contrôles PWA ; suite navigateur commune consignée dans la validation finale. Les pertes de couverture et reports d'échéance ont déjà leurs brouillons #313/#311. | Aucun nouveau passage assureur ou mail. #309 conserve son constat historique de lectures contrôlées sans nouvel élément et d'original mail retenu ; aucune acceptation naturelle nouvelle. |
| Finances et Comptes | Lecture du contrat de captures, dates source/réception, couverture et autorité des décisions ; #304 reste séparée. | Aucun compte, export, montant ou décision familiale consulté ; pas de nouvelle validation financière réelle. |
| Récurrents et Hypothèque | Lecture des contrats : montants observés, références commerciales, frais inconnus et devis restent distincts. | Aucun devis personnel, tarif garanti ou recherche pour un compte réel. |
| Notifications | Contrats d'identité, lecture/traitement et provenance ; avis de prix suivis déjà portés par #315. | Aucun Push envoyé, scheduler ou action de collecte exécuté. |
| Auto/Immobilier | 30 contrôles de modèles/client passent avec les deux cas HTTP isolés exclus de cette commande ; sources datées, inconnues, suivis/relecture et absence de score économique arbitraire. Parcours navigateur communs distincts des brouillons. | Une tentative initiale du test HTTP Immobilier n'a pas validé la connexion à son worker temporaire. Le test l'a arrêté dans `finally`; aucun worker installé touché. Cause locale non établie, intégration à vérifier par CI exacte. |

## Produit, mobile et critique indépendante

Skills frontend-design, better-interface et better-accessibility appliquées ; les six domaines propriétaires ont été lus par la revue produit. Les tests réutilisent Playwright et les conventions du dépôt, sans installation. Le composant conserve détails natifs, focus visible, contrôles de 44 px et valeurs textuelles du graphique. La modification n'ajoute aucun écran ou réglage ; elle retire une affirmation exhaustive trompeuse. Les textes explicatifs restent repliés.

**gpt-6-astra, effort xhigh** a relu le périmètre et inspecté les pixels avant/après. Sa critique a fait préciser le périmètre global des compteurs et renforcer la preuve de reconnexion : attendre un GET réussi puis une réponse différente remplaçant l'état en cache. Il n'a exécuté aucun test ; ce n'est pas une deuxième preuve expérimentale. Aucun défaut bloquant relevé dans la correction examinée. Contraste mesuré, lecteur d'écran, zoom 200 % et téléphone physique non certifiés.

## Priorités, économie et sources officielles

| Proposition | Impact / fréquence / effort | Première étape et critère |
|---|---|---|
| Retenue : exclusions visibles dans Courses | Prévenir la lecture d'un sous-ensemble comme total ; fréquence réelle inconnue ; faible effort web. | Deux sources contradictoires : conflit visible sans ouvrir la méthode, aucun faux zéro, sources toujours consultables. |
| Priorité projet existante : décision de fraîcheur #312, puis fiches/avis #315 | Aide avant un achat engageant ; fréquence inconnue ; validation de travaux déjà préparés. | Décider sans modifier les brouillons ; vérifier fait daté, inconnue explicite, changement matériel suivi et absence de notification doublonnée. |
| Piste économique conservée : coût d'usage auto, uniquement après identité technique vérifiée | Coût potentiel à comparer, sans gain personnel promis ; effort moyen lié aux preuves. | Même année/modèle/moteur/transmission/carburant, source officielle et hypothèses déclarées ; identité ambiguë = aucun montant. Non implémenté. |

[Walmart Canada, conditions de vente](https://www.walmart.ca/en/help/article/terms-of-sale/b419467945f843068ed57d927acb932f), consultées le **26 novembre 2026**, sections 4/6/7 : des expéditions séparées peuvent correspondre à plusieurs débits ; taxes arrondies et mode de paiement peuvent modifier montant ou calendrier. Cela justifie la séparation confirmation/expédition/règlement, sans établir le paiement d'une commande donnée. Les règles d'un marchand ne sont pas généralisées à un autre.

[PC Express/Superstore, montant de carte supérieur à la commande](https://www.realcanadiansuperstore.ca/en/help/payments/why-does-my-credit-card-show-a-higher-amount-for-my-pc-express-order), consulté le 26 : page officielle trouvée, mais ouverture directe limitée à sa coque JavaScript. Les éléments d'index relevés par la revue ne sont pas une nouvelle preuve de commande. Aucun chiffre personnel ni automatisation ne découle de cette source.

[RNCan, comparaison de consommation](https://fcr-ccc.nrcan-rncan.gc.ca/en/Search), page modifiée le **19 mars 2026**, relue le 26 : critères techniques et hypothèses de coût annuel. Le modèle actuel FamilyHub n'établit pas systématiquement moteur/transmission/carburant ; ajouter un chiffre à partir du seul nom d'annonce serait prématuré. L'adéquation au projet ne mesure ni la qualité du prix ni l'état du véhicule.

Pour Immobilier, conserver les preuves d'état et coûts/strata à la demande ; prix affichés et vendus ne sont pas interchangeables. [BCFSA, documentation et clauses strata](https://www.bcfsa.ca/industry-resources/real-estate-professional-resources/knowledge-base/clauses/clauses), consultée le 26 par la revue, identifie notamment Form B, budget, dépréciation, procès-verbaux et assurance. Aucun score de prix, conseil personnalisé ou collecte supplémentaire n'est retenu.

## Travaux conservés et décision

Les brouillons et CI historiques ont été relus sans relance : #311 `5afb931` / [44377698519](https://github.com/vdskevin009/familyhub/actions/runs/44377698519), #312 `063b366` / [44575744206](https://github.com/vdskevin009/familyhub/actions/runs/44575744206), #313 `6832b6b` / [45040696121](https://github.com/vdskevin009/familyhub/actions/runs/45040696121), #315 `2405be1` / [45216967118](https://github.com/vdskevin009/familyhub/actions/runs/45216967118), tous succès sur ces anciens HEAD. #304 `25df130` reste distinct. #291/#292 restent abandonnées. Aucun de ces travaux n'a été modifié.

[Captures d'implémentation et preuves locales](reviews/committee-20261126/README.md). La PR de ce candidat indique son SHA distant et sa CI exacte, séparés des contrôles locaux et des CI historiques ci-dessus. Décision attendue : revue du brouillon uniquement. Aucune fusion, publication, modification d'import/collecte, permission, secret ou donnée familiale ; aucune communication directe à Kevin. Les tests temporaires et la CI ne constituent pas une acceptation de production.
