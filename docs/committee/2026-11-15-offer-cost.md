# Comparer ce qui sera réellement payé

**Proposition visuelle du 15 novembre 2026, non implémentée dans l'application.** Refs #163. Aucune fusion ni publication de l'application autorisée par cette PR. La maquette utilise uniquement des exemples fictifs; elle ne représente aucune offre de marché disponible.

## Décision proposée

Dans la fiche de comparaison déjà existante de Récurrent, remplacer la lecture de six chiffres au même niveau par deux coûts sur douze mois, l'écart estimé de première année, puis le coût après promotion. Conserver conditions, sources et choix existants. Aucun nouvel onglet, collecteur, moteur de calcul ou prestataire.

[Maquette HTML](offer-cost-mockup.html) · [Vue complète](assets/offer-cost-desktop.png) · [Vue mobile](assets/offer-cost-mobile.png)

## Constat vérifié dans le code

`SavingsOfferCard.tsx` place six valeurs tarifaires avant le résultat net. `SavingsView.tsx` met le prix mensuel public dans le résumé. Or `compareOffer` et `yearCost` dans `savings-model.ts` possèdent déjà les frais, promotions, rabais perdus et blocages de données manquantes. La proposition améliore leur lecture, sans inventer une nouvelle économie ni une nouvelle automatisation.

### Ce que montre la maquette

Exemple purement fictif, taxes incluses : contrat 80 CAD/mois, offre 50 CAD pendant 6 mois puis 70 CAD, frais 60 CAD, rabais perdus 0. Coût actuel 960 CAD/an. Alternative 720 + 60 = 780 CAD la première année; écart 180 CAD, pas 360 CAD. Après promotion, coût 840 CAD/an et écart 120 CAD/an.

Le second écran montre les mêmes prix avec frais inconnus. L'écart reste **non établi**, sans barre totale ni classement comme économie. Les boutons sont désactivés dans la maquette. Le statut « offre publique, éligibilité à confirmer » reste visible même pour le cas chiffrable.

## Recherche et différence utile

- [Monarch Reports](https://help.monarch.com/hc/en-us/articles/21846787088916-Using-Reports), consulté le 15 novembre : résumé graphique puis détail. Ici, les deux barres répondent à une décision précise, pas à un tableau de bord supplémentaire.
- [Rocket Money abonnements](https://www.rocketmoney.com/feature/manage-subscriptions), consulté le 15 novembre : centrer la revue sur des coûts récurrents. FamilyHub conserve la validation de l'utilisateur; aucune négociation ou annulation n'est incluse.
- [Quicken Watchlists](https://support.simplifi.quicken.com/en/articles/3472367-using-watchlists-on-the-web-app), consulté le 15 novembre : suivre une question ciblée plutôt qu'un budget complet. Aucune projection à partir d'une collecte partielle n'est proposée.

Il s'agit d'inspiration fonctionnelle à partir de documentation publique, pas d'un essai comparatif des applications authentifiées ni d'une recommandation d'abonnement. L'avantage attendu est de réduire les erreurs de lecture des promotions; aucun gain financier réalisé ni temps économisé n'a été mesuré.

## Alternative minimale

Remonter les résultats de première année et après promotion sans ajouter de graphique. Elle coûte moins d'interface et reste acceptable. La version à deux barres est proposée parce qu'elle montre la base de comparaison et le coût total simultanément. Ne pas ajouter jauges, scores, sliders, onglets ou objectifs.

## Contrat d'implémentation à valider

- Réutiliser `compareOffer`, ses refus et l'état de fraîcheur; aucune donnée manquante remplacée par zéro.
- Afficher frais et rabais perdus une seule fois, taxes/période/devise identiques.
- Cas hypothécaires : conserver la métrique d'intérêts dédiée; ne pas forcer cette maquette de coût d'abonnement sur un crédit.
- Couvrir offre plus chère, zéro écart, promotion du contrat actuel, frais inconnus, service différent, date expirée, devise incompatible, rabais partagés et fenêtre inférieure à douze mois.
- Retenir = préférence de comparaison seulement. Aucun contact, contrat, paiement, résiliation ou changement de fournisseur.
- Native mobile 320 à 412 px, clavier, contrastes et lecture des valeurs sans dépendre de la couleur. Contrôles existants conservés.

## Vérification et limites

L'arithmétique fictive a été vérifiée. Le HTML et ses captures ne chargent ni police, image, script ni donnée distante. Les captures représentent cette maquette seulement. Aucun code applicatif, API, schéma ou état privé n'est modifié; aucune preuve d'acceptation téléphone ou de déploiement n'est revendiquée. Validation du rendu 390/960 px, débordements 320/390/960 px et inspection visuelle avant publication.
