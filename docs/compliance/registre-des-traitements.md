# Registre des activités de traitement

Article 30 du RGPD. Projet du 21 novembre 2026, à relire par un avocat.

**Responsable du traitement :** l'éditeur de BehyndMe, Saleh Dassoukhi, en France (identité complète à compléter :
voir le README). Contact : support@behyndme.com. Pas de délégué à la protection des données désigné.

**Personnes concernées, pour tous les traitements :** les utilisateurs de l'app, majeurs. Un utilisateur peut être
propriétaire d'enveloppes, destinataire ou validateur de celles des autres. Aucun utilisateur ne saisit les coordonnées
d'un tiers : on ajoute un proche qui a déjà son compte, en scannant son code ou par une invitation qu'il accepte.

**Mesures de sécurité communes :**
- chiffrement de bout en bout du contenu des enveloppes sur le téléphone (voir `declaration-cryptologie.md`) ;
- clés gardées dans le trousseau du téléphone, Face ID ou code avant usage ;
- TLS pour tous les échanges ;
- base Supabase fermée au client (RLS : la clé publique est refusée) ;
- un rôle Postgres par service ;
- journal chaîné de chaque enveloppe ;
- journaux du serveur sans adresse IP ni agent utilisateur ;
- sauvegardes de 7 jours ;
- e-mails sans lien.

## 1. Comptes et connexion

- **Finalité :** créer le compte, se connecter, protéger la session (code par e-mail sur un nouvel appareil, nouvelle
  vérification avant les actions sensibles).
- **Base légale :** exécution du contrat (art. 6.1.b).
- **Données :**
  - nom, adresse e-mail vérifiée, photo et téléphone facultatifs ;
  - identifiants de connexion et sessions ;
  - chez Clerk : adresses IP de connexion.
- **Destinataires :** Clerk (sous-traitant, États-Unis).
- **Conservation :** tant que le compte existe ; Clerk efface le compte de connexion à la suppression.

## 2. Proches, invitations et codes de contact

- **Finalité :** relier deux utilisateurs qui se connaissent, vérifier leurs clés en face à face.
- **Base légale :** exécution du contrat.
- **Données :**
  - liens de confiance ;
  - invitations : jeton haché, dates, statut ;
  - codes de contact, valables 10 minutes.
- **Destinataires :** aucun hors des services de BehyndMe. Les coordonnées ne sont visibles que des personnes ajoutées
  à ses proches.
- **Conservation :**
  - les liens : tant que le compte existe ;
  - les invitations : 30 jours après leur expiration (elles sont valables 7 jours) ;
  - les codes de contact : effacés une fois expirés.

## 3. Enveloppes

- **Finalité :** garder une enveloppe scellée et la transmettre selon les règles fixées par son propriétaire.
- **Base légale :**
  - exécution du contrat avec le propriétaire ;
  - pour les validateurs et le destinataire désignés, intérêt légitime du propriétaire et de la personne désignée à ce
    que le rôle fonctionne et soit connu (art. 6.1.f). La personne désignée est prévenue (notification et e-mail) et
    peut refuser son rôle.
- **Données :**
  - en clair :
    - qui participe ;
    - la catégorie, la description, le délai ;
    - les dates, demandes et décisions ;
    - le journal chaîné ;
  - chiffrées et illisibles pour BehyndMe :
    - le secret ;
    - la clé de l'enveloppe chiffrée pour le propriétaire ;
    - une part par validateur.
- **Destinataires :** les participants de l'enveloppe, selon leur rôle. Le secret ne s'ouvre que pour le propriétaire,
  et pour le destinataire après une transmission validée.
- **Conservation :** tant que le compte du propriétaire existe.
  - Une enveloppe transmise reste à son destinataire.
  - À la suppression d'un compte, ses brouillons sont effacés. Ses enveloppes scellées sont révoquées, et leur secret et
    leur description effacés. Il reste un identifiant technique dans les enveloppes des autres.
- **Point d'attention :** une demande de transmission laisse supposer que le propriétaire ne peut plus agir, par décès ou
  incapacité. Pour une personne vivante, c'est une donnée de santé (art. 9). Voir `aipd.md`.

