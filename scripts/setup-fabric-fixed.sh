#!/bin/bash

# Script pour configurer et démarrer le réseau Hyperledger Fabric
# Version corrigée pour gérer les espaces dans les chemins

set -e

echo "🚀 Configuration du réseau Hyperledger Fabric..."

# Obtenir le chemin absolu du répertoire de travail
WORK_DIR="$(pwd)"
FABRIC_SAMPLES_DIR="$WORK_DIR/fabric-network/fabric-samples"
TEST_NETWORK_DIR="$FABRIC_SAMPLES_DIR/test-network"

# Vérifier que les répertoires existent
if [ ! -d "$FABRIC_SAMPLES_DIR" ]; then
    echo "❌ Erreur: Le répertoire fabric-samples n'existe pas à $FABRIC_SAMPLES_DIR"
    exit 1
fi

if [ ! -d "$TEST_NETWORK_DIR" ]; then
    echo "❌ Erreur: Le répertoire test-network n'existe pas à $TEST_NETWORK_DIR"
    exit 1
fi

# Définir les variables d'environnement nécessaires
export PATH="$FABRIC_SAMPLES_DIR/bin:$PATH"
export FABRIC_CFG_PATH="$FABRIC_SAMPLES_DIR/config"

echo "📍 Répertoire de travail: $WORK_DIR"
echo "📍 Fabric samples: $FABRIC_SAMPLES_DIR"
echo "📍 Test network: $TEST_NETWORK_DIR"

# Naviguer vers le répertoire du réseau de test
cd "$TEST_NETWORK_DIR"

echo "📋 Nettoyage des anciens conteneurs et volumes..."
bash ./network.sh down

echo "🔧 Démarrage du réseau Fabric..."
bash ./network.sh up createChannel -ca

echo "📦 Déploiement du chaincode pour les utilisateurs..."
npm run deploy:user-chaincode

# Retourner au répertoire original
cd "$WORK_DIR"

echo "✅ Réseau Fabric configuré avec succès!"
echo ""
echo "📊 Informations du réseau:"
echo "- Canal: mychannel"
echo "- Chaincode: basic"
echo "- Organisations: Org1, Org2"
echo ""
echo "🔍 Vérification des conteneurs Docker:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "(peer|orderer|ca)"
echo ""
echo "🔗 Vous pouvez maintenant utiliser les endpoints API pour interagir avec la blockchain:"
echo "- POST /api/v1/user-chaincode - Créer un utilisateur sur la blockchain"
echo "- GET /api/v1/user-chaincode - Récupérer tous les utilisateur de la blockchain"
echo "- GET /api/v1/user-chaincode/{id} - Récupérer un utilisateur spécifique depuis la blockchain"
echo ""
echo "📚 Documentation Swagger disponible sur: http://localhost:3000/api/docs"
