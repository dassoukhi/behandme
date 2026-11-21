# Sous-traitants, contrats et transferts

Article 28 du RGPD (contrat avec chaque sous-traitant) et chapitre V (transferts hors de l'Union). État au 21 novembre
2026 : aucun DPA n'a encore été accepté pour le compte de BehyndMe. C'est à faire avant d'ouvrir le service à des
personnes extérieures, bêta comprise.

| Prestataire | Rôle | Données reçues | Lieu | Transfert | DPA |
| --- | --- | --- | --- | --- | --- |
| Clerk | Connexion et sessions | Nom, e-mail, identifiants, sessions, IP de connexion | États-Unis | DPF, sinon clauses types | À accepter |
| Supabase | Base de données | Toutes les données du service (contenu des enveloppes chiffré) | Paris (UE) | Aucun | À accepter |
| OVHcloud | Serveur, boîte support@ et alertes@ | Requêtes du service, messages du support | France | Aucun | Inclus au contrat, à vérifier |
| Expo | Acheminement des notifications | Jeton de l'appareil, texte de la notification | États-Unis | DPF, sinon clauses types | À accepter |
| Apple, Google | Notifications (APNs, FCM) ; connexion avec leur compte, au choix de l'utilisateur | Jeton de l'appareil, texte de la notification | États-Unis | DPF, sinon clauses types | Conditions de leurs services |
| Resend | Envoi des e-mails | Adresse, nom, texte de l'e-mail | États-Unis | DPF, sinon clauses types | À accepter |
| Vercel | Hébergement de behyndme.com | Adresse IP des visiteurs | États-Unis | DPF, sinon clauses types | À accepter |

## Pour chaque prestataire

1. Accepter ou signer son DPA, en général dans la console ou sur la page juridique du prestataire, et en garder une
   copie datée dans le dossier de conformité (hors du dépôt).
2. Vérifier sa certification au Data Privacy Framework sur dataprivacyframework.gov ; sinon, s'assurer que le DPA
   inclut les clauses contractuelles types.
3. Noter ses propres sous-traitants (la liste est en général publiée) et la façon dont il prévient de leurs changements.
4. Vérifier qu'il ne réutilise pas les données pour son propre compte.

Un nouveau prestataire n'est ajouté qu'avec ces quatre points. La politique de confidentialité (« Nos prestataires »,
`behindMe/scripts/site-pages.js`) et le registre changent dans le même commit.
