# Conformité : documents internes

Documents de travail pour l'éditeur et pour l'avocat qui les relira. Ils décrivent ce que fait le code des deux dépôts
(`behandme`, `behindMe`). La politique de confidentialité publiée sur behyndme.com en est la version pour le public,
écrite par `behindMe/scripts/site-pages.js`. Si le code change ce qui est gardé, combien de temps ou par qui, ces
documents changent dans le même commit, comme la politique.

| Document | Rôle | État |
| --- | --- | --- |
| [registre-des-traitements.md](registre-des-traitements.md) | Registre des activités de traitement (art. 30 du RGPD) | Projet, à relire |
| [aipd.md](aipd.md) | Analyse d'impact relative à la protection des données (art. 35 du RGPD) | Projet, à relire |
| [sous-traitants.md](sous-traitants.md) | Sous-traitants, contrats (DPA) et transferts hors de l'Union | DPA à accepter |
| [violation-de-donnees.md](violation-de-donnees.md) | Que faire en cas de violation de données (art. 33 et 34) | Prête |
| [demandes-heritiers.md](demandes-heritiers.md) | Traiter une demande d'héritiers ou de fermeture d'un compte (art. 85 de la loi Informatique et Libertés) | Prête |
| [declaration-cryptologie.md](declaration-cryptologie.md) | Dossier technique de la déclaration à l'ANSSI (art. 30 de la LCEN) | À déposer |

## Ce qui reste à l'éditeur

1. **Identité de l'éditeur.** La forme juridique, l'adresse (ou une domiciliation), le téléphone et le SIRET ou RCS.
   Ils manquent aux mentions légales, aux conditions d'utilisation, à la déclaration à l'ANSSI, et au statut de
   professionnel au sens du DSA qu'Apple demande pour distribuer dans l'Union européenne.
2. **La déclaration à l'ANSSI**, à déposer avant de distribuer l'app en France. Elle prend effet un mois après son dépôt.
3. **Les DPA** de chaque sous-traitant, à accepter ou signer dans leur console (liste dans `sous-traitants.md`).
4. **Un médiateur de la consommation**, si l'éditeur est un professionnel qui s'adresse à des particuliers.
5. **La relecture par un avocat** de ces documents, des conditions d'utilisation et de la politique de confidentialité.

Ces documents ne sont pas un avis juridique : ils ont été écrits à partir du code et de consultations juridiques
générées par un assistant d'IA (novembre 2026), dont certaines se contredisent.
