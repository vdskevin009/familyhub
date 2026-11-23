# Comité FamilyHub — 23 novembre 2026

## Conclusion et périmètre

Le premier volet utile retenu est un **avis de changement du prix affiché sur une annonce explicitement suivie**, dans le centre de notifications existant. Le problème est observable dans le code : les historiques Auto/Immobilier contiennent déjà les variations, mais aucun type, source ou lien de notification ne les exploite. Le nombre de changements réellement manqués est inconnu : aucun compte ou dossier privé n'a été consulté.

Ce lot suit #314 et complète les fiches #312. La version préparée est un candidat web + source worker, pas une fonctionnalité mise en service. Aucun Push, collecte, score de bonne affaire, gain garanti, message à un vendeur, achat ou modification financière. Aucune fusion ni publication effectuée.

## Exécution et indépendance

Exécuté sur `kevinpc`, worktree `familyhub-committee-20261118/output/playwright/committee-20261123-source`, branche `review/committee-20261123`, depuis main `3710eb1a29caecd06fa0d007277564a9f0915473`. Au démarrage : aucun autre agent de cycle actif visible, aucun worktree du jour, recherches GitHub du 23 sans autre cycle. Les outils de liste globale de threads/environment_management n'étaient pas exposés ; l'environnement sélectionné était bien kevinpc. Aucune automation consultée/modifiée. Le parent a confirmé la fin du 22 et la suspension de l'ancien comité.

AGENTS, REQUIREMENTS, README, architecture et les PR ouvertes ont été relus. Skills locales utilisées : frontend-design, better-interface, better-accessibility et Playwright ; aucune installation. Le workflow navigateur du dépôt a été réutilisé. La délégation native produit/UX/marché a explicitement sélectionné **gpt-6-astra, effort xhigh**, conformément à Kevin. Une autre revue a examiné architecture/tests, puis a implémenté le helper pur : sa validation n'est donc pas une critique indépendante de ce helper. La critique produit finale est restée en lecture seule. Les avis IA sont des analyses, pas plusieurs preuves indépendantes.

Le navigateur est Chromium automatisé avec profils jetables et API interceptée, sur serveurs statiques localhost. Aucun profil personnel, worker/index local, compte, mail, donnée réelle, identifiant ou modèle n'a été utilisé. Les seules écritures de données d'essai sont dans de nouveaux dossiers temporaires fictifs.

## Travaux préservés et preuves historiques

| Travail | SHA relu le 23 | Contrôle existant, non rejoué comme ancien cycle |
|---|---|---|
| #311 report d'échéance | `5afb931985f6b16851bd398aa42d00b0b11d516b` | [44377698519](https://github.com/vdskevin009/familyhub/actions/runs/44377698519), succès |
| #312 fiches Auto/Immobilier | `063b366a05d83520ffb78765196e8da8a4646b72` | [44575744206](https://github.com/vdskevin009/familyhub/actions/runs/44575744206), succès |
| #313 couverture partielle jusqu'à l'assistant | `6832b6b15609e9515fd2e8f82f8fbc89434bc089` | [45040696121](https://github.com/vdskevin009/familyhub/actions/runs/45040696121), succès |
| #304 récupération financière | `25df13045985ac2fb470762cbc021030626564ae` | chantier distinct, non modifié |

Les PR sont restées en brouillon. #291/#292 restent abandonnées. Aucun travail d'import/soldes ni Figma repris.

