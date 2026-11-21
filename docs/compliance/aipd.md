# Analyse d'impact relative à la protection des données (AIPD)

Article 35 du RGPD. Projet du 21 novembre 2026, avant la bêta. À relire par un avocat, puis à revoir à chaque changement
qui touche ce qui est gardé, qui le voit, ou les règles de transmission.

## 1. Le traitement

BehyndMe permet de préparer la transmission de ses accès numériques (codes, identifiants, consignes) à une personne de
confiance, pour le jour où l'on ne peut plus agir soi-même, par décès ou incapacité.

Le propriétaire scelle une enveloppe sur son téléphone, pour un destinataire et 1 à 3 validateurs. Quand le destinataire
ou un validateur demande la transmission :
- le propriétaire est prévenu aussitôt et peut annuler pendant un délai qu'il a fixé (3 à 30 jours) ;
- l'enveloppe n'est transmise que si assez de validateurs approuvent (majorité) et que le délai est passé.

Aucun acte de décès n'est demandé.

**Pourquoi une AIPD :**
- des données très sensibles, mais chiffrées de bout en bout (des accès à des comptes, parfois financiers) ;
- un traitement qui peut révéler un décès ou une incapacité, donc l'état de santé ;
- des droits de tiers et d'héritiers en jeu ;
- un usage qui peut durer des décennies.

**Le détail de ce qui est gardé, combien de temps et par qui :** voir `registre-des-traitements.md`.

## 2. Nécessité et proportionnalité

- **Minimisation.**
  - Le serveur ne peut pas lire le contenu des enveloppes.
  - Le nom et l'e-mail sont les seules données obligatoires.
  - Pas de carnet d'adresses, de position, de mesure d'audience, de traceur ni de publicité.
  - Pas d'adresse IP dans les journaux du serveur.
  - Personne ne saisit les coordonnées d'un tiers : on ajoute un proche qui a son propre compte.
- **Durées.** Elles sont fixées par des tâches de rétention : notifications, traces d'envoi, invitations, messages
  techniques, sauvegardes. Les comptes inactifs ne sont pas supprimés, car une enveloppe doit pouvoir être transmise des
  années après.
- **Information.** La politique de confidentialité, complète et datée, est sur behyndme.com, et sa version courte dans
  l'app. Les personnes désignées dans une enveloppe sont prévenues de leur rôle, et peuvent le refuser dans l'app.
- **Droits.**
  - Accès, rectification et suppression du compte depuis l'app ; le reste par e-mail, avec réponse sous un mois.
  - Les directives après le décès et les droits des héritiers sont décrits (art. 85).
  - Opposition (art. 21) : une personne désignée refuse son rôle dans l'app, à tout moment avant la transmission.
- **Sous-traitants et transferts.** Voir `sous-traitants.md`.

## 3. Risques et mesures

Échelle : faible, modérée, importante. « Après » tient compte des mesures déjà en place.

| Risque | Gravité | Vraisemblance après mesures |
| --- | --- | --- |
| R1. Accès illégitime au contenu d'une enveloppe | Importante | Faible |
| R2. Transmission non voulue | Importante | Modérée |
| R3. Perte définitive d'une enveloppe | Modérée | Modérée |
| R4. Révélation d'un décès, d'une incapacité ou des liens entre personnes | Importante | Modérée |
| R5. Prise de contrôle d'un compte | Modérée | Faible |
| R6. Mauvais usage par le destinataire | Importante | Modérée |
| R7. Conflit avec les héritiers | Modérée | Modérée |
| R8. Violation chez un sous-traitant | Modérée | Faible |

**R1. Accès au contenu (fuite du serveur, hébergeur, autorité, personne interne).**
- Le contenu est chiffré sur le téléphone : X-Wing (post-quantique hybride), AES-256-GCM.
- Le serveur ne garde que des chiffrés, et des parts de clé chiffrées pour chaque validateur.
- Les clés restent dans le trousseau du téléphone, protégées par Face ID ou le code.
- Les manifestes sont signés et vérifiés par les téléphones.
- À venir : un audit indépendant du protocole avant la sortie publique.

