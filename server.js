const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1); // Fix Railway X-Forwarded-For
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('Non autorisé par CORS'));
  }
}));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  message: { error: 'Limite atteinte. Réessayez dans une heure.' }
});

const PROMPT = `Expert web pour Humio (agence TPE/artisans Normandie). Analyse le site fourni. Réponds UNIQUEMENT en JSON valide, aucun texte avant ou après :
{"nom_entreprise":"string","secteur":"string","score_global":42,"resume":"2-3 phrases sur les problèmes principaux","criteres":[{"id":"seo","nom":"Référencement Google","score":30,"etat":"critique","problemes":["pb1","pb2"],"impact":"impact chiffré","recommandation":"solution"},{"id":"google_business","nom":"Fiche Google Business","score":25,"etat":"critique","problemes":["pb1"],"impact":"impact","recommandation":"solution"},{"id":"mobile","nom":"Compatibilité mobile","score":40,"etat":"faible","problemes":["pb1"],"impact":"impact","recommandation":"solution"},{"id":"design","nom":"Design et modernité","score":25,"etat":"critique","problemes":["pb1","pb2"],"impact":"impact","recommandation":"solution"},{"id":"contenu","nom":"Contenu et messages","score":50,"etat":"moyen","problemes":["pb1"],"impact":"impact","recommandation":"solution"},{"id":"confiance","nom":"Éléments de confiance","score":20,"etat":"critique","problemes":["pb1","pb2"],"impact":"impact","recommandation":"solution"}],"points_positifs":["point"],"top_3_actions":["action1","action2","action3"],"potentiel":"phrase motivante"}
États: critique=0-30, faible=31-50, moyen=51-70, bon=71-100.`;

function extractJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(clean.slice(s, e + 1)); } catch { return null; }
}

app.post('/api/analyze', limiter, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL manquante' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante' });

  const cleanUrl = url.startsWith('http') ? url.trim() : `https://${url.trim()}`;
  console.log(`[ANALYZE] ${new Date().toISOString()} | ${cleanUrl}`);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: PROMPT,
        messages: [{
          role: 'user',
          content: `Analyse ce site : ${cleanUrl}. Génère un diagnostic réaliste basé sur ce que tu sais de ce site ou de ce type d'entreprise. JSON uniquement.`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[API ERROR]', err);
      return res.status(500).json({ error: `Erreur Anthropic ${response.status}` });
    }

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const result = extractJSON(text);

    if (!result) {
      console.error('[JSON ERROR] Reçu:', text.slice(0, 200));
      return res.status(500).json({ error: 'Réponse invalide, réessayez.' });
    }

    res.json(result);

  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'Humio Audit API' }));

app.listen(PORT, () => console.log(`🚀 Humio Audit API — port ${PORT}`));
