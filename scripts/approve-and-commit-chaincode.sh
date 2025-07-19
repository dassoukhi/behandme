#!/bin/bash

# Script pour approuver et committer le chaincode déjà installé

set -e

echo "✅ Approbation et commit du chaincode basic..."

# Obtenir le chemin absolu du répertoire de travail
WORK_DIR="$(pwd)"
FABRIC_SAMPLES_DIR="$WORK_DIR/fabric-network/fabric-samples"
TEST_NETWORK_DIR="$FABRIC_SAMPLES_DIR/test-network"

# Définir les variables d'environnement nécessaires
export PATH="$FABRIC_SAMPLES_DIR/bin:$PATH"
export FABRIC_CFG_PATH="$FABRIC_SAMPLES_DIR/config"

# Naviguer vers le répertoire du réseau de test
cd "$TEST_NETWORK_DIR"

# Définir les variables d'environnement pour Org2
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org2MSP"
export CORE_PEER_TLS_ROOTCERT_FILE="$TEST_NETWORK_DIR/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$TEST_NETWORK_DIR/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp"
export CORE_PEER_ADDRESS=localhost:9051

echo "🔍 Querying installed chaincodes..."
peer lifecycle chaincode queryinstalled

# Obtenir le package ID
PACKAGE_ID=$(peer lifecycle chaincode queryinstalled --output json | jq -r '.installed_chaincodes[0].package_id')
echo "📋 Package ID: $PACKAGE_ID"

echo "✅ Approving chaincode for Org2..."
peer lifecycle chaincode approveformyorg \
  -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --channelID mychannel \
  --name basic \
  --version 1.0 \
  --package-id $PACKAGE_ID \
  --sequence 1 \
  --tls \
  --cafile "$TEST_NETWORK_DIR/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"

echo "✅ Approving chaincode for Org1..."
# Changer vers Org1
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE="$TEST_NETWORK_DIR/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$TEST_NETWORK_DIR/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"
export CORE_PEER_ADDRESS=localhost:7051

peer lifecycle chaincode approveformyorg \
  -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --channelID mychannel \
  --name basic \
  --version 1.0 \
  --package-id $PACKAGE_ID \
  --sequence 1 \
  --tls \
  --cafile "$TEST_NETWORK_DIR/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"

echo "🔍 Checking commit readiness..."
peer lifecycle chaincode checkcommitreadiness \
  --channelID mychannel \
  --name basic \
  --version 1.0 \
  --sequence 1 \
  --tls \
  --cafile "$TEST_NETWORK_DIR/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem" \
  --output json

echo "🚀 Committing chaincode..."
peer lifecycle chaincode commit \
  -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --channelID mychannel \
  --name basic \
  --version 1.0 \
  --sequence 1 \
  --tls \
  --cafile "$TEST_NETWORK_DIR/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem" \
  --peerAddresses localhost:7051 \
  --tlsRootCertFiles "$TEST_NETWORK_DIR/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
  --peerAddresses localhost:9051 \
  --tlsRootCertFiles "$TEST_NETWORK_DIR/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"

echo "🔍 Querying committed chaincodes..."
peer lifecycle chaincode querycommitted --channelID mychannel

echo "🎯 Initializing chaincode..."
peer chaincode invoke \
  -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --tls \
  --cafile "$TEST_NETWORK_DIR/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem" \
  -C mychannel \
  -n basic \
  --peerAddresses localhost:7051 \
  --tlsRootCertFiles "$TEST_NETWORK_DIR/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
  --peerAddresses localhost:9051 \
  --tlsRootCertFiles "$TEST_NETWORK_DIR/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" \
  -c '{"function":"InitLedger","Args":[]}'

# Retourner au répertoire original
cd "$WORK_DIR"

echo "✅ Chaincode déployé avec succès!"
echo ""
echo "🔗 Vous pouvez maintenant utiliser les endpoints API pour interagir avec la blockchain:"
echo "- POST /fabric/assets - Créer un asset"
echo "- GET /fabric/assets - Récupérer tous les assets"
echo "- GET /fabric/assets/:id - Récupérer un asset spécifique"
echo "- PUT /fabric/assets/:id - Mettre à jour un asset"
echo "- DELETE /fabric/assets/:id - Supprimer un asset"
echo "- POST /fabric/assets/:id/transfer - Transférer un asset"
