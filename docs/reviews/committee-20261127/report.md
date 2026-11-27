# Comité FamilyHub du 27 novembre 2026

Une omission de Récurrents est reproduite sur le main publié `5473245a572d4c617bf7aec1e9ba391a79737110`. Avec un forfait fictif mentionnant Netflix inclus et un abonnement Netflix autonome enregistré, le débit de 20 CAD est correctement rapproché mais la vérification du service inclus disparaît. Le total fictif reste 230 CAD. Le scénario est reproduit aux quatre largeurs 320, 390, 768 et 1440 px.

Le correctif candidat conserve cette observation quand un débit positif est affecté à son abonnement autonome. La fiche indique que le montant reste affecté au contrat, ouvre les deux contrats et expose la référence de l'opération. Les remboursements, exclusions manuelles, devises et ambiguïtés de rapprochement gardent leurs règles. Deux forfaits citant le même service produisent une seule observation.

[Avant, 320 px](included-before-320.png) · [Après, 320 px](included-after-320.png) · [Avant, 390 px](included-before-390.png) · [Après, 390 px](included-after-390.png). Captures d'implémentation avec données fictives. Le panneau après s'ouvre depuis le signal « éléments à vérifier » de Récurrents.

## Couverture et preuves

| Parcours | Vérification de ce cycle | Limite |
| --- | --- | --- |
| Aujourd'hui | Suite navigateur existante rejouée sur le main, six largeurs, sources partielles/absentes, lectures retardées, navigation exacte, décisions simulées et reprise après erreur de chargement | Le contexte assistant partiel reste le travail #313. Aucun modèle appelé |
| Sources et Remboursements | Tests source/PDF/état dans l'agrégat ciblé, provenance, erreur de lecture et secours mobile du téléchargement | Aucune source familiale ou collecte relue. #309 documente un passage contrôlé ancien avec un original retenu, acceptation naturelle/téléphone ouverte |
| Hypothèque | Moteur et sources simulées, puis parcours complet à 320/360/384/412/768 px, frais, soldes finaux, taux futurs exclus, rapport ancien, indicateur échoué, vide, erreur, clavier | Les seuils sont simulés en mémoire. Aucun prêteur, profil privé ou canal de collecte |
| Récurrents | Reproduction avant correctif à quatre largeurs, puis tests et parcours du candidat | Activation, dates d'effet, plan et facture personnelle à vérifier avant toute conclusion économique |
| Courses | Projection du total mensuel exercée dans l'agrégat ciblé, revue des contrats confirmation/livraison et des données écartées | #317 porte déjà le périmètre des sources écartées. Son échec local antérieur reste non expliqué par ce cycle |
| Finances/Comptes | Lecture des contrats d'archives, dates source, comptes et captures versionnées. Source, persistance et affichage sont distincts dans les contrats | Import et soldes ont leurs propriétaires. Les quatre liens sans CSV matérialisé rapportés par la coordination ne démontrent pas un défaut FamilyHub |
| Notifications | Revue du scanner, baseline silencieuse, identité de preuve, budget et état de livraison, suivi des PR #315/#319 | Aucun push réel ni nouvelle vérification sur appareil |
| Auto/Immobilier | Revue de la fiche et de sa comparaison, CI/main #318 déjà réussie et état distant vérifiés | Les six parcours du déploiement précédent sont historiques. Grille temporaire manuelle, données réelles et téléphone non revérifiés |

Exécution sur kevinpc dans le worktree isolé `output/playwright/committee-20261127-source`. `npm run typecheck` et `npm run build` ont réussi. L'agrégat ciblé sur le main a réussi **155 tests** répartis entre mortgage-decision, mortgage-daily, opportunities, opportunity-priority, source-pdf-viewer, invoice-state, mail-source-browser, grocery-monthly-spending, savings et savings-sharing. Les jeux se recouvrent avec les suites suivantes et leurs nombres ne doivent pas être additionnés.

Sur le candidat, `npm run test:savings` a réussi **41 tests** dont deux régressions ajoutées. `npm run test:savings:browser` a terminé avec succès ses quatre scripts : récurrents visuels à 320/390/768/1440 px, contrats et documents aux quatre largeurs, partage entre deux appareils simulés, référence d'assurance. Le parcours étendu `savings-visual-browser.mjs` vérifie les totaux, l'unique observation, ses sources, les filtres, la période, la navigation entre contrats et le retour du focus. Il a été rejoué avec succès après clarification des fixtures et ajout de leur contrôle d'immuabilité. La critique indépendante a aussi inspecté les captures finales 320 et 390 px, sans défaut visuel bloquant observé.

