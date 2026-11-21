# Violation de données : que faire

Articles 33 et 34 du RGPD. Une violation est toute perte, altération, divulgation ou tout accès non autorisé à des
données personnelles, accidentel ou volontaire : fuite de la base, accès d'un tiers à un compte de prestataire, e-mail
envoyé à la mauvaise personne, sauvegarde perdue…

## Dans l'heure

1. **Contenir.** Couper l'accès en cause : clé ou jeton révoqué, compte de prestataire verrouillé, déploiement retiré,
   règle de pare-feu.
2. **Garder les traces.** Journaux, captures, heure de découverte. Ne rien effacer.
3. **Noter dans le registre des violations** (ci-dessous) l'heure de découverte : le délai de 72 heures part de là.

## Sous 72 heures

4. **Évaluer.**
   - Quelles données ? Le contenu des enveloppes est chiffré de bout en bout : une fuite du serveur ne le révèle pas.
     Elle révèle en revanche les comptes, les liens entre proches, les participants, catégories et descriptions des
     enveloppes, et les demandes de transmission.
   - Combien de personnes, et quelles conséquences pour elles (usurpation, révélation d'un décès ou d'une incapacité,
     hameçonnage) ?
5. **Notifier la CNIL**, sur notifications.cnil.fr, sauf si la violation n'est pas susceptible d'engendrer un risque pour
   les personnes. Dans le doute, notifier. Si tout n'est pas encore connu, notifier quand même et compléter ensuite.
6. **Prévenir les personnes** sans délai si le risque est élevé (art. 34) :
   - ce qui s'est passé, ce qui est touché ;
   - ce que nous avons fait ;
   - ce qu'elles peuvent faire : changer de mot de passe, réinitialiser leurs clés, se méfier des messages qui
     demanderaient leur phrase ;
   - un contact.

   Par e-mail (sans lien, comme les autres) et dans l'app.

## Ensuite

7. Corriger la cause, puis vérifier.
8. Mettre à jour l'AIPD si la violation révèle un risque mal évalué.
9. Si un sous-traitant est en cause, exiger son rapport. Son DPA l'oblige à nous prévenir sans délai.

## Registre des violations

Toute violation y est notée, même sans notification : date de découverte, faits, données et personnes touchées,
conséquences, mesures prises, notification à la CNIL ou raison de ne pas notifier. Le tenir hors du dépôt, avec le
dossier de conformité.

## Contacts

- Responsable : l'éditeur (voir le README).
- CNIL : notifications.cnil.fr.
- Prestataires : leurs contacts sécurité, à noter dans le dossier de conformité avec leur DPA.
