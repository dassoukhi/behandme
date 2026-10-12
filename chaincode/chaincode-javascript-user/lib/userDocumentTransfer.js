/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

// Deterministic JSON.stringify()
const stringify = require("json-stringify-deterministic");
const sortKeysRecursive = require("sort-keys-recursive");
const { Contract } = require("fabric-contract-api");

class UserDocumentTransfer extends Contract {
  async InitLedger(ctx) {
    // Initialisation avec des utilisateurs et documents exemples
    const users = [
      {
        ID: "user1",
        Status: "active",
        docType: "user",
      },
      {
        ID: "user2",
        Status: "active",
        docType: "user",
      },
      {
        ID: "user3",
        Status: "inactive",
        docType: "user",
      },
    ];

    const documents = [
      {
        ID: "doc1",
        Title: "Contrat de Vente",
        Type: "contract",
        Content: "Contenu du contrat de vente...",
        Owner: "user1",
        CreatedDate: "2024-01-16",
        LastModified: "2024-01-16",
        Status: "active",
        Hash: "a1b2c3d4e5f6",
        docType: "document",
      },
      {
        ID: "doc2",
        Title: "Certificat de Formation",
        Type: "certificate",
        Content: "Certificat attestant de la formation...",
        Owner: "user2",
        CreatedDate: "2024-02-21",
        LastModified: "2024-02-21",
        Status: "active",
        Hash: "f6e5d4c3b2a1",
        docType: "document",
      },
      {
        ID: "doc3",
        Title: "Rapport Annuel",
        Type: "report",
        Content: "Rapport d'activité annuel...",
        Owner: "user1",
        CreatedDate: "2024-03-15",
        LastModified: "2024-03-15",
        Status: "draft",
        Hash: "b2c3d4e5f6a1",
        docType: "document",
      },
    ];

    // Stocker les utilisateurs
    for (const user of users) {
      await ctx.stub.putState(
        user.ID,
        Buffer.from(stringify(sortKeysRecursive(user)))
      );
    }

    // Stocker les documents
    for (const document of documents) {
      await ctx.stub.putState(
        document.ID,
        Buffer.from(stringify(sortKeysRecursive(document)))
      );
    }
  }

  // ===== GESTION DES UTILISATEURS =====

  // Créer un nouvel utilisateur
  async CreateUser(ctx, id) {
    const exists = await this.UserExists(ctx, id);
    if (exists) {
      throw new Error(`L'utilisateur ${id} existe déjà`);
    }

    const user = {
      ID: id,
      CreatedDate: new Date().toISOString().split("T")[0],
      Status: "active",
      docType: "user",
    };

    await ctx.stub.putState(
      id,
      Buffer.from(stringify(sortKeysRecursive(user)))
    );
    return JSON.stringify(user);
  }

  // Lire un utilisateur
  async ReadUser(ctx, id) {
    const userJSON = await ctx.stub.getState(id);
    if (!userJSON || userJSON.length === 0) {
      throw new Error(`L'utilisateur ${id} n'existe pas`);
    }
    const user = JSON.parse(userJSON.toString());
    if (user.docType !== "user") {
      throw new Error(`${id} n'est pas un utilisateur`);
    }
    return userJSON.toString();
  }

  // Mettre à jour un utilisateur
  async UpdateUser(ctx, id, status) {
    const exists = await this.UserExists(ctx, id);
    if (!exists) {
      throw new Error(`L'utilisateur ${id} n'existe pas`);
    }

    const userString = await this.ReadUser(ctx, id);
    const user = JSON.parse(userString);

    const updatedUser = {
      ID: id,
      CreatedDate: user.CreatedDate,
      Status: status,
      docType: "user",
    };

    await ctx.stub.putState(
      id,
      Buffer.from(stringify(sortKeysRecursive(updatedUser)))
    );
    return JSON.stringify(updatedUser);
  }

  // Supprimer un utilisateur
  async DeleteUser(ctx, id) {
    const exists = await this.UserExists(ctx, id);
    if (!exists) {
      throw new Error(`L'utilisateur ${id} n'existe pas`);
    }

    // Vérifier s'il possède des documents
    const userDocuments = await this.GetDocumentsByOwner(ctx, id);
    const documents = JSON.parse(userDocuments);
    if (documents.length > 0) {
      throw new Error(
        `Impossible de supprimer l'utilisateur ${id}: il possède encore ${documents.length} document(s)`
      );
    }

    return ctx.stub.deleteState(id);
  }

