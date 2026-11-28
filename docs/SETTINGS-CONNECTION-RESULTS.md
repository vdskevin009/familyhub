# Résultats périmés du test de connexion

Statut : candidat web isolé du comité du 25 novembre 2026, FH-UX-002, suivi #305. Aucune fusion ni mise en service dans ce cycle.

## Problème observé

Sur `3710eb1a29caecd06fa0d007277564a9f0915473`, lancer **Test connection** pour A, modifier l'adresse et **Save** B, puis recevoir la réponse réussie de A rétablit A dans le formulaire et dans `familyhub.worker.v1`. Reproduction par les vrais contrôles à 320 et 390 px, sur une application statique locale et deux domaines `.invalid` entièrement interceptés. Aucun worker démarré, aucune configuration réelle utilisée.

## Changement minimal

Chaque test appartient à une génération de l'interaction. Modifier l'adresse ou la clé, enregistrer ou quitter l'écran invalide le résultat en attente. Les continuations de succès **et** d'échec vérifient cette génération avant toute écriture d'état ou de stockage. Un nouveau test reste possible. Un test courant réussi conserve son enregistrement automatique existant.

L'erreur du test courant est rendue près des contrôles avec `role="alert"`. Une réponse périmée ne remplace pas une erreur courante. Le nettoyage d'une erreur globale lors d'un nouveau Test ou Save reste le comportement existant : aucune garantie générale de conservation des erreurs d'autres fonctions n'est ajoutée.

Alternative minimale écartée : désactiver Save pendant le test bloque inutilement l'utilisateur et ne protège ni la sortie de l'écran ni l'édition de la clé. Comparer seulement les valeurs échoue pour A → B → A. Aucun changement de transport, authentification, permissions, schéma de stockage ou code du worker.

## Validation réellement exécutée le 25 novembre

- `npm run typecheck` : web et worker, succès.
- `npm run build` : compilation web et worker, sans exécution du worker.
- `npm run test:pwa` : 162 tests réussis (5 + 150 + 7).
- `node --test tests/ci-browser-shard.test.mjs` : 5 tests réussis.
- `node apps/web/tests/settings-connection-browser.mjs` : 40 scénarios réussis, 10 à chacune des largeurs 320/390/768/1440.
- `npm run test:proactive:browser` : les cinq scripts passent après la compilation finale : préparation visuelle et Aujourd'hui sur six largeurs, parcours Immobilier et Auto mobile/desktop, puis les 40 scénarios de paramètres. Les anciennes validations de #312/#315 n'ont pas été rejouées.

Scénarios : succès courant, échec courant, Save puis succès/échec tardif, édition sans Save puis succès/échec tardif, édition de clé seule, A → B → A, sortie puis retour, nouveau test B réussi avant l'échec tardif de A. Assertions sur stockage, champs, indicateurs, erreurs JavaScript, absence de débordement horizontal, absence de retry et de requête externe réelle. Les deux transitions clavier adresse → clé → Save sont exercées ; la clé demeure un champ masqué.

Le nouveau test rejoint `test:proactive:browser`, donc les shards CI existants. Le [registre local des commandes et empreintes](reviews/committee-20261125/local-validation.json) accompagne les captures ; le run distant exact est consigné dans la PR. Aucun workflow de publication déclenché manuellement ; un événement PR ne satisfait pas la condition de déploiement Pages.

## Preuves et limites

[Avant/après et résultats synthétiques](reviews/committee-20261125/README.md). Captures d'implémentation, pas maquettes ni acceptation sur téléphone réel. La revue critique Astra xhigh a lu code et tests, sans les exécuter : ce n'est pas une deuxième preuve expérimentale.

Fréquence réelle inconnue ; le risque est reproductible lorsque les actions précèdent une réponse lente. Pas de test de serveur privé, de lecteur d'écran ou de téléphone physique. Pas de migration, de modification de la connexion installée ni de collecte. Le SDK .NET n'est pas disponible localement ; sa vérification dépend de la CI exacte, à distinguer des tests locaux.
