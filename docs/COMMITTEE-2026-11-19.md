# Comité FamilyHub — 19 novembre 2026

> Continuation autorisée par Kevin après le bilan : implémentation des fiches dans la PR #312 existante, sans fusion/publication ni modification du worker. Le journal initial ci-dessous est conservé. La garde de fraîcheur est désormais appliquée exclusivement par le client web aux réponses existantes ; les fichiers worker et leurs tests restent identiques à main. Voir [préparation à l’intégration](PROJECT-CARDS-INTEGRATION.md) pour le périmètre final, les preuves et le chemin de publication.

## Décision proposée

Préparer uniquement un petit lot de **fiches de décision fondées sur les preuves déjà disponibles**, en PR brouillon. Distinguer adéquation au projet, connaissance du modèle/exemplaire et qualité économique du prix. Ne pas publier un moteur /100 ni activer de nouvelles notifications avec les données actuelles. Kevin décide séparément de la suite ; aucune fusion, installation ou production n'est autorisée par ce cycle.

Ce résultat est une implémentation locale avec données fictives, pas une maquette Figma, une acceptation sur téléphone physique ou une preuve d'économies. Les PR abandonnées #291/#292 ne sont ni reprises ni reformulées ; les brouillons #304/#311 restent inchangés.

## Base et chemin réellement exécutés

- Machine vérifiée : `kevinpc`. Identité du compte local omise du rapport public. Aucun sélecteur `environment_management` n'est exposé dans les outils de ce cycle.
- Nouveau worktree `review/project-opportunities-20261119`, isolé sous `familyhub-committee-20261118/output/playwright/committee-20261119-source`, depuis main `3710eb1a29caecd06fa0d007277564a9f0915473`. Le checkout et la branche du brouillon #311 sont conservés.
- GitHub : dépôt ID 1367578718, `vdskevin009/familyhub`, lecture/push effectifs ; aucune permission persistante modifiée. `PROJECT.yaml` absent ; routage FamilyHub confirmé par le manifeste de gouvernance, consulté pour contexte seulement.
- Lecture : AGENTS, REQUIREMENTS, README, architecture, contrats Auto/Immobilier, sources/types/API/vues/tests, PR et issues récentes #305/#309/#310/#311/#297/#298/#299. Aucun chantier concurrent identique ouvert trouvé.
- Node24.22.1, dépendances et Chromium déjà présents réutilisés. Aucun `npm install`, `npm ci`, téléchargement de navigateur ou installation locale. Le sandbox bloque DNS/loopback ; les commandes de recherche publique et tests locaux autorisées ont utilisé l'exécution approuvée. Aucun contournement d'authentification, ACL ou réglage de sécurité.
- Public `release.json` relu anonymement : HTTP200, main3710eb1, `plugin-only`, build18 novembre17:42:11Z. Cela prouve l'identité web actuelle, pas la santé du worker privé ni un passage naturel des collectes.

## Audit source → stockage → interface