  // Vérifier l'existence d'un utilisateur
  async UserExists(ctx, id) {
    const userJSON = await ctx.stub.getState(id);
    if (!userJSON || userJSON.length === 0) {
      return false;
    }
    try {
      const user = JSON.parse(userJSON.toString());
      return user.docType === "user";
    } catch (err) {
      return false;
    }
  }

  // ===== GESTION DES DOCUMENTS =====

  // Créer un nouveau document
  async CreateDocument(ctx, id, title, type, content, owner, hash) {
    const exists = await this.DocumentExists(ctx, id);
    if (exists) {
      throw new Error(`Le document ${id} existe déjà`);
    }

    // Vérifier que le propriétaire existe
    const ownerExists = await this.UserExists(ctx, owner);
    if (!ownerExists) {
      throw new Error(`Le propriétaire ${owner} n'existe pas`);
    }

    // Vérifier que tous les accessors existent

    const document = {
      ID: id,
      Title: title,
      Type: type,
      Content: content,
      Owner: owner,
      CreatedDate: new Date().toISOString().split("T")[0],
      LastModified: new Date().toISOString().split("T")[0],
      Hash: hash,
      docType: "document",
    };

    await ctx.stub.putState(
      id,
      Buffer.from(stringify(sortKeysRecursive(document)))
    );
    return JSON.stringify(document);
  }

  // Lire un document
  async ReadDocument(ctx, id) {
    const documentJSON = await ctx.stub.getState(id);
    if (!documentJSON || documentJSON.length === 0) {
      throw new Error(`Le document ${id} n'existe pas`);
    }
    const document = JSON.parse(documentJSON.toString());
    if (document.docType !== "document") {
      throw new Error(`${id} n'est pas un document`);
    }
    return documentJSON.toString();
  }

  // Mettre à jour un document
  async UpdateDocument(ctx, id, title, type, content, hash) {
    const exists = await this.DocumentExists(ctx, id);
    if (!exists) {
      throw new Error(`Le document ${id} n'existe pas`);
    }

    const documentString = await this.ReadDocument(ctx, id);
    const document = JSON.parse(documentString);

    // Vérifier que le validateur existe

    const updatedDocument = {
      ID: id,
      Title: title,
      Type: type,
      Content: content,
      Owner: document.Owner,
      CreatedDate: document.CreatedDate,
      LastModified: new Date().toISOString().split("T")[0],
      Hash: hash,
      docType: "document",
    };

    await ctx.stub.putState(
      id,
      Buffer.from(stringify(sortKeysRecursive(updatedDocument)))
    );
    return JSON.stringify(updatedDocument);
  }

  // Supprimer un document
  async DeleteDocument(ctx, id) {
    const exists = await this.DocumentExists(ctx, id);
    if (!exists) {
      throw new Error(`Le document ${id} n'existe pas`);
    }
    return ctx.stub.deleteState(id);
  }

  // Vérifier l'existence d'un document
  async DocumentExists(ctx, id) {
    const documentJSON = await ctx.stub.getState(id);
    if (!documentJSON || documentJSON.length === 0) {
      return false;
    }
    try {
      const document = JSON.parse(documentJSON.toString());
      return document.docType === "document";
    } catch (err) {
      return false;
    }
  }

  // ===== TRANSFERT DE DOCUMENTS =====

  // Transférer un document d'un utilisateur à un autre
  async TransferDocument(ctx, documentId, newOwner) {
    const documentString = await this.ReadDocument(ctx, documentId);
    const document = JSON.parse(documentString);
    // Vérifier que le nouveau propriétaire existe
    const newOwnerExists = await this.UserExists(ctx, newOwner);
    if (!newOwnerExists) {
      throw new Error(`Le nouveau propriétaire ${newOwner} n'existe pas`);
    }

    const oldOwner = document.Owner;
    document.Owner = newOwner;
    document.LastModified = new Date().toISOString().split("T")[0];

    await ctx.stub.putState(
      documentId,
      Buffer.from(stringify(sortKeysRecursive(document)))
    );
    return JSON.stringify({
      documentId: documentId,
      oldOwner: oldOwner,
      newOwner: newOwner,
      transferDate: document.LastModified,
    });
  }

  // ===== REQUÊTES =====

