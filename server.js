const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── CORS : autorise ton site Humio uniquement ───────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('Non autorisé par CORS'));
    }
  }
}));

app.use(express.json());

// ─── RATE LIMIT : 5 analyses par IP par heure ────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite atteinte. Réessayez dans une heure.' }
});

// ─── PROMPT SYSTÈME ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un expert web pour Humio, agence spécialisée en sites vitrine pour TPE et artisans (Normandie).
Analyse le site fourni en utilisant la recherche web. Sois précis, concret, et justifie chaque problème identifié.

Réponds UNIQUEMENT en JSON valide (aucun texte avant ou après) :
{
  "nom_entreprise": "string",
  "secteur": "string",
  "annee_site_estimee": "string (ex: 2015-2018)",
  "score_global": 42,
  "resume": "2-3 phrases percutantes sur les problèmes principaux",
  "criteres": [
    {
      "id": "seo",
      "nom": "Référencement Google",
      "score": 30,
      "etat": "critique",
      "problemes": ["problème concret 1", "problème concret 2"],
      "impact": "Explication de l'impact business si non corrigé (1 phrase avec chiffre si possible)",
      "recommandation": "Ce que Humio ferait concrètement"
    },
    { "id": "google_business", "nom": "Fiche Google Business", "score": 25, "etat": "critique",
      "problemes": ["problème 1", "problème 2"],
      "impact": "impact business",
      "recommandation": "solution Humio" },
    { "id": "mobile", "nom": "Compatibilité mobile", "score": 40, "etat": "faible",
      "problemes": ["problème 1"],
      "impact": "impact business",
      "recommandation": "solution Humio" },
    { "id": "design", "nom": "Design et modernité", "score": 25, "etat": "critique",
      "problemes": ["problème 1", "problème 2"],
      "impact": "impact business",
      "recommandation": "solution Humio" },
    { "id": "contenu", "nom": "Contenu et messages", "score": 50, "etat": "moyen",
      "problemes": ["problème 1"],
      "impact": "impact business",
      "recommandation": "solution Humio" },
    { "id": "confiance", "nom": "Éléments de confiance", "score": 20, "etat": "critique",
      "problemes": ["problème 1", "problème 2"],
      "impact": "impact business",
      "recommandation": "solution Humio" }
  ],
  "points_positifs": ["point positif si applicable"],
  "top_3_actions": ["action prioritaire 1", "action prioritaire 2", "action prioritaire 3"],
  "potentiel": "Phrase motivante et concrète sur ce qu'une refonte Humio apporterait"
}
États: critique=0-30, faible=31-50, moyen=51-70, bon=71-100. Sois précis et justifie avec des chiffres quand possible.`;

// ─── HELPER : appel Anthropic avec gestion multi-tours ───────────────────────
async function callAnthropic(messages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante');

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err.slice(0, 200)}`);
  }

  return res.json();
}

function extractJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = clean.indexOf('{');
  const e = clean.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(clean.slice(s, e + 1)); } catch { return null; }
}

// ─── ROUTE PRINCIPALE ─────────────────────────────────────────────────────────
app.post('/api/analyze', limiter, async (req, res) => {
  const { url, email } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL manquante ou invalide' });
  }

  const cleanUrl = url.startsWith('http') ? url.trim() : `https://${url.trim()}`;

  // Log optionnel pour capturer les leads (email)
  if (email) {
    console.log(`[LEAD] ${new Date().toISOString()} | ${email} | ${cleanUrl}`);
    // TODO: Envoyer vers ton CRM ou ton email ici
  }

  try {
    let messages = [{
      role: 'user',
      content: `Analyse ce site web : ${cleanUrl}. Utilise la recherche web pour trouver des informations réelles sur ce site et cette entreprise. Retourne uniquement le JSON demandé.`
    }];

    let data = await callAnthropic(messages);
    let turns = 0;

    // Gestion multi-tours pour la recherche web
    while (data.stop_reason === 'tool_use' && turns < 4) {
      turns++;
      messages.push({ role: 'assistant', content: data.content });

      const toolResults = (data.content || [])
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: [{ type: 'text', text: 'Recherche effectuée. Continue l\'analyse.' }]
        }));

      messages.push({ role: 'user', content: toolResults });
      data = await callAnthropic(messages);
    }

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const result = extractJSON(text);
    if (!result) return res.status(500).json({ error: 'Analyse impossible, réessayez.' });

    res.json(result);

  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: 'Erreur serveur. Réessayez dans quelques secondes.' });
  }
});

// ─── HEALTHCHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'Humio Audit API' }));

app.listen(PORT, () => {
  console.log(`🚀 Humio Audit API démarré sur le port ${PORT}`);
});