| Étape | Preuve source | Ce qui est établi / limite |
| --- | --- | --- |
| Recherche externe | `scripts/{vehicle,property}-ingest.mjs` | Pont d'ingestion, pas collecteur autonome : JSON validé, prévisualisation sans requête, application appairée, conflits vérifiés avant écriture et relecture indépendante. Aucun collecteur, import réel ou automation consulté/modifié ici. |
| Contrat des faits | `apps/worker/src/{vehicle,property}-model.ts` | Valeur, URL HTTPS, date consultée et note pour tout fait connu ; `null` explicite pour inconnu ; liste blanche. Une déclaration sourcée n'est pas une vérification indépendante. |
| Conservation | `apps/worker/src/{vehicle,property}-project.ts` | Observations immuables par ID ; même contenu rejoué idempotent, conflit si altéré ; dernier état selon observedAt. Absence différente de vendu. Choix de suivi séparés, historique/révision préservés. L'identité intersites ou une réinscription n'est pas garantie par ce seul stockage. |
| Frontière privée | `apps/worker/src/index.ts:301` | Les routes projet suivent les gardes Origin/appairage/no-store existantes. Vérifiées par worker temporaire synthétique401/403 et limites de corps ; aucune lecture du worker installé. |
| Lecture web | `apps/web/src/{vehicle,property}-api.ts` | Revalidation locale des faits et recalcul des projections ; inconnu jamais zéro ; aucune persistance de ces réponses dans localStorage. La comparaison immobilière doit correspondre aux seuls IDs choisis. |
| Décision | `views/{Vehicle,Property}ProjectView.tsx`, `ui/ProjectEvidence.tsx` | Cartes tri-état, motif concret, prix non évalué et date propre à l'annonce. Détail : doute/écart d'abord, puis preuves complètes à la demande, modèle et exemplaire séparés. Suivi/relecture et comparaison existants préservés. |
| Aujourd'hui / Notifications | `opportunities.ts:14`, `notification-model.ts:12`, `notification-library.ts:17` | Les contrats n'ont actuellement aucune source/cible Auto/Immobilier. Le cœur Suivre n'est pas une promesse de notification. Aucun branchement ni envoi ajouté. |

Les tests de stockage utilisent exclusivement de nouvelles bibliothèques temporaires, le navigateur de nouveaux contextes avec `synthetic-worker.invalid`. Aucune lecture de compte, mail, dossier ou état familial, aucun port du worker installé appelé. Les seuls POST du navigateur visent des routes interceptées fictives.

## Écarts reproduits et changements retenus

| Impact | Avant, preuve | Après et validation |
| --- | --- | --- |
| Élevé : information de disponibilité trompeuse | Observation immobilière19 novembre, statut actif sourcé1 octobre : `available=true`, `stale=false`. Auto contrôlait déjà l'âge du statut. | Même contrôle d'âge de statusEvidence dans le client web Immobilier ; seuil48 h, frontière exacte, inconnu et futur testés. Aucun fait source réécrit. |
| Élevé : mauvaises preuves comparées | La fonction compareProperties acceptait `[x,y]` ou `[a,a]` pour une demande `[a,b]`. Reproduction pure transport simulé, confirmée par critique indépendante. | Cardinalité, unicité et appartenance aux IDs sélectionnés requises ; réponses réordonnées valides acceptées. Tests unitaires et erreur navigateur sans faux résultat. |
| Moyen : doute et incompatibilité confondus | Deux cartes fictives3/4 identiques pour un critère absent et un faux, aux largeurs320/390/1440. | `À confirmer` / `Hors critères` / `Correspond au projet`, motif du premier écart/inconnu et quatre marques avec sens textuel. Il s'agit de critères, jamais de score économique. |
| Moyen : preuves utiles cachées | Immobilier omettait les notes/dates des critères et réservait les frais strata à la comparaison. Auto ne montrait pas marque/modèle dans les preuves structurées. Date maximale de liste utilisée malgré des annonces d'âges différents. | Notes et dates réelles, frais connus/inconnus, identité modèle/année/version distincte de l'offre, date par annonce ; suppression de la date agrégée. Prix affiché, prix vendu, état et coûts manquants restent distincts. |
| Élevé pour le clavier : fermeture sans retour au déclencheur | Test répété Escape après ouverture du dialogue immobilier : focus perdu. | Dialogue natif commun capturant le déclencheur, fermeture/Escape et restauration, verrouillage du défilement ; trois cycles par largeur et par projet. |
| Lisibilité | Contrastes déclarés insuffisants de certains textes secondaires et Airbnb. | Couleur existante plus sombre du même module ; paires rendues mesurées dans le navigateur. Aucun système de thème nouveau. |

Alternative minimale : changer seulement le libellé3/4. Elle réduit l'ambiguïté mais laisse les deux défauts d'intégrité et les preuves indisponibles à la lecture. Alternative plus lourde rejetée : nouveau dashboard, filtre/réglage de score, jauge de confiance, estimation monétaire ou nouvelle chaîne de notification.