  // Obtenir tous les utilisateurs
  async GetAllUsers(ctx) {
    return await this._getAllByDocType(ctx, "user");
  }

  // Obtenir tous les documents
  async GetAllDocuments(ctx) {
    return await this._getAllByDocType(ctx, "document");
  }

  // Obtenir tous les documents d'un utilisateur
  async GetDocumentsByOwner(ctx, owner) {
    const allResults = [];
    const iterator = await ctx.stub.getStateByRange("", "");
    let result = await iterator.next();

    while (!result.done) {
      const strValue = Buffer.from(result.value.value.toString()).toString(
        "utf8"
      );
      let record;
      try {
        record = JSON.parse(strValue);
        if (record.docType === "document" && record.Owner === owner) {
          allResults.push(record);
        }
      } catch (err) {
        console.log(err);
      }
      result = await iterator.next();
    }
    return JSON.stringify(allResults);
  }

  // Obtenir tous les documents par type
  async GetDocumentsByType(ctx, type) {
    const allResults = [];
    const iterator = await ctx.stub.getStateByRange("", "");
    let result = await iterator.next();

    while (!result.done) {
      const strValue = Buffer.from(result.value.value.toString()).toString(
        "utf8"
      );
      let record;
      try {
        record = JSON.parse(strValue);
        if (record.docType === "document" && record.Type === type) {
          allResults.push(record);
        }
      } catch (err) {
        console.log(err);
      }
      result = await iterator.next();
    }
    return JSON.stringify(allResults);
  }

  // Vérifier si un utilisateur a accès à un document
  async CheckDocumentAccess(ctx, documentId, userId) {
    const documentString = await this.ReadDocument(ctx, documentId);
    const document = JSON.parse(documentString);

    const hasAccess = document.Owner === userId;

    return JSON.stringify({
      documentId: documentId,
      userId: userId,
      hasAccess: hasAccess,
    });
  }

  // Obtenir tous les utilisateurs par statut
  async GetUsersByStatus(ctx, status) {
    const queryString = {
      selector: {
        docType: "user",
        Status: status,
      },
    };

    const resultsIterator = await ctx.stub.getQueryResult(
      JSON.stringify(queryString)
    );
    const results = await this._getAllResults(resultsIterator);
    return JSON.stringify(results);
  }

  // ===== MÉTHODES UTILITAIRES =====

  // Méthode privée pour obtenir tous les éléments par type de document
  async _getAllByDocType(ctx, docType) {
    const allResults = [];
    const iterator = await ctx.stub.getStateByRange("", "");
    let result = await iterator.next();
    while (!result.done) {
      const strValue = Buffer.from(result.value.value.toString()).toString(
        "utf8"
      );
      let record;
      try {
        record = JSON.parse(strValue);
        if (record.docType === docType) {
          allResults.push(record);
        }
      } catch (err) {
        console.log(err);
      }
      result = await iterator.next();
    }
    return JSON.stringify(allResults);
  }

  // Méthode privée pour traiter les résultats d'un iterator
  async _getAllResults(iterator) {
    const allResults = [];
    let result = await iterator.next();
    while (!result.done) {
      const strValue = Buffer.from(result.value.value.toString()).toString(
        "utf8"
      );
      let record;
      try {
        record = JSON.parse(strValue);
      } catch (err) {
        console.log(err);
        record = strValue;
      }
      allResults.push(record);
      result = await iterator.next();
    }
    return allResults;
  }

  // Obtenir l'historique d'un document ou utilisateur (si supporté)
  async GetHistory(ctx, id) {
    try {
      const resultsIterator = await ctx.stub.getHistoryForKey(id);
      const results = [];

      let result = await resultsIterator.next();
      while (!result.done) {
        const entry = {
          txId: result.value.txId,
          timestamp: result.value.timestamp,
          isDelete: result.value.isDelete,
        };

        if (!result.value.isDelete) {
          try {
            entry.value = JSON.parse(result.value.value.toString("utf8"));
          } catch (err) {
            entry.value = result.value.value.toString("utf8");
          }
        }

        results.push(entry);
        result = await iterator.next();
      }

      return JSON.stringify(results);
    } catch (error) {
      // getHistoryForKey peut ne pas être supporté selon la configuration
      throw new Error(`Historique non disponible: ${error.message}`);
    }
  }
}

module.exports = UserDocumentTransfer;
