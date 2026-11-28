# Preuves visuelles — paramètres, 25 novembre 2026

Captures de l'implémentation, données entièrement fictives, aucun worker réel. Largeur du viewport indiquée ; panneau recadré pour lecture mobile. Les noms de domaines `.invalid` sont des substituts interceptés et la clé affichée est un faux champ masqué.

## Avant : une réponse de A remplace B déjà enregistré

Base `3710eb1a29caecd06fa0d007277564a9f0915473`. [Résultat de reproduction à 320 et 390 px](baseline-race.json).

| 320 px | 390 px |
|---|---|
| ![Avant : A a remplacé B, 320 px](before-320.png) | ![Avant : A a remplacé B, 390 px](before-390.png) |

## Après : B reste enregistré, aucun faux succès

Même enchaînement Test A → Save B → réponse A, dans le candidat de cette PR. [40 scénarios et assertions](acceptance.json).

| 320 px | 390 px |
|---|---|
| ![Après : B conservé, 320 px](after-320.png) | ![Après : B conservé, 390 px](after-390.png) |

## Le résultat courant continue de fonctionner

| Succès courant, 390 px | Erreur courante, 390 px |
|---|---|
| ![Test courant réussi](normal-390.png) | ![Échec courant annoncé près du formulaire](error-390.png) |

État sans résultat : le panneau après Save ci-dessus n'affiche aucun résultat de test courant. Les cas d'édition non enregistrée, retour A → B → A et navigation sont dans le journal d'acceptation. Aucun test sur téléphone physique, lecteur d'écran ou réseau privé. Les copies de journaux sont synthétiques et identifient leurs commandes ; leur exécution locale est distincte de la CI distante liée dans la PR.
