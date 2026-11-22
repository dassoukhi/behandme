# Demandes d'héritiers et fermeture d'un compte sur demande

Article 85 de la loi Informatique et Libertés (directives après le décès, droits des héritiers). Ce que dit l'aide
publique (behyndme.com/aide, « Un proche est décédé ou ne peut plus agir ») et ce que fait le support doivent rester
d'accord : changer l'un, c'est changer l'autre.

## Ce que BehyndMe peut et ne peut pas faire

- Fermer le compte d'une personne décédée, ou mettre ses données à jour, à la demande d'un héritier qui justifie de sa
  qualité.
- Appliquer les directives que la personne nous a laissées par écrit, de son vivant.
- Jamais donner le contenu d'une enveloppe. Il est chiffré pour les personnes que le propriétaire a choisies, et nous ne
  pouvons pas le lire. Nous ne disons pas non plus ce qu'elle contient.

## Procédure

1. **Recevoir la demande** à support@behyndme.com. Accuser réception, et répondre sous un mois.
2. **Vérifier les pièces.**
   - Une copie de l'acte de décès.
   - Un document qui établit la qualité d'héritier : un acte de notoriété ou une attestation du notaire chargé de la
     succession ; s'il n'y a pas de notaire, une attestation signée par tous les héritiers, avec le livret de famille.
   - Le nom et l'adresse e-mail du compte, qui doivent correspondre à la personne décédée.
   - Demander à l'héritier qui écrit de prévenir ses cohéritiers : l'article 85 parle « des héritiers », et la juriste
     consultée émet une réserve sur une demande faite par un seul d'entre eux. Si les héritiers ne sont pas d'accord
     entre eux, ne pas trancher : attendre leur accord ou une décision du tribunal judiciaire.
3. **Chercher des directives** de la personne dans les échanges du support. Si elle en a laissé, elles s'appliquent.
4. **Voir ce que la fermeture entraînerait**, sans rien changer :
   ```
   npm run account:close -- <id ou e-mail>
   # sur le serveur : docker compose exec gateway node dist/apps/gateway/apps/gateway/src/close-account.js <id ou e-mail>
   ```
   La commande dit combien d'enveloppes seraient révoquées ou effacées, s'il y a des transmissions en cours, ce qui a déjà
   été transmis, et dans combien d'enveloppes d'autres personnes le compte figure. Elle refuse une adresse partagée par
   plusieurs comptes : utiliser alors l'identifiant.
5. **Dire aux héritiers ce que cela entraîne.** Les enveloppes qui n'ont pas encore été transmises seraient révoquées,
   et personne ne pourrait plus les ouvrir. Leur conseiller de laisser d'abord se faire les transmissions prévues par la
   personne. Une enveloppe déjà transmise reste à son destinataire.
6. **Sur leur confirmation écrite,** fermer :
   ```
   npm run account:close -- <id> --confirm
   ```
   Ne jamais supprimer un utilisateur depuis le tableau de bord de Clerk : aucun webhook ne prévient le backend.
7. **Garder une trace** : la demande, les pièces, la réponse, la date de fermeture. 3 ans après le dernier échange, à
   confirmer par l'avocat.

## Cas particuliers

- **Demande du contenu d'une enveloppe :** refuser, pour les raisons ci-dessus. Indiquer que seul le destinataire choisi
  par la personne peut l'ouvrir, s'il en fait la demande dans l'app.
- **Personne vivante qui ne peut plus agir :** ses héritiers n'ont pas de droit sur son compte. Une demande d'un
  représentant légal (tuteur, mandataire de protection future) demande la décision du juge ou le mandat activé. Point à
  faire valider par l'avocat avant d'y répondre.
- **Doute sur l'authenticité d'une pièce :** ne rien fermer, demander une pièce complémentaire.

## Question ouverte (lot 6 du plan)

Une enveloppe vaut-elle directive particulière du défunt (art. 85, I), qui passerait avant la demande de fermeture des
héritiers ? Les réponses d'IA du 21 novembre se contredisaient. La juriste en droit numérique consultée le 22 novembre
estime que l'enveloppe « peut raisonnablement passer pour une directive adressée à BehyndMe sur la communication des
données » : elle s'imposerait alors aux héritiers, dont les droits ne s'exercent qu'en l'absence de directive.

Position retenue, à faire valider par un avocat (cabinets Cohen ou Romain Mirabile) avant tout changement :
- une option par enveloppe, avec un consentement spécifique au scellement (une directive particulière ne peut résulter
  des seules conditions d'utilisation) ;
- une conservation bornée, par exemple une révocation 2 ans après la fermeture si personne ne demande la transmission ;
- la suppression du compte par son propriétaire révoque toujours ses enveloppes.

En attendant, la procédure ci-dessus s'applique : la fermeture révoque les enveloppes pas encore transmises, et on le
dit avant de fermer.
