# Comité FamilyHub — 25 novembre 2026

## Conclusion et périmètre

Une correction préventive bornée est retenue : empêcher un ancien test de connexion d'écraser un choix plus récent dans les paramètres. Le défaut est reproduit par l'interface, puis corrigé et testé avec des données fictives. Les fiches Auto/Immobilier et les avis de prix déjà en brouillon restent la priorité produit ; aucune nouvelle note ni collecte n'est ajoutée.

Exécution sur kevinpc, worktree isolé `review/committee-20261125`, base `3710eb1a29caecd06fa0d007277564a9f0915473`. AGENTS, REQUIREMENTS, README, architecture, travaux ouverts et instructions de gouvernance ont été consultés. Aucun autre cycle du 25 visible parmi agents, worktrees et activités GitHub contrôlés ; absence globale non démontrable sans accès à l'orchestrateur. Aucun autre comité lancé. Les audits et tests des jours précédents restent historiques.

Compétences appliquées : frontend-design, better-interface, better-accessibility et parcours Playwright existants. Revue produit/marché et critique du correctif confiées à **gpt-6-astra, effort xhigh**, selon la demande de Kevin. Ses avis ne constituent pas des exécutions indépendantes.

## Travaux existants contrôlés, sans modification

| Travail | HEAD exact | CI existante, relue le 25 | État |
|---|---|---|---|
| [#311](https://github.com/vdskevin009/familyhub/pull/311) Échéances | `5afb931985f6b16851bd398aa42d00b0b11d516b` | [44377698519](https://github.com/vdskevin009/familyhub/actions/runs/44377698519), succès | Brouillon |
| [#312](https://github.com/vdskevin009/familyhub/pull/312) Fiches projets | `063b366a05d83520ffb78765196e8da8a4646b72` | [44575744206](https://github.com/vdskevin009/familyhub/actions/runs/44575744206), succès | Brouillon ; fraîcheur proposée le 24 non autorisée |
| [#313](https://github.com/vdskevin009/familyhub/pull/313) Assistant et couverture | `6832b6b15609e9515fd2e8f82f8fbc89434bc089` | [45040696121](https://github.com/vdskevin009/familyhub/actions/runs/45040696121), succès | Brouillon |
| [#315](https://github.com/vdskevin009/familyhub/pull/315) Avis de prix suivis | `2405be14bf6e1f0959c07d13871b7a456cb4720d` | [45216967118](https://github.com/vdskevin009/familyhub/actions/runs/45216967118), succès | Brouillon |

[#304](https://github.com/vdskevin009/familyhub/pull/304), HEAD `25df13045985ac2fb470762cbc021030626564ae`, reste un chantier Finances distinct. #291/#292 restent abandonnées. Aucun de ces travaux n'a été repris ou modifié. Les CI ci-dessus n'ont pas été relancées pendant cette revue.

## Chaîne source → stockage → interface : portée des observations

| Parcours | Preuve autorisée et constat | Limite |
|---|---|---|
| Paramètres | Réponse `/health` fictive différée → configuration navigateur → champs/indicateur. Écrasement A après Save B observé, puis 40 scénarios corrigés. | Aucun réseau ou appareil réel connecté. |
| Aujourd'hui, Sources, Remboursements | Lecture des contrats de couverture et du contexte assistant ; états partiels et source retenue ne doivent pas devenir un zéro exhaustif. #313 couvre déjà le défaut ciblé ; #311 couvre les reports. | Pas de nouveau passage de collecte. Le constat contrôlé #309 (lectures assureurs sans nouvel élément, original mail retenu et état dégradé) est historique. |
| Finances et Comptes | Lecture seule du code : dates source/réception, couverture partielle, soldes manquants et révisions de décisions sont distincts. Ne pas confondre import de transactions et actualisation des soldes. | Aucun compte, fichier familial, import ou scénario financier réel consulté. #304 reste séparée. |
| Courses et Récurrents | Code de comparaison : provenance/date, unités et mode conditionnent la comparabilité ; poste non chiffrable ne doit pas afficher zéro. Référence commerciale distincte du montant observé. | Aucune donnée de panier ou facture réelle, aucun nouveau test de collecte. |
| Hypothèque | Lecture du modèle et des vues : taux de référence, offre et frais inconnus restent distincts. | Aucun devis, calcul personnalisé, contact ou taux promis. |
| Notifications | Lecture des contrats d'événements, identité et état lu/traité ; #315 porte les avis des annonces explicitement suivies. | Pas d'envoi, de Web Push réel ou de scheduler exécuté. |
| Auto/Immobilier | Lecture des cartes, preuves, inconnues et critères ; les parcours synthétiques communs sont vérifiés séparément dans la validation de la PR. #312 distingue adéquation et prix non évalué. | Le prix de marché, l'état réel et la disponibilité ne sont pas vérifiés. Aucun score économique crédible à inventer. |

L'inventaire mobile retrouve `Dialog`, cartes de projet, état vide, source datée et détails à la demande. Le correctif réutilise les contrôles existants et place l'erreur à proximité avec annonce accessible. Il n'ajoute aucun écran ni texte permanent. Les incohérences de langue et la densité du panneau restent visibles, mais une refonte globale sans mesure d'usage n'est pas retenue. Pas de graphique utile pour représenter l'invalidation d'une réponse.

## Priorités et comparaison minimale

| Proposition | Impact / fréquence / effort | Première étape et critère vérifiable |
|---|---|---|
| **Retenue : préserver le choix de connexion** | Prévenir une configuration silencieusement rétablie ; fréquence réelle inconnue ; faible effort web. | Test A lent → Save B → réponse A : B reste enregistré, aucun faux succès. Tests et avant/après liés ci-dessous. |
| **Priorité produit existante : finaliser la décision sur #312/#315** | Moins d'annonces à relire, tri plus explicable ; fréquence d'usage inconnue ; effort de validation modéré. | Décider du traitement de fraîcheur de #312, puis valider ensemble les brouillons : fait daté, inconnu explicite, changement matériel d'annonce suivie, aucun doublon. Pas de nouvelle PR équivalente. |
| **Piste économique à valider : coût d'usage auto conditionnel** | Comparer le carburant entre véhicules réellement identifiés ; pas de gain chiffré personnel ; effort de preuve supérieur au correctif du jour. | Sur deux versions fictives exactement identifiées, retrouver la ligne RNCan et ses unités ; version ambiguë = pas de montant. Valider les hypothèses km/an et prix avant toute estimation. Non implémenté. |

Auto : le prix demandé, l'adéquation aux critères, l'historique/état et le coût d'usage sont quatre questions différentes. Le minimum utile est une preuve datée et les points manquants, déjà prévus par #312. Le repère RNCan requiert notamment année, modèle, motorisation, transmission et carburant ; une simple appellation d'annonce ne suffit pas. Aucun calcul automatique ni extension du schéma sans décision distincte.

Immobilier : ne pas noter le prix avec seulement des annonces affichées et ne pas traiter une pièce récente comme forcément actuelle. Les coûts strata, réserves et pièces à vérifier sont utiles pour éviter une dépense mal anticipée, sans prétendre prédire une économie. Première étape future : un scénario fictif où une assemblée modifie les frais après la date du Form B doit rendre la preuve à reconfirmer. Cette piste ne reprend ni la maquette rejetée #292 ni le correctif de fraîcheur non décidé de #312.

## Comparables officiels consultés le 25 novembre

- [CARFAX Canada : estimation gratuite et fondée sur l'historique](https://support.carfax.ca/en/support/solutions/articles/17000132058-what-is-the-difference-between-free-valuation-and-history-based-value-) (mise à jour indiquée : 16 mars 2023). Le premier repère ne possède pas la même information qu'une estimation liée à l'historique du véhicule. FamilyHub ne doit pas présenter les critères du projet comme un jugement de prix.
- [RNCan : recherche de consommation](https://fcr-ccc.nrcan-rncan.gc.ca/en/Search) (modifiée le 19 mars 2026). Le comparateur propose des critères techniques et des hypothèses personnalisées de coût annuel. Limite pour FamilyHub : identité technique insuffisamment vérifiée ; aucun résultat personnalisé consulté.
- [BCFSA : Form B Information Certificate](https://www.bcfsa.ca/industry-resources/real-estate-professional-resources/knowledge-base/practice-resources/form-b-information-certificate) (publié le 27 mars 2023). Frais, réserves et annexes apportent du contexte ; une modification postérieure peut rendre une pièce récente obsolète. Application proposée : provenance par fait et inconnues explicites, pas de conseil juridique ni de demande de document réelle.

## Livraison, validation et limites

[Correctif, alternatives et tests](SETTINGS-CONNECTION-RESULTS.md) · [Captures avant/après, états normal/erreur et résultats fictifs](reviews/committee-20261125/README.md). Les captures représentent l'implémentation locale, pas une maquette ni la production. La PR donne son SHA distant et son run CI exact ; les résultats locaux ne sont pas les CI historiques des autres PR.

Aucune installation, fusion, publication, modification d'accès ou de collecte, aucun démarrage du worker, aucune donnée privée ou action financière. Téléphone physique, lecteur d'écran et intégrations réelles non vérifiés. Une CI verte ne démontre pas la préparation globale à la production ; #305 conserve les acceptations naturelles/téléphone ouvertes.

Le remplacement du corps de #305 a été refusé par le contrôle automatique, car il aurait republié un historique opérationnel hors périmètre. L'issue reste intacte ; cette livraison la référence sans recopier cet historique. Le seul résultat est remis à Jarvis pour sa synthèse, sans message direct à Kevin.
