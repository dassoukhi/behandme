# Déclaration du moyen de cryptologie à l'ANSSI : dossier technique

L'article 30 de la LCEN (loi n° 2004-575) soumet à déclaration la fourniture d'un moyen de cryptologie qui assure la
confidentialité, sauf dispense prévue par le décret n° 2007-663. BehyndMe chiffre avec ses propres bibliothèques, et
non avec celles du système. Apple demande donc la déclaration française pour distribuer l'app en France (App Store
Connect, documents de conformité à l'export). Fournir le moyen sans déclaration expose à un an d'emprisonnement et
15 000 € d'amende.

**Démarche :**
1. Remplir la « Déclaration relative à un moyen de cryptologie » sur demarche.numerique.gouv.fr, au nom de l'éditeur
   (identité complète à compléter : voir le README).
2. Joindre :
   - ce dossier ;
   - `behindMe/docs/crypto-protocol.md` (la spécification complète, en anglais) ;
   - si demandé, les vecteurs de test (`behindMe/lib/crypto/vectors/`).
3. La déclaration prend effet un mois après son dépôt, si l'ANSSI ne demande rien de plus.
4. Verser l'accusé de l'ANSSI dans App Store Connect, aux documents de conformité à l'export pour la France.

**Statut « grand public » :** l'annexe II du décret 2007-663 (point 3) prévoit un classement soumis à trois conditions,
que l'ANSSI valide. Les vérifier avec l'ANSSI au moment du dépôt. Ce dossier ne présume pas qu'elles sont remplies.

## 1. Le produit

- **Nom :** BehyndMe, application mobile iOS (Android plus tard), gratuite, pour les particuliers.
- **Distribution :** App Store. Les serveurs sont en France (OVHcloud) et la base à Paris (Supabase).
- **Usage :** l'utilisateur écrit des accès (codes, identifiants, consignes) dans une « enveloppe ». Elle est chiffrée
  sur son téléphone, puis transmise à un destinataire qu'il a choisi, quand des validateurs l'approuvent et qu'un délai
  est passé.
- **L'utilisateur ne peut pas modifier les fonctions cryptographiques**, ni choisir les algorithmes ou les tailles de
  clé.

## 2. Fonctions cryptographiques

| Fonction | Ce qui est protégé |
| --- | --- |
| Confidentialité des données stockées | Le contenu des enveloppes, illisible pour le serveur (chiffrement de bout en bout). |
| Confidentialité des échanges entre téléphones | La clé d'une enveloppe chiffrée pour chaque participant ; le transfert des clés vers un nouveau téléphone. |
| Partage de secret | La clé de l'enveloppe, répartie entre 1 à 3 validateurs (seuil : la majorité). |
| Sauvegarde | La graine de l'utilisateur, chiffrée sous une clé d'accès (passkey, extension PRF de WebAuthn). |
| Intégrité et authentification | Les manifestes de scellement, les enregistrements de clés, le journal chaîné des enveloppes. |
| Transport | TLS, fourni par le système d'exploitation (iOS), sans implémentation propre. |

## 3. Algorithmes et tailles de clés

| Usage | Algorithme | Taille |
| --- | --- | --- |
| Chiffrement à clé publique | HPKE (RFC 9180), mode base (mode PSK pour le transfert de clés) | Selon les éléments ci-dessous |
| Échange de clé (KEM) | X-Wing : ML-KEM-768 (FIPS 203) combiné à X25519 | Clé publique 1 216 octets ; graine 32 octets |
| Dérivation de clés | HKDF-SHA256 (RFC 5869) | Sorties de 32 octets |
| Chiffrement symétrique authentifié | AES-256-GCM | Clé 256 bits, nonce 96 bits, étiquette 128 bits |
| Signature | Ed25519 (RFC 8032) | Clé publique 32 octets |
| Empreinte, journal | SHA-256 | 256 bits |
| Partage de secret | Shamir sur GF(2⁸), octet par octet | Parts de 33 octets |
| Graine de l'utilisateur | 32 octets aléatoires, écrits en 24 mots BIP39 (phrase de secours) | 256 bits |
| Aléa | Générateur du système (SecRandomCopyBytes sur iOS) | |

Le contenu d'une enveloppe est complété jusqu'à une taille fixe (1 à 32 Kio) avant chiffrement, pour en cacher la
longueur.

## 4. Bibliothèques

Toutes sont en JavaScript pur, épinglées à une version : `@noble/post-quantum` 0.7.1, `@noble/hashes` 2.4.0,
`@noble/ciphers` 2.4.0, `@noble/curves` 2.4.0, `@scure/bip39` 2.4.0, `shamir-secret-sharing` 0.0.4 (audité),
`canonicalize` 5.1.0 (JSON canonique, RFC 8785).

HPKE est composé dans l'app (`lib/crypto/hpke.ts`). Il est vérifié contre les vecteurs officiels de la RFC 9180 et contre
une implémentation indépendante, dans les deux sens. Les vecteurs officiels tournent aussi sur l'appareil.

## 5. Gestion des clés

- La graine est créée sur le téléphone et gardée dans son trousseau sécurisé, réservé à cet appareil et exclu des
  sauvegardes. Face ID ou le code est demandé avant de montrer la phrase, de sceller une enveloppe ou d'en lire le
  secret.
- Aucune clé privée ni graine n'est transmise en clair. L'éditeur ne garde aucune copie et ne peut ni déchiffrer ni
  retrouver les clés : aucun séquestre, aucune porte dérobée.
- L'utilisateur peut les sauvegarder par sa phrase de secours (24 mots, sur papier), par une clé d'accès de son
  trousseau iCloud, ou les transférer vers un nouveau téléphone en scannant un code (5 minutes de validité).
- Une clé réinitialisée n'est utilisable par les autres qu'après 72 heures. Chaque téléphone retient les clés déjà vues
  pour chaque personne, et les codes de sécurité se comparent en face à face.

## 6. Avant la sortie publique

Le protocole sera audité par des experts indépendants (engagement de la politique de confidentialité). Un changement de
format du protocole est une nouvelle version : la déclaration est alors à compléter si elle change les fonctions ou les
algorithmes déclarés.
