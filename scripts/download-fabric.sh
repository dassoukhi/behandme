#!/bin/bash
# Ce script télécharge les binaires et les exemples de Hyperledger Fabric nécessaires au projet.

set -e

echo "🚀 Téléchargement des composants Hyperledger Fabric avec le script officiel..."

# Création du répertoire cible
mkdir -p fabric-network
cd fabric-network

# Téléchargement du script d'installation officiel de Fabric
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh

# Exécution du script avec une sortie verbeuse
echo "🔍 Exécution de install-fabric.sh..."
./install-fabric.sh

echo "✅ Script d'installation exécuté."
echo "🔍 Contenu du répertoire 'fabric-network' :"
ls -lR

echo "🎉 Configuration terminée ! Vous pouvez maintenant lancer le réseau avec 'scripts/setup-fabric.sh'."
