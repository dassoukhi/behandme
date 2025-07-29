/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';
const sinon = require('sinon');
const chai = require('chai');
const sinonChai = require('sinon-chai');
const expect = chai.expect;

const { Context } = require('fabric-contract-api');
const { ChaincodeStub } = require('fabric-shim');

const UserDocumentTransfer = require('../lib/userDocumentTransfer.js');

let assert = sinon.assert;
chai.use(sinonChai);

describe('User Document Transfer Tests', () => {
    let transactionContext, chaincodeStub, user;

    beforeEach(() => {
        transactionContext = new Context();

        chaincodeStub = sinon.createStubInstance(ChaincodeStub);
        transactionContext.setChaincodeStub(chaincodeStub);

        chaincodeStub.putState.callsFake((key, value) => {
            if (!chaincodeStub.states) {
                chaincodeStub.states = {};
            }
            chaincodeStub.states[key] = value;
        });

        chaincodeStub.getState.callsFake(async (key) => {
            let ret;
            if (chaincodeStub.states) {
                ret = chaincodeStub.states[key];
            }
            return Promise.resolve(ret);
        });

        chaincodeStub.deleteState.callsFake(async (key) => {
            if (chaincodeStub.states) {
                delete chaincodeStub.states[key];
            }
            return Promise.resolve(key);
        });

        chaincodeStub.getStateByRange.callsFake(async () => {
            function* internalGetStateByRange() {
                if (chaincodeStub.states) {
                    const copied = Object.assign({}, chaincodeStub.states);
                    for (let key in copied) {
                        yield {value: copied[key]};
                    }
                }
            }
            return Promise.resolve(internalGetStateByRange());
        });

        chaincodeStub.getQueryResult.callsFake(async (query) => {
            function* internalGetQueryResult() {
                if (chaincodeStub.states) {
                    const queryObj = JSON.parse(query);
                    const copied = Object.assign({}, chaincodeStub.states);

                    for (let key in copied) {
                        try {
                            const record = JSON.parse(copied[key]);
                            let matches = true;

                            for (let field in queryObj.selector) {
                                if (field === '$in') {continue;}
                                if (record[field] !== queryObj.selector[field]) {
                                    matches = false;
                                    break;
                                }
                            }

                            if (matches) {
                                yield {value: copied[key]};
                            }
                        } catch (err) {
                            // Skip non-JSON values
                        }
                    }
                }
            }
            return Promise.resolve(internalGetQueryResult());
        });

        user = {
            ID: 'user1',
            FirstName: 'Jean',
            LastName: 'Dupont',
            Email: 'jean.dupont@email.com',
            Phone: '+33123456789',
            Address: '123 Rue de la Paix, Paris',
            CreatedDate: '2024-01-15',
            Status: 'active',
            docType: 'user'
        };
    });

    describe('Test InitLedger', () => {
        it('should return error on InitLedger', async () => {
            chaincodeStub.putState.rejects('failed inserting key');
            let userDocTransfer = new UserDocumentTransfer();
            try {
                await userDocTransfer.InitLedger(transactionContext);
                assert.fail('InitLedger should have failed');
            } catch (err) {
                expect(err.name).to.equal('failed inserting key');
            }
        });

        it('should return success on InitLedger', async () => {
            let userDocTransfer = new UserDocumentTransfer();
            await userDocTransfer.InitLedger(transactionContext);

            let userRet = JSON.parse((await chaincodeStub.getState('user1')).toString());
            expect(userRet.docType).to.equal('user');
            expect(userRet.FirstName).to.equal('Jean');

            let docRet = JSON.parse((await chaincodeStub.getState('doc1')).toString());
            expect(docRet.docType).to.equal('document');
            expect(docRet.Title).to.equal('Contrat de Vente');
        });
    });

    describe('Test User Management', () => {
        describe('Test CreateUser', () => {
            it('should return error when user already exists', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                await userDocTransfer.CreateUser(transactionContext, user.ID, user.FirstName, user.LastName, user.Email, user.Phone, user.Address);

                try {
                    await userDocTransfer.CreateUser(transactionContext, user.ID, 'Pierre', 'Martin', 'pierre@email.com', '+33111222333', 'Autre adresse');
                    assert.fail('CreateUser should have failed');
                } catch (err) {
                    expect(err.message).to.equal(`L'utilisateur ${user.ID} existe déjà`);
                }
            });

            it('should return success on CreateUser', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.CreateUser(transactionContext, user.ID, user.FirstName, user.LastName, user.Email, user.Phone, user.Address);

                let createdUser = JSON.parse(result);
                expect(createdUser.ID).to.equal(user.ID);
                expect(createdUser.FirstName).to.equal(user.FirstName);
                expect(createdUser.docType).to.equal('user');
                expect(createdUser.Status).to.equal('active');
            });
        });

        describe('Test ReadUser', () => {
            it('should return error when user does not exist', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                try {
                    await userDocTransfer.ReadUser(transactionContext, 'nonexistent');
                    assert.fail('ReadUser should have failed');
                } catch (err) {
                    expect(err.message).to.equal('L\'utilisateur nonexistent n\'existe pas');
                }
            });

            it('should return success on ReadUser', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                await userDocTransfer.CreateUser(transactionContext, user.ID, user.FirstName, user.LastName, user.Email, user.Phone, user.Address);

                let result = await userDocTransfer.ReadUser(transactionContext, user.ID);
                let readUser = JSON.parse(result);
                expect(readUser.ID).to.equal(user.ID);
                expect(readUser.FirstName).to.equal(user.FirstName);
            });
        });

        describe('Test UpdateUser', () => {
            it('should return error when user does not exist', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                try {
                    await userDocTransfer.UpdateUser(transactionContext, 'nonexistent', 'Pierre', 'Martin', 'pierre@email.com', '+33111222333', 'Nouvelle adresse', 'active');
                    assert.fail('UpdateUser should have failed');
                } catch (err) {
                    expect(err.message).to.equal('L\'utilisateur nonexistent n\'existe pas');
                }
            });

            it('should return success on UpdateUser', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                await userDocTransfer.CreateUser(transactionContext, user.ID, user.FirstName, user.LastName, user.Email, user.Phone, user.Address);

                let result = await userDocTransfer.UpdateUser(transactionContext, user.ID, 'Pierre', 'Martin', 'pierre@email.com', '+33111222333', 'Nouvelle adresse', 'inactive');
                let updatedUser = JSON.parse(result);

                expect(updatedUser.FirstName).to.equal('Pierre');
                expect(updatedUser.LastName).to.equal('Martin');
                expect(updatedUser.Status).to.equal('inactive');
            });
        });

        describe('Test DeleteUser', () => {
            it('should return error when user has documents', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                await userDocTransfer.CreateUser(transactionContext, 'user1', 'Jean', 'Dupont', 'jean@email.com', '+33123456789', 'Adresse');
                await userDocTransfer.CreateUser(transactionContext, 'user2', 'Marie', 'Martin', 'marie@email.com', '+33987654321', 'Adresse2');
                await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test Doc', 'contract', 'Contenu', 'user1', 'user2', '["user1"]', 'hash123');

                try {
                    await userDocTransfer.DeleteUser(transactionContext, 'user1');
                    assert.fail('DeleteUser should have failed');
                } catch (err) {
                    expect(err.message).to.contain('il possède encore');
                }
            });

            it('should return success on DeleteUser when no documents', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                await userDocTransfer.CreateUser(transactionContext, user.ID, user.FirstName, user.LastName, user.Email, user.Phone, user.Address);
                await userDocTransfer.DeleteUser(transactionContext, user.ID);
                let result = await chaincodeStub.getState(user.ID);
                expect(result).to.equal(undefined);
            });
        });
    });

    describe('Test Document Management', () => {
        beforeEach(async () => {
            let userDocTransfer = new UserDocumentTransfer();
            await userDocTransfer.CreateUser(transactionContext, 'user1', 'Jean', 'Dupont', 'jean@email.com', '+33123456789', 'Adresse1');
            await userDocTransfer.CreateUser(transactionContext, 'user2', 'Marie', 'Martin', 'marie@email.com', '+33987654321', 'Adresse2');
        });

        describe('Test CreateDocument', () => {
            it('should return error when document already exists', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test', 'contract', 'Contenu', 'user1', 'user2', '["user1"]', 'hash');
                try {
                    await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test2', 'report', 'Autre contenu', 'user2', 'user1', '["user2"]', 'hash2');
                    assert.fail('CreateDocument should have failed');
                } catch (err) {
                    expect(err.message).to.equal('Le document doc1 existe déjà');
                }
            });

            it('should return error when owner does not exist', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                try {
                    await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test', 'contract', 'Contenu', 'nonexistent', 'user2', '["user1"]', 'hash');
                    assert.fail('CreateDocument should have failed');
                } catch (err) {
                    expect(err.message).to.equal('Le propriétaire nonexistent n\'existe pas');
                }
            });

            it('should return error when validator does not exist', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                try {
                    await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test', 'contract', 'Contenu', 'user1', 'nonexistent', '["user1"]', 'hash');
                    assert.fail('CreateDocument should have failed');
                } catch (err) {
                    expect(err.message).to.equal('Le validateur nonexistent n\'existe pas');
                }
            });

            it('should return success on CreateDocument', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test Document', 'contract', 'Contenu du document', 'user1', 'user2', '["user1", "user2"]', 'hash123');
                let createdDoc = JSON.parse(result);
                expect(createdDoc.ID).to.equal('doc1');
                expect(createdDoc.Title).to.equal('Test Document');
                expect(createdDoc.Owner).to.equal('user1');
                expect(createdDoc.Validator).to.equal('user2');
                expect(createdDoc.Accessor).to.deep.equal(['user1', 'user2']);
                expect(createdDoc.docType).to.equal('document');
            });
        });

        describe('Test ReadDocument', () => {
            it('should return error when document does not exist', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                try {
                    await userDocTransfer.ReadDocument(transactionContext, 'nonexistent');
                    assert.fail('ReadDocument should have failed');
                } catch (err) {
                    expect(err.message).to.equal('Le document nonexistent n\'existe pas');
                }
            });

            it('should return success on ReadDocument', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test', 'contract', 'Contenu', 'user1', 'user2', '["user1"]', 'hash');
                let result = await userDocTransfer.ReadDocument(transactionContext, 'doc1');
                let readDoc = JSON.parse(result);
                expect(readDoc.ID).to.equal('doc1');
                expect(readDoc.Title).to.equal('Test');
            });
        });

        describe('Test UpdateDocument', () => {
            it('should return success on UpdateDocument', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test', 'contract', 'Contenu', 'user1', 'user2', '["user1"]', 'hash');
                let result = await userDocTransfer.UpdateDocument(transactionContext, 'doc1', 'Nouveau Titre', 'report', 'Nouveau contenu', 'user2', '["user1", "user2"]', 'draft', 'newhash');
                let updatedDoc = JSON.parse(result);
                expect(updatedDoc.Title).to.equal('Nouveau Titre');
                expect(updatedDoc.Type).to.equal('report');
                expect(updatedDoc.Status).to.equal('draft');
                expect(updatedDoc.Validator).to.equal('user2');
                expect(updatedDoc.Accessor).to.deep.equal(['user1', 'user2']);
            });
        });

        describe('Test TransferDocument', () => {
            it('should return error when new owner does not exist', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test', 'contract', 'Contenu', 'user1', 'user2', '["user1"]', 'hash');
                try {
                    await userDocTransfer.TransferDocument(transactionContext, 'doc1', 'nonexistent');
                    assert.fail('TransferDocument should have failed');
                } catch (err) {
                    expect(err.message).to.equal('Le nouveau propriétaire nonexistent n\'existe pas');
                }
            });

            it('should return success on TransferDocument', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test', 'contract', 'Contenu', 'user1', 'user2', '["user1"]', 'hash');
                let result = await userDocTransfer.TransferDocument(transactionContext, 'doc1', 'user2');
                let transfer = JSON.parse(result);
                expect(transfer.oldOwner).to.equal('user1');
                expect(transfer.newOwner).to.equal('user2');
                expect(transfer.documentId).to.equal('doc1');
                // Vérifier que le document a été mis à jour
                let docResult = await userDocTransfer.ReadDocument(transactionContext, 'doc1');
                let updatedDoc = JSON.parse(docResult);
                expect(updatedDoc.Owner).to.equal('user2');
                expect(updatedDoc.Accessor).to.include('user2');
            });
        });
    });

    describe('Test Access Management', () => {
        beforeEach(async () => {
            let userDocTransfer = new UserDocumentTransfer();
            await userDocTransfer.CreateUser(transactionContext, 'user1', 'Jean', 'Dupont', 'jean@email.com', '+33123456789', 'Adresse1');
            await userDocTransfer.CreateUser(transactionContext, 'user2', 'Marie', 'Martin', 'marie@email.com', '+33987654321', 'Adresse2');
            await userDocTransfer.CreateUser(transactionContext, 'user3', 'Pierre', 'Dubois', 'pierre@email.com', '+33555666777', 'Adresse3');
            await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Test', 'contract', 'Contenu', 'user1', 'user2', '["user1"]', 'hash');
        });

        describe('Test CheckDocumentAccess', () => {
            it('should return correct access for owner', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.CheckDocumentAccess(transactionContext, 'doc1', 'user1');
                let access = JSON.parse(result);

                expect(access.hasAccess).to.equal(true);
                expect(access.accessType).to.equal('owner');
            });

            it('should return correct access for validator', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.CheckDocumentAccess(transactionContext, 'doc1', 'user2');
                let access = JSON.parse(result);

                expect(access.hasAccess).to.equal(true);
                expect(access.accessType).to.equal('validator');
            });

            it('should return no access for non-accessor', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.CheckDocumentAccess(transactionContext, 'doc1', 'user3');
                let access = JSON.parse(result);

                expect(access.hasAccess).to.equal(false);
                expect(access.accessType).to.equal('none');
            });
        });

        describe('Test AddAccessor', () => {
            it('should successfully add accessor', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.AddAccessor(transactionContext, 'doc1', 'user3');
                let updatedDoc = JSON.parse(result);

                expect(updatedDoc.Accessor).to.include('user3');
            });

            it('should not duplicate existing accessor', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.AddAccessor(transactionContext, 'doc1', 'user1');
                let updatedDoc = JSON.parse(result);
                let user1Count = updatedDoc.Accessor.filter(acc => acc === 'user1').length;
                expect(user1Count).to.equal(1);
            });
        });

        describe('Test RemoveAccessor', () => {
            it('should successfully remove accessor', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.RemoveAccessor(transactionContext, 'doc1', 'user1');
                let updatedDoc = JSON.parse(result);
                expect(updatedDoc.Accessor).to.not.include('user1');
            });
        });

        describe('Test ChangeValidator', () => {
            it('should successfully change validator', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.ChangeValidator(transactionContext, 'doc1', 'user3');
                let change = JSON.parse(result);
                expect(change.oldValidator).to.equal('user2');
                expect(change.newValidator).to.equal('user3');
                // Vérifier que le document a été mis à jour
                let docResult = await userDocTransfer.ReadDocument(transactionContext, 'doc1');
                let updatedDoc = JSON.parse(docResult);
                expect(updatedDoc.Validator).to.equal('user3');
            });
        });
    });

    describe('Test Query Functions', () => {
        beforeEach(async () => {
            let userDocTransfer = new UserDocumentTransfer();
            await userDocTransfer.CreateUser(transactionContext, 'user1', 'Jean', 'Dupont', 'jean@email.com', '+33123456789', 'Adresse1');
            await userDocTransfer.CreateUser(transactionContext, 'user2', 'Marie', 'Martin', 'marie@email.com', '+33987654321', 'Adresse2');
            await userDocTransfer.CreateDocument(transactionContext, 'doc1', 'Contrat', 'contract', 'Contenu1', 'user1', 'user2', '["user1"]', 'hash1');
            await userDocTransfer.CreateDocument(transactionContext, 'doc2', 'Rapport', 'report', 'Contenu2', 'user2', 'user1', '["user2"]', 'hash2');
        });

        describe('Test GetAllUsers', () => {
            it('should return all users', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.GetAllUsers(transactionContext);
                let users = JSON.parse(result);
                expect(users.length).to.equal(2);
                expect(users[0].docType).to.equal('user');
                expect(users[1].docType).to.equal('user');
            });
        });

        describe('Test GetAllDocuments', () => {
            it('should return all documents', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.GetAllDocuments(transactionContext);
                let documents = JSON.parse(result);
                expect(documents.length).to.equal(2);
                expect(documents[0].docType).to.equal('document');
                expect(documents[1].docType).to.equal('document');
            });
        });

        describe('Test GetDocumentsByOwner', () => {
            it('should return documents by owner', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.GetDocumentsByOwner(transactionContext, 'user1');
                let documents = JSON.parse(result);
                expect(documents.length).to.equal(1);
                expect(documents[0].Owner).to.equal('user1');
                expect(documents[0].Title).to.equal('Contrat');
            });
        });

        describe('Test GetDocumentsByType', () => {
            it('should return documents by type', async () => {
                let userDocTransfer = new UserDocumentTransfer();
                let result = await userDocTransfer.GetDocumentsByType(transactionContext, 'contract');
                let documents = JSON.parse(result);
                expect(documents.length).to.equal(1);
                expect(documents[0].Type).to.equal('contract');
                expect(documents[0].Title).to.equal('Contrat');
            });
        });
    });
});