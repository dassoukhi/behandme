# NestJS Supabase Backend avec Hyperledger Fabric

A robust backend application built with NestJS and integrated with Supabase for authentication and database operations, plus Hyperledger Fabric for blockchain functionality.

## Features

- NestJS architecture with modular design
- Supabase integration for database operations
- User authentication with Supabase Auth
- CRUD operations for user profiles
- **Hyperledger Fabric blockchain integration**
- **Asset management on blockchain**
- **Fabric network management scripts**
- Request validation and error handling
- Environment configuration management
- Logging system
- API documentation with Swagger

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Supabase account and project
- **Docker et Docker Compose** (pour Hyperledger Fabric)
- **Git** (pour cloner les exemples Fabric)

## Environment Setup

1. Copy the `.env.example` file to a new file named `.env`:
   ```
   cp .env.example .env
   ```

2. Update the `.env` file with your Supabase credentials:
   ```
   SUPABASE_URL=https://your-project-url.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   PORT=3000
   NODE_ENV=development
   ```

## Database Setup

The application requires a `profiles` table in your Supabase database. You can create it by running the SQL migration in `supabase/migrations/create_profiles_table.sql`.

## Installation

```bash
# Install dependencies
npm install

# Development
npm run start:dev

# Production build
npm run build
npm run start:prod
```

## API Documentation

Once the application is running, you can access the Swagger documentation at:
```
http://localhost:3007/api/docs
```

## API Endpoints

### Authentication
- `POST /api/v1/auth/sign-up` - Register a new user
- `POST /api/v1/auth/sign-in` - User sign in
- `POST /api/v1/auth/sign-out` - User sign out

### Users
- `GET /api/v1/users` - Get all user profiles
- `GET /api/v1/users/:id` - Get a user profile by ID
- `POST /api/v1/users` - Create a new user profile
- `PATCH /api/v1/users/:id` - Update a user profile
- `DELETE /api/v1/users/:id` - Delete a user profile


## 🔗 Hyperledger Fabric Integration

Ce projet inclut une intégration complète avec Hyperledger Fabric pour la gestion d'assets sur blockchain.

### Mise en Place du Réseau Fabric

Pour interagir avec la blockchain, vous devez d'abord télécharger les composants Hyperledger Fabric, puis démarrer le réseau de test.

**Étape 1 : Télécharger les composants Fabric**

Cette commande télécharge les binaires et les exemples de `fabric-samples` dans un répertoire `fabric-network/` qui est ignoré par Git.
**Vous ne devez exécuter cette commande qu'une seule fois lors de la configuration initiale du projet.**

```bash
bash scripts/download-fabric.sh
```

**Étape 2 : Démarrer le réseau et déployer le Chaincode**

Une fois les composants téléchargés, ce script démarre le réseau Fabric, crée un canal et déploie le chaincode.

```bash
# Configurer et démarrer le réseau complet
npm run fabric:setup

npm run start
```

Vous pouvez également utiliser les commandes npm correspondantes elles sont configurées dans votre `package.json`.

### Commandes Fabric disponibles

```bash
# Configurer et démarrer le réseau complet
npm run fabric:setup

# Démarrer uniquement le réseau
npm run fabric:up

# Arrêter le réseau
npm run fabric:down
```

### Documentation détaillée

Pour une documentation complète sur l'intégration Fabric, consultez [FABRIC_INTEGRATION.md](./FABRIC_INTEGRATION.md).

### Exemples d'utilisation

Des exemples d'appels API sont disponibles dans [examples/fabric-api-examples.http](./examples/fabric-api-examples.http).

## License

This project is licensed under the MIT License.