[Le suivi #309](https://github.com/vdskevin009/familyhub/issues/309) rapporte des lectures assureurs contrôlées sans nouveaux éléments, et un mail partiel avec un original calendrier retenu faute de capacité du connecteur. Ce sont les preuves existantes du suivi, pas de nouvelles lectures du 23. Les passages naturels et le téléphone restent ouverts dans [#305](https://github.com/vdskevin009/familyhub/issues/305).

## Balayage source → stockage → interface

| Module/parcours | Preuve examinée et conclusion | Limite du cycle |
|---|---|---|
| Aujourd'hui → assistant | `useOpportunities.ts`, `opportunities.ts`, `TodayView.tsx` : lectures indépendantes, date de source distincte de récupération. La couverture mail partielle est déjà le sujet de #313. | Pas de duplication ; #313 non intégré ici, aucun appel modèle. |
| Sources/Remboursements | `worker.ts` transporte coverage ; docs `MAIL-HELD-SOURCES.md`, #309 distinguent progression du scan, original retenu et complétude. | Aucun portail ou compte lu ; suivi naturel #305 non vérifié. |
| Finances/Comptes | `FinanceMonthlyAccounts.tsx`, vues dépenses/tendances source : captures datées et devises séparées, inconnu affiché « Non établi », requête complète limitée à son périmètre. | Lecture de code uniquement ; pas de correction de solde ni opération financière. |
| Courses/Récurrents | Architecture et `opportunities.ts` : couverture/identité/format/frais requis ; dates contractuelles et équivalence distinctes d'une offre moins chère. | Régressions produit synthétiques ; aucun panier réel ou recherche personnelle. |
| Hypothèque | `mortgage-decision.ts` distingue coût inconnu et zéro, simulation et offre confirmée ; tests notifications hypothécaires. | Aucun taux/profil privé consulté, aucun devis ni contact. |
| Notifications | `notification-model/library`, ancien navigateur et nouveau parcours : historique persistant, révision, sources indépendantes et preuve de livraison distincte de réception. | Pas de Push réel, pas de téléphone. |
| Auto/Immobilier | `vehicle/project-model`, `property/project-model` : observations immuables, décisions de suivi révisionnées, faits datés. `card.changes` peut inclure inconnu→prix et utilise observedAt : insuffisant comme événement fiable. Nouveau helper lit les faits originaux. | Source réelle et fréquence de collecte non inspectées ; toute proposition dépend des observations existantes. |

Risque préventif traité : une arrivée tardive ou un retour à un même prix pouvait produire une fausse nouveauté ou remplacer la preuve d'un avis lu. Les identités et dates de la première notification sont désormais conservées, sans réactivation. Démonstration synthétique, pas incident familial observé.

## Choix produit, bénéfice et alternatives

| Priorité | Impact, fréquence, effort | Première étape et acceptation |
|---|---|---|
| Avis prix suivis — retenu | Évite de rouvrir chaque dossier pour chercher une variation. Fréquence réelle inconnue. Effort moyen : petite projection déterministe + adaptation du centre existant ; aucun écran supplémentaire. | Première lecture silencieuse ; changement documenté → une carte nommée → bon dossier ; reprise/retard/retour au prix précédent sans doublon ni preuve réécrite. |
| Repère consommation officiel — différé | Peut éclairer un coût d'usage récurrent, sans gain garanti. Effort moyen après une identité de version fiable. Le modèle actuel ne fournit pas moteur/transmission/carburant/identifiant RNCan suffisants. | D'abord prouver un appariement exact, sinon aucun chiffre. Comparer `(L/100 km A − B) × km/an × CAD/L ÷ 100` avec hypothèses explicites ; entretien, financement, taxes et assurance restent séparés. |
| Consolidation des dialogues projet — différée | Cohérence mobile/focus utile mais moins urgente que la chaîne de preuves. Les projets utilisent des dialogues propres, Notifications/Aujourd'hui utilisent Sheet. | Revue commune après #312 ; aucune refonte générale ni PR de quota. |

Alternative minimale aux avis : conserver l'historique dans chaque fiche. Elle reste fonctionnelle, mais demande une recherche manuelle par annonce et ne rejoint pas le centre existant. Les nouvelles cartes n'ajoutent ni tableau de bord ni réglage. Détails/provenance restent repliés. Aucun graphique n'améliore ici la lecture par rapport à « ancien prix → nouveau prix » ; aucune jauge de score artificielle.

## Comparables et sources officielles

Sources publiques consultées le **23 novembre 2026**, sans compte ni données de Kevin :

- [AutoTrader, fiche officielle Trader Corporation](https://play.google.com/store/apps/details?hl=en-CA&id=ca.autotrader.userapp) : favoris, recherches enregistrées et avis de prix ; mise à jour annoncée le 12 novembre 2026. Référence fonctionnelle, pas preuve de qualité mécanique ou de prix juste.
- [REALTOR.ca, recherches sauvegardées](https://www.realtor.ca/my-saved-searches) : critères/favoris et notifications de nouvelles annonces. Ne prouve ni prix vendu ni frais/état/strata du bien. FamilyHub conserve donc les inconnues et ne copie pas un score propriétaire.
- [RNCan, outil de consommation](https://fcr-ccc.nrcan-rncan.gc.ca/en/Search) : année/modèle mais aussi transmission, carburant, cylindres et hypothèses kilométrage/prix. Une correspondance de nom commercial seule est insuffisante. L'outil public a été lu ; aucun jeu de données complet n'a été téléchargé.
- [RNCan, interprétation des cotes](https://natural-resources.canada.ca/energy-efficiency/transportation-energy-efficiency/understanding-fuel-consumption-ratings) : repères de comparaison, consommation réelle variable.
- [BCFSA, Form B Information Certificate](https://www.bcfsa.ca/industry-resources/real-estate-professional-resources/knowledge-base/practice-resources/form-b-information-certificate) : documents/état et coûts de strata à vérifier, pas de revenu locatif présumé.
- [W3C WCAG 2.2, taille des cibles](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) : cible minimale ou espacement, complétée ici par contrôle de focus, noms accessibles et absence de dépendance à la couleur. Référence maintenue publique ; les skills locales guident la revue, sans ajouter de code tiers.

Les avis peuvent aider à réexaminer un achat et éviter un prix affiché devenu obsolète. Ils ne prouvent ni économie réalisée ni occasion de revenu. Le repère RNCan est une piste économique concrète différée, pas une fonctionnalité livrée.

## Critique indépendante et corrections

La revue produit a demandé : identité visible sur la carte ; icône neutre pour hausses et baisses ; conservation du texte/dates d'un avis lu au retour d'un prix ; distinction ancien worker/aucun changement ; fuseau cohérent ; « À revérifier » plutôt qu'une validité commerciale inventée. Ces points sont intégrés. La limite reste explicite : toutes les différences de prix sont admises, aucun seuil d'intérêt personnel n'est inféré.

## Validation du candidat

Commandes exécutées réellement le 23 sur le candidat, sorties conservées avec les visuels :

| Commande | Résultat local |
|---|---|
| `npm run typecheck` | Réussi : web et worker |
| `VITE_MAIL_RETRIEVAL_MODE=plugin-only npm run build` (variable PowerShell équivalente) | Réussi : PWA + compilation worker, sans démarrage |
| `node --test tests/household-alerts.test.mjs tests/notifications.test.mjs tests/notification-lifecycle.test.mjs tests/opportunity-actions.test.mjs tests/notification-push.test.mjs tests/mortgage-notifications.test.mjs tests/project-notification-library.test.mjs tests/ci-browser-shard.test.mjs` | 63/63 |
| `node --import tsx --test tests/project-price-notices.test.ts` | 21/21 |
| `npm run test:pwa` | 162/162 : 5 métadonnées/thème + 150 produit + 7 transport/sécurité |
| `npm run test:proactive:browser` | Quatre suites réussies : visual-readiness, proactive (six largeurs), Auto et Immobilier |
| `node apps/web/tests/notifications-browser.mjs` | Réussi à 320/390/768/1440 px |
| `node apps/web/tests/project-notices-browser.mjs` | Réussi à 320/390/768/1440 px ; aucune requête externe, erreur navigateur, écriture source ou émission Push réelle |
| Même nouveau script avec `FAMILYHUB_PROJECT_NOTICE_BASELINE=1` et `FAMILYHUB_PROJECT_PREVIEW_DIR` vers l'archive construite du main | Avant à 390 px : zéro avis projet dans Notifications, historique visible dans les dossiers |
| `git diff --check` | Réussi |

Soit **246 tests de modèles/contrats/produit**, dont 26 nouveaux tests prix/bibliothèque, plus les suites navigateur listées. Aucun total historique du 21/22 n'est ajouté. Une première exécution navigateur a révélé une fixture avec version worker non numérique ; elle a été corrigée. Une assertion immédiate de focus a été remplacée par l'attente de l'état de focus réellement rendu après animation-frame, sans clic forcé. Les passes finales ci-dessus couvrent ces corrections.

[Visuels, résultats et provenance](reviews/committee-20261123/README.md) : captures d'implémentation fictive, pas maquettes Figma ni acceptation sur téléphone. Le manifeste rattache les captures aux empreintes de source et de build. Les captures intermédiaires ne sont pas les livrables. Les tests des cycles précédents ne sont pas comptés dans ce lot. Aucune installation de dépendance ou SDK supplémentaire ; node_modules existants réutilisés. .NET local indisponible : contrôle réservé à la CI automatique de la PR, si celle-ci est ouverte.

## Mise en service et décision

Voir [contrat détaillé](PROJECT-PRICE-NOTICES.md). La nouvelle catégorie reste dans l'app, avec projection compatible pour les anciens frontends. Une interface récente sur ancien worker explique la couverture manquante. Une fusion future déclencherait normalement Pages ; elle ne mettrait pas le worker installé à jour. Tout déploiement/installation est hors autorisation de ce cycle.

Go pour revue d'un brouillon sous réserve des contrôles exacts ; **no-go production** : aucun parcours naturel, worker installé, téléphone réel, lecteur d'écran ou disponibilité de sources réelles vérifié ici. `git merge-tree --write-tree HEAD 063b366a05d83520ffb78765196e8da8a4646b72` a effectivement révélé trois conflits de texte : REQUIREMENTS et les deux vues projet. Il n’a changé ni branche ni worktree. Ce brouillon est donc examinable seul mais **pas prêt pour une intégration combinée avec #312** ; résolution et tests du candidat combiné seront nécessaires sous une autorisation distincte. les autres PR ne sont pas implicitement approuvées. Décision attendue : examiner ce volet et autoriser séparément une éventuelle intégration/mise en service.