## 4. Soin et récupération des clés

- **Finalité :** que chacun garde ses clés.
  - Une preuve hebdomadaire que le téléphone les a toujours.
  - Des vérifications de la phrase de secours.
  - Le type d'endroit où la phrase est rangée, jamais la phrase.
  - La sauvegarde par clé d'accès et le transfert vers un nouveau téléphone.
- **Base légale :** exécution du contrat.
- **Données :**
  - clés publiques ;
  - dates de preuve et de vérification ;
  - type d'endroit ;
  - boîte chiffrée de la sauvegarde par clé d'accès (illisible pour BehyndMe) ;
  - transferts chiffrés, valables 5 minutes.
- **Destinataires :** le propriétaire d'une enveloppe voit si ses validateurs ont sauvegardé leurs clés et s'ils les ont
  confirmées dans l'année.
- **Conservation :**
  - tant que le compte existe ;
  - les transferts sont effacés une fois expirés.

## 5. Notifications et e-mails

- **Finalité :** prévenir l'utilisateur de ce qui le concerne : demande de transmission, désignation, clés, proches.
- **Base légale :** exécution du contrat. Les e-mails non critiques se coupent dans Réglages, les critiques non.
- **Données :**
  - notifications : texte, type, lien interne à l'app ;
  - jeton de notification de l'appareil ;
  - langue et fuseau horaire du téléphone ;
  - trace des envois : adresse et texte.
- **Destinataires :** Expo, puis Apple ou Google, pour les notifications ; Resend pour les e-mails. Tous sont des
  sous-traitants aux États-Unis.
- **Conservation :**
  - notifications : 90 jours après leur lecture ;
  - trace des envois : 30 jours ;
  - jeton de notification : retiré à la déconnexion, et quand un changement de mot de passe fait sur un autre appareil
    le déconnecte ;
  - messages techniques entre services : 7 jours.

## 6. Support

- **Finalité :** répondre aux demandes écrites à support@behyndme.com.
- **Base légale :** intérêt légitime à aider l'utilisateur (art. 6.1.f).
- **Données :** les messages et l'adresse de l'expéditeur.
- **Destinataires :** OVHcloud (boîte mail, France).
- **Conservation :** 3 ans après le dernier échange.

## 7. Demandes des héritiers et directives après le décès

- **Finalité :**
  - appliquer les directives d'un utilisateur sur ses données après son décès ;
  - traiter les demandes de ses héritiers (art. 85 de la loi Informatique et Libertés) : fermeture du compte, mise à jour.
- **Base légale :** obligation légale (art. 6.1.c).
- **Données :**
  - l'acte de décès, les justificatifs de la qualité d'héritier (acte de notoriété, ou attestation de tous les
    héritiers) ;
  - les échanges.
- **Destinataires :** aucun.
- **Conservation :** les justificatifs, 3 ans après le dernier échange, comme le support (à confirmer par l'avocat).
- **Procédure :** `demandes-heritiers.md`.

## 8. Sécurité du service

- **Finalité :** limiter les abus, vérifier les clés et l'intégrité des journaux, diagnostiquer les erreurs.
- **Base légale :** intérêt légitime (art. 6.1.f).
- **Données :** les requêtes reçues et leur résultat, sans adresse IP, sans agent utilisateur, sans contenu
  d'enveloppe.
- **Conservation :** la durée des journaux de l'hébergeur (à fixer au déploiement).

## 9. Site behyndme.com

- **Finalité :** présenter l'app, publier l'aide, la politique de confidentialité et les liens d'invitation.
- **Base légale :** intérêt légitime.
- **Données :** l'adresse IP des visiteurs, vue par l'hébergeur. Ni cookie, ni mesure d'audience, ni traceur.
- **Destinataires :** Vercel (sous-traitant, États-Unis).

## Transferts hors de l'Union européenne

Clerk, Expo, Resend, Vercel, Apple et Google sont établis aux États-Unis. Les transferts reposent sur la décision
d'adéquation (Data Privacy Framework) pour les entreprises certifiées, sinon sur les clauses contractuelles types. Voir
`sous-traitants.md`.