## Critique et amélioration du parcours

Revue produit/UX/marché exécutée par `gpt-6-astra`, effort `xhigh`, conformément à la demande de Kevin. Une seconde critique a reproduit séparément fraîcheur et identité de comparaison. Ce sont des analyses de code et tests fictifs, pas deux preuves indépendantes d'usage réel.

La première version locale affichait tous les critères conformes avant l'inconnu. Les captures320 px ont montré que le motif du clic quittait le premier écran. Version corrigée : motifs non respectés/inconnus en premier ; `Tous les critères et sources` replié ; identité auto résumée puis sources à la demande. « Confirmés » remplacé par « respectés » ; le vendeur n'est pas certifié par FamilyHub. Aucun écran ni réglage ajouté.

Parcours final : Projets → fiche → motif concret et preuve → détails facultatifs → suivi/comparaison existants. Un état vide n'annonce plus implicitement une recherche quotidienne attestée. Une erreur initiale propose de vérifier le PC/réessayer ; une erreur d'actualisation conserve les faits et leurs dates. Un409 ou accusé incertain provoque une relecture, jamais le rejeu automatique d'un suivi. Les filtres et le retour navigateur restent fonctionnels.

## Marché officiel, consulté le 19 novembre 2026

Les fonctions ci-dessous sont déclarées par leurs fournisseurs ; leur précision n'est pas validée par ce comité. Aucune interface, notation propriétaire, annonce personnelle ou compte n'a été copié.