Commandes du balayage synthétique sur le main :

```sh
npm run typecheck
npm run build
node --import tsx --test tests/mortgage-decision.test.ts tests/mortgage-daily.test.ts tests/opportunities.test.ts tests/opportunity-priority.test.ts tests/source-pdf-viewer.test.ts tests/invoice-state.test.ts tests/mail-source-browser.test.ts tests/grocery-monthly-spending.test.ts tests/savings.test.ts tests/savings-sharing.test.ts
node --import tsx apps/web/tests/mortgage-assistant-browser.mjs
node apps/web/tests/proactive-browser.mjs
```

Commandes du candidat : `npm run typecheck`, `npm run build`, `npm run test:savings`, `npm run test:savings:browser`, puis `npm run build:web` après le libellé final et `node apps/web/tests/savings-visual-browser.mjs` après clarification des fixtures. Tous ont réussi. `dotnet run --project tests/Core.Tests -c Release` a été tenté mais n'a pas démarré : le SDK demandé `11.0.100-rc.1.26425.128` est absent sur kevinpc. Aucune installation effectuée ; le job .NET existant reste à vérifier en CI. Son résultat et celui de la CI du commit distant exact sont consignés dans la PR après terminaison.

La première reproduction navigateur avait une fixture sans date de mise à jour contractuelle, rejetée par le contrat de lecture. Après correction de la fixture et de sa révision, l'omission a été observée aux quatre largeurs. Ce premier échec n'établissait aucun défaut applicatif.

## Priorité retenue et comparaison minimale

**Impact conditionnel utile, fréquence réelle inconnue, effort faible à moyen.** Le foyer peut retrouver un débit à confronter à un service déjà inclus. Le résultat attendu est une vérification de contrat mieux ciblée. La décision possible dépend ensuite d'une facture, d'une date d'effet, du niveau de service, de l'activation et d'éventuels suppléments. Aucun montant personnel économisé n'est établi.

La solution minimale consistait à consulter manuellement les deux contrats. Le correctif réutilise la liste de vérifications et la provenance existantes pour éviter que l'enregistrement du contrat autonome supprime ce signal. Il conserve les montants comptés. Le critère d'acceptation est un débit affecté une fois, une observation unique et les deux contrats accessibles même lorsqu'un filtre masque l'un d'eux.

TELUS décrit le transfert/activation des services et les exceptions de facturation. Monarch propose une revue des récurrents et précise les limites de plusieurs abonnements auprès d'un même commerçant. Ces limites justifient ici la vérification des contrats et de leur identité. Sources officielles consultées le 27 novembre 2026. [TELUS Stream+](https://www.telus.com/en/support/article/learn-about-stream) · [Monarch, suivi des récurrents, mise à jour du 26 novembre](https://help.monarch.com/hc/en-us/articles/4890751141908-Tracking-Recurring-Expenses-and-Bills)

Pour l'Hypothèque, l'ACFC demande d'inclure pénalité, frais et éventuelle reprise de remise lors d'une rupture. Le moteur existant couvre ces postes et compare jusqu'à l'échéance actuelle. Un second calculateur apporterait peu à ce cycle. [ACFC, rupture d'un contrat](https://www.canada.ca/en/financial-consumer-agency/services/mortgages/break-mortgage-contract.html)

## Critique et décisions

La revue indépendante a été déléguée à GPT-6 Astra avec effort xhigh. Son hypothèse a ensuite été reproduite par le navigateur. Elle a identifié le piège d'une correction limitée au modèle, qui laisserait le libellé « exclus des totaux » faux, puis le cas du filtre Télécom. Le candidat traite ces interactions.

Les guides Frontend Design, Better Interface, Better Accessibility et leurs références locales ont été consultés. La revue des interfaces conserve les composants existants, privilégie les détails à la demande, vérifie les contrôles au clavier et le débordement étroit. La mesure exhaustive du contraste, les technologies d'assistance, le zoom système et le téléphone physique restent à vérifier. Une omission dans les noms accessibles de certains anciens boutons Récurrents/Hypothèque est une piste statique, sans preuve de perte en lecture continue et sans correctif ajouté ici.

#311, #312, #313, #315, #317 et #319 restent distinctes. #291 et #292 restent abandonnées. Le suivi de cette omission réutilise #163 et FH-SAV-008. La PR issue de ce cycle reste un brouillon soumis à la décision de Kevin.
