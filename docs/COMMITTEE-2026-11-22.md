# Comité FamilyHub — 22 novembre 2026

Cycle quotidien sur kevinpc, distinct de l’audit ponctuel du 21. Revue produit/UX/marché déléguée à **gpt-6-astra, effort xhigh**, puis critique indépendante du diff. Les avis des agents sont des analyses de code, pas des preuves expérimentales supplémentaires.

## Décision et périmètre

Un seul correctif proposé : conserver la couverture partielle des remboursements jusqu’au contexte de l’assistant d’Aujourd’hui. Le défaut est reproduit sur une réponse fictive, puis corrigé sur une branche isolée. Issue de suivi : [#305](https://github.com/vdskevin009/familyhub/issues/305). Exigences : FH-PROACTIVE-001, FH-MAIL-009, FH-UX-002. Pas de nouvelle collecte, alerte, donnée, décision financière, worker ou déploiement.

L’alternative minimale serait un avertissement visuel seul. Elle laisse le faux zéro dans le contexte transmis et ne résout donc pas le défaut. Le choix retenu réutilise la tuile et le panneau Sources existants, sans écran ou réglage supplémentaire. Aucun graphique ne représenterait honnêtement un total inconnu.

## Chaîne de preuve synthétique

Base inspectée : `3710eb1a29caecd06fa0d007277564a9f0915473`. Horloge fictive : 22 novembre 2026 à 16:00Z. Réponse HTTP 200 `/invoices`, `lastSuccess` du 21 novembre, `coverage.complete:false`, `heldMessages:1`, aucune erreur réseau.

| Étape | Avant | Candidat |
|---|---|---|
| Réponse source | Couverture explicitement partielle | Inchangée |
| Projection du total | `amount:0` si aucun dossier connu | `amount:null` |
| Accueil | « 7 sources accessibles », 0,00 $ | « 1 source partielle », « À vérifier / Couverture partielle » |
| Contexte POST `/tasks` intercepté | Couverture absente, total zéro | `complete:false`, `heldMessages:1`, total inconnu |
| Date d’origine | 21 novembre | 21 novembre, jamais remplacée par la lecture du 22 |
| Dossier connu de 120 CAD fictifs | Visible | Toujours visible avec son montant individuel, sans total exhaustif |
| Couverture complète et vide | Zéro | Vrai zéro conservé |

Les sources et le stockage ne sont pas modifiés. Le contexte ne reçoit que deux champs de couverture bornés, pas de progression de comptes ni de diagnostic brut. Aucun appel de modèle n’a eu lieu : toutes les requêtes `/tasks` sont interceptées et répondent par un texte fictif. Les autres origines sont bloquées.

**Limite explicite :** les anciens snapshots sans champ `coverage` conservent leur calcul historique. Ils sont projetés avec `complete:null`, jamais `true`. Ce correctif ne certifie pas leur exhaustivité. Un changement de ce contrat ancien mérite une décision séparée, pas une extension cachée de cette PR.

## Captures d’implémentation

Données entièrement fictives, Chromium desktop redimensionné ; ce ne sont ni des maquettes conceptuelles ni une acceptation sur téléphone physique. Les captures avant/après proviennent de builds distincts de la même copie isolée.

| Avant, 390 px | Après, 390 px |
|---|---|
| ![Avant : faux zéro sur couverture partielle](reviews/committee-20261122/before-390.png) | ![Après : total inconnu et état partiel](reviews/committee-20261122/partial-390.png) |

[Panneau Sources](reviews/committee-20261122/sources-390.png) · [Dossier connu](reviews/committee-20261122/known-390.png) · [Complet et vide](reviews/committee-20261122/complete-empty-390.png) · [Contexte avant](reviews/committee-20261122/before-context.json) · [Contexte après](reviews/committee-20261122/after-context.json) · [Résultats du parcours](reviews/committee-20261122/acceptance.json) · [Provenance et SHA-256](reviews/committee-20261122/provenance.json).

## Vérifications réellement exécutées ce cycle

Sur la copie isolée, dépendances déjà présentes, Node 24.22.1 ; build `VITE_MAIL_RETRIEVAL_MODE=plugin-only`. Aucun démarrage du worker installé ou d’un worker de test n’est nécessaire à ces tests ciblés.

| Commande | Résultat local |
|---|---|
| `FAMILYHUB_COVERAGE_BASELINE=1 node apps/web/tests/today-coverage-browser.mjs` sur le build de base | Défaut reproduit à 390 px : zéro et couverture absente dans le POST intercepté |
| `npm run typecheck` | Réussi |
| `npm run build` | Réussi |
| `npm run test:opportunities` | 29 tests réussis, dont 3 nouveaux cas de couverture/projection |
| `node --test tests/ci-browser-shard.test.mjs tests/pwa-install.test.mjs tests/theme.test.mjs` | 10 tests réussis |
| `TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --import tsx --test apps/web/tests/product.test.ts` | 150 tests réussis |
| `node apps/web/tests/today-coverage-browser.mjs` | Partiel/vide, partiel/dossier connu, complet/vide et POST simulé à 320/390/768/1440 px ; absence de débordement et fermeture clavier |
| `node apps/web/tests/proactive-browser.mjs` | Six largeurs ; erreurs/ancien/hors ligne/non appairé, liens précis, navigation, lectures retardées et écritures fictives refusées |
| `node apps/web/tests/visual-readiness-browser.mjs` | Six largeurs ; fraîcheur inconnue, divulgation clavier, navigation unique et résultats asynchrones périmés ignorés |

La critique indépendante a demandé des assertions explicites sur le texte de la tuile et un test des compteurs malformés / couverture absente. Ils sont ajoutés. Les compteurs négatifs, fractionnaires, non finis et chaînes ne deviennent pas une quantité valide. Une première exécution du candidat a démarré avant la fin du build et lu les anciens assets ; son échec est conservé dans le journal local, puis les parcours ont été relancés après compilation terminée.

Le script ajouté rejoint le groupe CI `test:proactive:browser`, vérifié par le contrat des shards. La PR doit encore être jugée sur le SHA distant et sa CI exacte. Aucun `workflow_dispatch` n’est exécuté. Le workflow existant réserve la préparation Pages et `deploy` à `main` hors événement PR ; une PR brouillon exécute les contrôles, pas la publication. Une future fusion vers main déclencherait normalement la publication : elle demande une autorisation distincte.

.NET n’est pas installé localement ; sa validation relève de la CI de cette PR. Les 197 tests et 12 parcours rapportés le 21 ne sont pas comptés ici. Aucun test de réception Push, téléphone physique, lecteur d’écran réel, comportement du modèle, source réelle ou passage naturel n’est revendiqué.

## Balayage produit : source → stockage → écran

| Module | Preuve autorisée examinée | Conclusion / limite |
|---|---|---|
| Aujourd’hui | `opportunities.ts`, `useOpportunities.ts`, `TodayView.tsx`, nouveaux contrats et navigateur | Perte de couverture démontrée et corrigée. Lecture, fraîcheur et exhaustivité restent distinctes. |
| Sources / Remboursements | Contrat `InvoiceSnapshot`, avertissements de couverture, documentation MAIL-HELD-SOURCES et #309 | Le stockage sait déjà retenir une source originale et signaler le partiel. Aucun changement de source ni de rapprochement ; parcours assureur non exécuté. |
| Finances / Comptes | `finance-monthly-accounts.ts`, `finance-source-trends.ts` | Versions, `sourceAsOf`, dates reçues et couverture ont des rôles séparés. Un filtre ne promeut pas un snapshot partiel. Pas de lecture de comptes ni de nouvelle preuve de soldes ; chantier existant non dupliqué. |
| Courses | `grocery-comparison.ts`, contrats de résolution des achats | Dates de prix, modes, formats et inconnues sont visibles ; prix de ticket séparé du catalogue. Aucun prix marchand réel vérifié. |
| Récurrents | `recurring-presentation.ts` et tests produit existants exécutés | Paiement observé, référence mensuelle et inconnu restent séparés ; totaux par devise, références exclues du graphique des paiements. Fréquence d’usage réelle inconnue. |
| Hypothèque | `mortgage-display.ts`, contrats de décision et documentation | Taux public, offre et gain net ne sont pas interchangeables ; éléments inconnus restent à confirmer. Pas de reprise des scénarios historiques ni d’accès au dossier. |
| Notifications | `notification-model.ts`, architecture de la bibliothèque | Historique, état lu/résolu, déduplication et consentement Push existent. Aucune source/cible Auto ou Immobilier dans le contrat actuel ; recevoir un Push n’est pas prouvé par son acceptation technique. |
| Auto / Immobilier | Diff #312 et contrats existants | Fiches de critères, inconnues, état daté et provenance ; pas de score de prix ni de notifications d’annonces suivies. Candidat non publié. |

Le parcours mobile conserve les cinq destinations, les boutons et le panneau partagé `Sheet`. Le statut partiel utilise du texte en plus de la couleur ; détails à la demande, dates et montant principal lisibles. Les skills frontend-design, better-interface, better-accessibility et le workflow Playwright du dépôt ont guidé la revue ; aucune installation de skill tiers. Une refonte générale ou un nouveau tableau de bord n’apporterait pas une preuve de fiabilité.

## Travaux existants conservés

État GitHub relu le 22 : main `3710eb1…`. #312 reste brouillon à `063b366a05d83520ffb78765196e8da8a4646b72`, [CI 44575744206](https://github.com/vdskevin009/familyhub/actions/runs/44575744206) réussie. #311 reste brouillon à `5afb931985f6b16851bd398aa42d00b0b11d516b`, [CI 44377698519](https://github.com/vdskevin009/familyhub/actions/runs/44377698519) réussie. #304 reste brouillon à `25df13045985ac2fb470762cbc021030626564ae`, [CI historique 44180874906](https://github.com/vdskevin009/familyhub/actions/runs/44180874906) réussie mais conflits avec main. Ces contrôles sont historiques, pas relancés ce cycle.

#311 traite les reports d’opportunités ; des fichiers sont communs mais le défaut de couverture est distinct. #304 traite la récupération financière, hors de ce correctif web. #291 et #292 restent abandonnées. Le baseline contrôlé de #309 rapporte des lectures assureurs sans nouvel élément et un mail dégradé avec un original retenu ; il n’a pas été rejoué. Les gates naturels et téléphone de #305/#309 restent ouverts.

## Deux suites utiles, sans nouvelle implémentation

| Proposition | Impact / fréquence / effort | Première étape et critère |
|---|---|---|
| Avis de changement matériel sur annonce suivie | Impact décisionnel potentiellement élevé ; fréquence réelle inconnue ; effort moyen, extension du contrat de notification nécessaire | Définir un événement sur deux observations datées de la même annonce, puis tester identité, changement et déduplication avant toute activation |
| Repère de consommation Auto par version exacte | Aide à comparer un coût d’usage, sans promettre une économie ; utile lors d’une présélection, fréquence inconnue ; effort faible pour un lien officiel, moyen pour un calcul sourcé | Commencer par la référence officielle. Zéro estimation si année/moteur/transmission/carburant sont ambigus ; même distance et hypothèses explicites pour toute comparaison future |

### Premier volet d’avis à définir

Réutiliser la fiche #312 et le centre de notifications, pas créer un fil supplémentaire. La première observation d’une annonce suivie établit une référence silencieuse. Un changement de prix n’est admissible que pour la même identité, même devise et même base de frais, avec ancienne/nouvelle valeur et date/source par fait. Une donnée nouvellement connue est annoncée comme telle, pas comme un changement du bien. Une nouvelle photo, un nouveau `checkedAt` ou une reformulation ne suffisent pas.

Vendu/retiré doit être attesté ; une annonce absente ou une erreur de lecture reste inconnue. L’identité sémantique de la transition doit survivre au redémarrage, aux relectures et aux observations arrivées dans le désordre. Suivre une annonce n’accorde pas le consentement Push. Aucun prix juste, note de fiabilité, rappel applicable ou état d’inspection n’est inventé. Immobilier : comparables vendus et affichés séparés, preuves du lot et des coûts strata distinctes de l’adéquation au projet.

Acceptation proposée : première observation silencieuse ; baisse/hausse attestée ; répétition sans doublon ; changement de date seul silencieux ; observation ancienne ignorée ; panne sans retrait ; retrait explicite non actionnable ; arrêt du suivi ; identité/prix/frais incomplets sans conclusion. Ces tests sont proposés, pas exécutés dans ce cycle.

### Comparables et piste économique — sources publiques

Consultation du 22 novembre 2026, sans compte ni contact externe :

- [REALTOR.ca — favoris](https://www.realtor.ca/my-favourites) annonce des mises à jour de prix, photos et portes ouvertes. FamilyHub gagnerait surtout à filtrer les faits matériels selon le projet et à montrer les inconnues ; un simple abonnement aux favoris du produit existant reste l’alternative minimale. Aucun compte ou fonctionnement réel n’a été testé.
- [RNCan — cotes de consommation](https://open.canada.ca/data/en/dataset/98f1a129-f628-4ce4-b24d-6f16bf24dd64?wbdisable=false), données annoncées mises à jour le 6 octobre 2026 : références par modèle et variantes, comparables sous conditions. Le repère minimal est un lien officiel ; un calcul futur utiliserait `distance / 100 × litres/100 km × prix du carburant`, avec chaque hypothèse affichée. Il ne comprendrait ni entretien, assurance, amortissement ni usage réel ; aucun gain personnel chiffré ici. Les cotes anciennes ajustées ne sont pas des essais nouveaux. La ressource directe a refusé une ouverture HTTP ; la fiche publique indexée a été consultée, aucun dataset téléchargé ou importé.
- [ICBC — inspection d’un véhicule usagé](https://icbc.com/vehicle-registration/buy-vehicle/buy-a-used-vehicle/inspecting-a-used-vehicle-for-sale) distingue identité, historique, rappels et inspection mécanique. Une fiche renseignée ne remplace donc pas la vérification du véhicule précis.
- [BCFSA — Form B](https://www.bcfsa.ca/industry-resources/real-estate-professional-resources/knowledge-base/practice-resources/form-b-information-certificate), publication du 27 mars 2023 : frais, budget, fonds de réserve et documents du strata ; une date récente seule ne garantit pas que les informations sont encore actuelles après un changement de budget.

La réduction de dépenses envisagée vient d’un meilleur choix documenté avant l’achat, non d’une transaction ni d’un rendement garanti. Aucun score composite ou calcul du coût des offres sur douze mois ne reprend la proposition abandonnée #292. Les avis Auto/Immobilier restent une proposition de contrat d’événements, pas une fonctionnalité disponible en production.