| Source officielle | Fonction / limite pertinente | Gain réel pour FamilyHub |
| --- | --- | --- |
| [AutoTrader Price iQ](https://www.autotrader.ca/editorial/price-iq/) | Spécifications, kilométrage et marché local ; accidents/sinistres notamment exclus. | Séparer prix comparatif et qualité de l'exemplaire ; aucun badge « bonne affaire » sur le seul budget. |
| [CarGurus IMV](https://partnercontent.cargurus.ca/about/contact-us) | Comparaison d'annonces actuelles/passées, modèle/version/année/km ; ni expertise officielle ni garantie. | Conserver fournisseur, périmètre et date si utilisé ultérieurement. Une annonce n'est pas une vente attestée. |
| [REW Property Insights](https://www.rew.ca/insights/faq) | Type, lieu, chambres, surface ; moyenne retenue si données insuffisantes. | L'abstention protège mieux qu'une pondération inventée ; quatre critères projet ne valorisent pas un bien. |
| [REALTOR.ca recherches sauvegardées](https://www.realtor.ca/my-saved-searches) | Notifications de nouvelles annonces correspondant à des critères sauvegardés. | Une correspondance peut être notifiée sans être qualifiée de bonne affaire. Aucune nécessité de score économique préalable. |
| [ICBC inspection d'occasion](https://www.icbc.com/vehicle-registration/buy-vehicle/buy-a-used-vehicle/inspecting-a-used-vehicle-for-sale) | Identité, historique et inspection sont des contrôles différents. | Version/modèle distincts de l'état de cette voiture ; inconnus explicites. |
| [BCFSA Form B](https://www.bcfsa.ca/industry-resources/real-estate-professional-resources/knowledge-base/practice-resources/form-b-information-certificate) | Frais, réserve, litiges et pièces strata ; âge récent ne garantit pas contenu actuel. Publié27mars2023, relu19 novembre2026. | Les frais d'annonce ne suffisent pas à évaluer les risques strata ou le coût complet. Aucun droit locatif déduit des entrées. |

## Priorités et utilité économique

| Proposition | Impact attendu, fréquence et effort | Critère d'acceptation |
| --- | --- | --- |
| Lot retenu : preuves lisibles et intégrité | Éviter une sélection fondée sur statut ancien/mauvaises identités ; décision plus courte. À chaque consultation de projet ; fréquence réelle et minutes gagnées inconnues. Effort modéré, contrats existants. | Distinguer sans ouvrir le détail écart/inconnu/prix non évalué ; voir le motif au premier écran ; chaque fait traçable ; aucun changement source/manual. |
| Phase suivante : changement factuel d'une annonce suivie | Réduire le risque de manquer une baisse ou changement de statut documenté ; aucun gain personnel garanti. Fréquence dépend du flux réel non inspecté. Effort moyen à important, nouvelle chaîne de preuves. | Identité stable, première lecture silencieuse, ancienne/nouvelle valeur et date/source, empreinte matérielle, dédup/restart, expiration, indisponibilité ne clôturant pas une alerte, lien exact et Push générique. Autorisation distincte avant activation. |
| Évaluation Auto | Potentiellement éviter un mauvais achat ; aucun montant estimable. Effort important. | Recherche modèle/génération/version séparée de comparables ajustés et de l'historique/inspection de l'exemplaire ; score absent si une dimension matérielle manque. |
| Évaluation Immobilier | Potentiellement éviter surpaiement/travaux/risques strata ; montant inconnu. Effort important. | Comparables vendus et affichés séparés ; dates, zone/type/surface/état, ajustements justifiés, frais et état strata. Pas de faux seuil minimal ni score/100 inventé. |

Le premier événement de notification proposé serait « baisse affichée documentée sur une annonce suivie », jamais « économie réalisée ». Une maquette conceptuelle peut l'illustrer, mais aucun événement de ce type n'est implémenté ou envoyé par ce lot. Pas de contact vendeur, courtier ou fournisseur ; aucun achat, offre ou action financière.

## Revue interface et validation

Périmètre : parcours Projets → Auto/Immobilier → preuves/comparaison, React19/TypeScript/Vite et styles du module existant. Guides frontend-design, better-interface, accessibility/layout/writing/typography/colors/ui et Playwright lus. Convention produit : AGENTS/REQUIREMENTS, README et architecture, tokens globaux et styles projet.

| Domaine | Couverture réellement inspectée | Limite |
| --- | --- | --- |
| Accessibilité | Noms des nouveaux contrôles, Enter/Escape, trois fermetures/restaurations, disclosures natifs, cibles44px et erreurs ; contexts navigateur propres. | Pas de lecteur d'écran ou téléphone physique. Pas de certification globale WCAG. |
| Layout |320/390/768/1440, motif au premier écran, aucune largeur de page/dialogue débordée dans les scénarios. | RTL et zoom navigateur200% non certifiés. |
| Rédaction | Doute/écart/prix distincts ; source déclarée, coûts inconnus, états vide/erreur. | Les autres écrans et anciens libellés ne sont pas relocalisés. |
| Typographie | Prix, titres, longues notes fictives et retours à la ligne observés. | Polices système/OS différents non certifiés. |
| Couleurs | Paires rendues des métadonnées, observations, photo absente, sous-titre et résumé mesurées ; sens redondant par texte/symboles. | Pas de nouveau thème ni test complet des images distantes. |
| UI | États normal, absent, périmé, vide, erreur, suivi/conflit, comparaison, navigation répétée ; critique visuelle puis simplification. | Animation/screenreader réels hors preuve. |

Résultats locaux acquis :38 tests Auto/Immobilier/preuves (17 + 18 + 3),162 PWA/produit/transport (5+150+7),5 contrats CI,35 notifications ; parcours Aujourd'hui/visual-readiness existants à six largeurs, projets existants390/1100 et nouveau parcours8 cas (deux projets × quatre largeurs). Les paires rendues inspectées vont de 4,899:1 à 5,298:1. Ces mesures ne certifient pas les autres surfaces.

Constats interface consolidés (reproductions de la base puis corrections du candidat) :

| Sévérité | Domaine | Emplacement | Avant | Après | Pourquoi |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibilité | Ancien dialogue dans `views/PropertyProjectView.tsx`, remplacé par `ui/ProjectEvidence.tsx:8` | Escape perd le contrôle déclencheur | Retour explicite au contrôle conservé | Reprendre le parcours au clavier. |
| HIGH | Couleurs | `property-project.css`, métadonnées et aide Airbnb | Paires déclarées sous 4,5:1 | Texte secondaire réutilisant #536d91 ; paires rendues mesurées | Lire les limites et dates en petit corps. |
| MEDIUM | Rédaction | `views/PropertyProjectView.tsx`, `views/VehicleProjectView.tsx`, cartes | Même 3/4 pour échec et inconnu | Tri-état avec motif | Ne pas sélectionner sur une équivalence trompeuse. |
| MEDIUM | Layout | `ui/ProjectEvidence.tsx`, détail390/320 | Preuves conformes avant le doute | Non-vrais d'abord, ensemble dépliable | Voir immédiatement pourquoi vérifier. |
| MEDIUM | Typographie/UI | Deux vues projet, détail | Long compteur dominant et preuves incomplètes | Résumé court, faits groupés, dates par annonce | Hiérarchie utile et même composant. |

Verdict sur les seuls états inspectés : **Approve**, sous les limites de couverture ci-dessus. Ce verdict n'autorise ni fusion ni production ; les gates réelles et la décision de Kevin restent séparées.

Commandes de validation : `npm run typecheck`, `npm run build` en plugin-only ; `npm run test:properties`, `npm run test:vehicles` ; `npm run test:proactive:browser` ; `npm run test:pwa` ; `node --test tests/ci-browser-shard.test.mjs`. Les suites de notifications source/lifecycle/événements existantes ont également été exécutées sur fixtures,35 tests réussis. Le résultat terminal, head distant et CI exacte sont consignés dans la PR brouillon/livraison de ce cycle, sans avancer l'acceptation production. .NET absent localement ; aucune installation autorisée. Les premiers essais sandbox ont échoué sur boucle locale, non sur les gardes applicatives ; les essais synthétiques approuvés les remplacent.

Captures d'implémentation, données fictives,390 px, pas téléphone réel :

- [Avant Immobilier](reviews/committee-20261119/before-property-390.png) / [Après](reviews/committee-20261119/after-property-390.png) / [Détail](reviews/committee-20261119/after-property-details-390.png).
- [Avant Auto](reviews/committee-20261119/before-vehicle-390.png) / [Après](reviews/committee-20261119/after-vehicle-390.png) / [Détail](reviews/committee-20261119/after-vehicle-details-390.png).
- [Erreur conservant les faits](reviews/committee-20261119/error-property-390.png) / [Liste vide](reviews/committee-20261119/empty-property-390.png).

## Production : preuves séparées et limites

Le lot ne modifie aucune permission, configuration, clé, pairing, stockage privé, collecte, cadence, worker installé ou production. Aucun import actif consulté, aucun compte privé lu. Aucun chantier Figma touché. Les anciennes notes contradictoires Auto/Immobilier sont conservées comme journal historique avec un avertissement en tête ; leur statut local ancien n'est pas présenté comme un constat19 novembre.

Les preuves publiques de #299 attestent une activation/intake contrôlée Auto antérieure et laissent l'automation/téléphone ouverts. La fusion #297 atteste la présence source immobilière ; ce cycle ne contrôle ni endpoint privé ni handoff réel. Le public main actuellement servi reste3710eb1.

Baseline #309/#310 relu : lectures assureurs contrôlées sans nouveaux éléments ni changement des dossiers existants ; mail dégradé avec un original calendrier retenu, autres messages pris en charge, couverture vérifiée non avancée à tort. Ce n'est ni un nouveau passage naturel ni une validation téléphone. #305/#309 restent en Testing pour ces limites ; aucune relance ou collecte exécutée ici.

Autres suites préventives à approfondir : changement de connexion immobilier (garde booléenne différente de la génération Auto, risque source non reproduit au navigateur ici), identité intersites/réinscriptions et vieillissement de chaque fait autre que le statut. Elles ne sont pas présentées corrigées. Avant toute future activation : vérification de ces frontières, du flux réellement autorisé, du commit exact et d'un téléphone, avec autorisation séparée.