**R2. Transmission non voulue (fausse demande, entente entre destinataire et validateurs, propriétaire injoignable).**
- Le propriétaire est alerté aussitôt, par notification et par un e-mail critique, et une dernière fois un jour avant la
  fin du délai.
- Il annule d'un geste.
- Il faut la majorité des validateurs, et le destinataire ne peut pas être validateur.
- Une demande non aboutie expire en 60 jours. Après une annulation, son auteur attend 72 heures avant de redemander.
- À venir :
  - délai par défaut porté à 15 jours ;
  - une catégorie « Banque et cryptomonnaies » plus stricte : 15 à 30 jours, 3 validateurs, après un décès seulement.

**R3. Perte définitive (clés perdues par le propriétaire, un validateur ou le destinataire).**
- Phrase de secours, sauvegarde par clé d'accès, transfert vers un nouveau téléphone.
- Vérifications périodiques de la phrase et preuve hebdomadaire des clés.
- Le propriétaire voit l'état des clés de ses validateurs et peut sceller à nouveau.
- Jamais l'unanimité des validateurs : un seul validateur qui perd ses clés rendrait l'enveloppe inouvrable.

**R4. Révélation (participants, catégorie, description ; une demande laisse supposer un décès ou une incapacité).**
- Visible seulement des participants de l'enveloppe.
- La description est signalée comme lisible, à ne rien y mettre de secret.
- Les notifications et e-mails ne contiennent ni secret ni description.
- Une demande « parce qu'il ne peut plus agir » révèle l'état de santé d'une personne vivante (art. 9). À venir : au
  scellement, un consentement explicite du propriétaire pour les enveloppes ouvrables dans ce cas ; sans lui,
  transmission après un décès seulement.

**R5. Prise de contrôle d'un compte (mot de passe ou session volés).**
- Un nouvel appareil doit confirmer un code par e-mail.
- Une nouvelle vérification Clerk est exigée pour réinitialiser les clés, ouvrir un transfert ou retirer la sauvegarde
  par clé d'accès.
- Des e-mails de sécurité sont envoyés.
- Un changement de mot de passe déconnecte les autres appareils et coupe leurs notifications.
- Le contenu reste fermé sans les clés du téléphone.
- Pas encore de double authentification TOTP : en attendant, le chiffrement de bout en bout et les clés liées au
  téléphone limitent l'impact.

**R6. Mauvais usage par le destinataire (s'approprier des biens, dépasser la mission, lire les échanges de tiers).**
- Au scellement, le propriétaire écrit ce qu'il attend pour chaque accès.
- Avant d'ouvrir, le destinataire accepte un avertissement : aucun droit sur les biens, rien au-delà de ce qui est
  demandé, pas les échanges d'autres personnes, cesser si les héritiers s'y opposent.
- Les e-mails de désignation et l'aide le disent aussi.
- L'aide recommande d'abord les outils des plateformes (Apple, Google, Meta).
- BehyndMe ne peut pas contrôler l'usage une fois l'enveloppe ouverte.

**R7. Conflit avec les héritiers.**
- Leur demande de fermeture révoque aujourd'hui les enveloppes pas encore transmises, et l'aide le dit.
- Question ouverte pour l'avocat : une enveloppe vaut-elle directive particulière (art. 85, I), qui passerait avant leur
  demande ? Elle suppose un consentement spécifique au scellement. Procédure : `demandes-heritiers.md`.

**R8. Violation chez un sous-traitant (Clerk, Expo, Resend, Vercel).**
- Chacun ne reçoit que ce qu'il lui faut ; les e-mails n'ont ni secret, ni description, ni lien.
- DPA à accepter.
- Procédure de violation : `violation-de-donnees.md`.

## 4. Mineurs

Le service est réservé aux majeurs (politique de confidentialité). À venir : la case « J'ai 18 ans ou plus » à
l'acceptation des conditions.

## 5. Conclusion provisoire

Les risques résiduels paraissent acceptables avec les mesures en place, à trois conditions :
- les mesures à venir de ce document sont faites avant la sortie publique (consentement « santé », règles plus strictes
  pour les finances, double authentification à terme) ;
- l'avocat valide la position sur les héritiers ;
- l'audit indépendant du protocole a lieu.

Si un risque important restait sans mesure suffisante, la CNIL serait consultée avant la mise en œuvre (art. 36).
