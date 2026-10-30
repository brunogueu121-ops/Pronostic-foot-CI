# Backend PronosticFoot CI (squelette sécurisé)

Ce backend n'est pas encore relié à un fournisseur sportif ou à une base de données.

## Configuration à prévoir
- Node.js 20+
- `npm init -y`
- `npm install express helmet express-rate-limit cors dotenv bcrypt express-session connect-sqlite3 better-sqlite3`
- Ajouter un fournisseur API football côté serveur, garder sa clé dans `.env`, jamais dans l'application.
- Déployer derrière HTTPS et configurer cookies `Secure`, `HttpOnly`, `SameSite`.
- Créer le compte administrateur via une commande de provisioning sécurisée (mot de passe haché, jamais en dur).
- Protéger les routes d'écriture par session, contrôle d'accès, validation et journalisation.
- Pour les données sportives, afficher source et horodatage; respecter les limites de licence et de requêtes du fournisseur.

## Contrat API attendu par l'application
`GET /health` → `{ "status": "ok" }`
`GET /api/matches` → `{ "source": "nom du fournisseur", "updated_at": "...", "matches": [...] }`

Chaque match: `id`, `competition`, `home_team`, `away_team`, `kickoff` (ISO 8601), `status` (`SCHEDULED`, `LIVE`, `FINISHED`), facultativement `home_score`, `away_score`, `venue`, `prediction`, `prediction_note`, `details`.

L'interface désactive volontairement l'administration tant que le serveur n'a pas une authentification implémentée.

## Squelette fourni
- `server.js`: proxy de matchs football-data.org, route santé, début de login admin et rate limiting.
- `package.json`: dépendances.
- `.env.example`: variables à configurer.
- Le fournisseur peut limiter les compétitions disponibles selon l'offre. Vérifie notamment la disponibilité du championnat ivoirien avant de choisir l'API. La documentation officielle décrit les matchs et filtres, mais la couverture exacte dépend des droits du compte.
- Le stockage de session par défaut d'Express est uniquement pour le développement. En production, utiliser un magasin de sessions persistant, HTTPS, sauvegardes, monitoring et tests de sécurité.
- Les routes de publication sont volontairement désactivées jusqu'à la mise en place d'une base de données, de validations et d'un journal d'audit.
