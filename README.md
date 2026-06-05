# Humio Audit API

Backend pour l'outil d'audit de site web Humio.

## Déploiement sur Railway (gratuit, 5 minutes)

### 1. Créer un compte Railway
Va sur https://railway.app et connecte-toi avec GitHub.

### 2. Créer un nouveau projet
- Clique sur "New Project"
- Choisis "Deploy from GitHub repo"
- Sélectionne ce repo (ou upload les fichiers)

### 3. Configurer les variables d'environnement
Dans Railway → ton projet → "Variables" :

```
ANTHROPIC_API_KEY = sk-ant-ta-clé-ici
ALLOWED_ORIGINS   = https://humio.fr,https://www.humio.fr
```

### 4. Déployer
Railway détecte automatiquement Node.js et lance `npm start`.
Tu obtiendras une URL comme : `https://humio-audit-api.up.railway.app`

---

## Utilisation dans le frontend

Remplace l'appel API dans le widget par :

```javascript
const r = await fetch('https://TON-URL.up.railway.app/api/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://www.site-client.fr', email: 'prospect@email.fr' })
});
const result = await r.json();
```

---

## Endpoints

- `POST /api/analyze` — Analyse un site web
  - Body: `{ "url": "string", "email": "string (optionnel)" }`
  - Response: JSON avec le diagnostic complet

- `GET /health` — Vérifie que l'API tourne

---

## Coût estimé

- Railway Free : 5$/mois de crédit offert (largement suffisant pour commencer)
- Anthropic Claude Sonnet : ~0,003$ par analyse (moins de 1ct par analyse)
- Pour 100 analyses/mois : ~0,30$ en API + Railway gratuit

---

## Capture de leads

Chaque email soumis est loggué dans la console Railway (Variables → Logs).
Pour l'envoyer vers ton email automatiquement, ajoute dans server.js :

```javascript
// Avec nodemailer ou un webhook Make/Zapier
```
