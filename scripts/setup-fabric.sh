#!/bin/bash

# Script pour configurer et démarrer le réseau Hyperledger Fabric

set -e

echo "🚀 Configuration du réseau Hyperledger Fabric..."

# Sauvegarder le répertoire actuel
ORIGINAL_DIR=$(pwd)

# Naviguer vers le répertoire du réseau de test avec gestion des espaces
cd "fabric-network/fabric-samples/test-network"

echo "📋 Nettoyage des anciens conteneurs et volumes..."
./network.sh down

echo "🔧 Démarrage du réseau Fabric..."
./network.sh up createChannel -ca

echo "📦 Déploiement du chaincode basic..."
./network.sh deployCC -ccn basic -ccp "../asset-transfer-basic/chaincode-javascript" -ccl javascript

# Retourner au répertoire original
cd "$ORIGINAL_DIR"

echo "✅ Réseau Fabric configuré avec succès!"
echo ""
echo "📊 Informations du réseau:"
echo "- Canal: mychannel"
echo "- Chaincode: basic"
echo "- Organisations: Org1, Org2"
echo ""
echo "🔗 Vous pouvez maintenant utiliser les endpoints API pour interagir avec la blockchain:"
echo "- POST /fabric/assets - Créer un asset"
echo "- GET /fabric/assets - Récupérer tous les assets"
echo "- GET /fabric/assets/:id - Récupérer un asset spécifique"
echo "- PUT /fabric/assets/:id - Mettre à jour un asset"
echo "- DELETE /fabric/assets/:id - Supprimer un asset"
echo "- POST /fabric/assets/:id/transfer - Transférer un asset"
echo ""
echo "📚 Documentation Swagger disponible sur: http://localhost:3000/api/docs"
