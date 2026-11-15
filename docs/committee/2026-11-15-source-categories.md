# Une vue courte, puis la preuve

Proposition du comité FamilyHub du 15 novembre 2026. Refs #162; FH-FIN-030. **Branche de travail uniquement, sans fusion ni déploiement.**

## Décision à prendre

Retenir ou abandonner ce premier changement : dans **Finances → Dépenses → Source récente**, voir les catégories principales et ouvrir leurs opérations en un geste. Ce n'est pas le premier graphique de FamilyHub : les tendances mensuelles et le registre historique en disposent déjà.

## Pourquoi ce changement

La nouvelle vue source affichait un détail de catégories replié et une longue liste d'opérations. La lecture du code confirme le manque de lien entre catégorie et transactions, pas un problème supposé dans les données du foyer. Le prototype conserve les trois destinations Finances et remplace le détail textuel par une vue en barres. Le montant net passe avant ses deux composants; les explications de méthode restent consultables.

- Quatre catégories visibles, autres catégories sur demande.
- Même périmètre que le sous-total, avec montants et nombre d'opérations.
- Crédit net à gauche du zéro; dépense à droite. Pas de pourcentage trompeur quand le total est nul ou négatif.
- Sélection par clavier ou toucher, titre du détail focalisé, retour qui restitue le focus.
- Changer le mois, compte, devise ou filtre de lignes efface l'ancienne sélection.
- Aucun total personnel ni objectif inventé. Repérer un poste n'établit pas une économie réalisable.

## Comparaison du marché, vérifiée le 15 novembre

[Monarch Reports](https://help.monarch.com/hc/en-us/articles/21846787088916-Using-Reports) propose des ventilations classées et le passage du graphique aux opérations. **À reprendre : ce geste direct.** Pas son catalogue entier de visualisations.

[YNAB Spending Breakdown](https://support.ynab.com/en_us/spending-breakdown-H1H7YxmD0) relie répartition et détail. Les crédits nets demandent un traitement distinct. **À reprendre : une lecture honnête des signes**, pas un objectif de budget déduit de l'historique.

[Quicken Simplifi Watchlists](https://support.simplifi.quicken.com/en/articles/3472367-using-watchlists-on-the-web-app) cible une catégorie ou un commerçant. **À retenir pour la suite : un suivi choisi**, pas sa projection linéaire tant que notre couverture est partielle.

[Rocket Money récurrent](https://help.rocketmoney.com/en/articles/3117398-where-can-i-view-my-subscriptions-and-bills) regroupe abonnements et échéances. FamilyHub possède déjà Récurrent, comparaisons, alertes et Aujourd'hui : créer un second centre serait un doublon.

## Alternatives et prochains sujets

1. **Alternative minimale** : rendre le détail texte cliquable. Cela enlève un peu de friction mais laisse l'utilisateur comparer les montants mentalement. Les barres choisies conservent une seule vue, sans panneau ou réglage supplémentaire.
2. **Prochaine maquette : coût réel d'une offre sur douze mois**. Dans la comparaison existante, mettre côte à côte le contrat actuel et l'alternative frais compris, puis le coût après promotion. Éviter de confondre écart promotionnel mensuel et économie annuelle. Proposition distincte, non incluse dans le code de cette PR.
3. **À approfondir : pourquoi l'écart de dépenses ?** Réordonner les catégories existantes par contribution à la variation, avec delta explicite et même période de référence. Pas un nouvel écran; aucune baisse qualifiée d'économie réalisée. La référence doit rester indicative ou indisponible quand les preuves le sont.

## Captures

Les images sont des **captures de l'application compilée sur fixtures entièrement fictives**, pas des captures des finances du foyer ni des maquettes de données réelles. Voir `assets/source-categories-mobile.png`, `assets/source-categories-desktop.png` et `assets/source-category-detail-mobile.png`.

## Validation

TypeScript web et worker et build web exécutés localement. 128 tests produit (dont les 2 nouveaux tests d'agrégation) et 7 tests de classification/import source réussis. Suite navigateur synthétique aux largeurs 320/390/768/1440 : clavier, focus/retour répété, crédits, filtres, captures, erreur/absence/source ancienne et aucune écriture. La suite finale a été relancée après les derniers changements visuels et réussit aux quatre largeurs, y compris expansion des six catégories et crédit net à gauche du zéro. Les images sont recadrées sur le composant pour que la navigation fixe ne masque pas le contenu.

Le poste utilise Node 24 et pnpm pour la préparation locale faute de npm dans PATH; aucun fichier de dépendances généré n'est publié. La CI du commit publié doit confirmer les versions du lockfile, Node 22, suites complètes et .NET. Ni validation téléphone physique, ni déploiement, ni activation du worker n'est revendiqué.

## Confidentialité et périmètre

Frontend, projections de lecture et tests seulement. Aucun accès aux comptes bancaires, aucun envoi de données personnelles, achat, négociation ou annulation. L'historique, les décisions, les classifications et le collecteur restent inchangés.

## Corrections de revue indépendante

L’identifiant propre est FH-FIN-030; FH-FIN-028 reste réservé à la capture cloud. Quand la catégorie sélectionnée est masquée après réduction, le retour aux opérations restaure le focus sur le bouton de développement, sans réouvrir automatiquement. Le nombre d’opérations en attente reste visible à côté du sous-total, même avec Couverture repliée. Deux régressions navigateur couvrent ces cas.
