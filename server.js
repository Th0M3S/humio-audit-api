const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
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
  windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Limite atteinte. Réessayez dans une heure.' }
});

const SYSTEM_PROMPT = `Tu es un expert web pour Humio, agence spécialisée en sites vitrine pour TPE et artisans (Normandie).
Analyse le site fourni. Sois précis, concret, et justifie chaque problème identifié.

Réponds UNIQUEMENT en JSON valide (aucun texte avant ou après) :
{
  "nom_entreprise": "string",
  "secteur": "string",
  "score_global": 42,
  "resume": "2-3 phrases percutantes sur les problèmes principaux",
  "criteres": [
    {"id":"seo","nom":"Référencement Google","score":30,"etat":"critique","problemes":["pb 1","pb 2"],"impact":"impact business chiffré","recommandation":"solution Humio"},
    {"id":"google_business","nom":"Fiche Google Business","score":25,"etat":"critique","problemes":["pb 1","pb 2"],"impact":"impact business","recommandation":"solution Humio"},
    {"id":"mobile","nom":"Compatibilité mobile","score":40,"etat":"faible","problemes":["pb 1"],"impact":"impact business","recommandation":"solution Humio"},
    {"id":"design","nom":"Design et modernité","score":25,"etat":"critique","problemes":["pb 1","pb 2"],"impact":"impact business","recommandation":"solution Humio"},
    {"id":"contenu","nom":"Contenu et messages","score":50,"etat":"moyen","problemes":["pb 1"],"impact":"impact business","recommandation":"solution Humio"},
    {"id":"confiance","nom":"Éléments de confiance","score":20,"etat":"critique","problemes":["pb 1","pb 2"],"impact":"impact business","recommandation":"solution Humio"}
  ],
  "points_positifs": ["point positif"],
  "top_3_actions": ["action 1","action 2","action 3"],
  "potentiel": "phrase motivante sur l'impact d'une refonte par Humio"
}
États: critique=0-30, faible=31-50, moyen=51-70, bon=71-100.`;

async function callAnthropic(messages, useSearch) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante dans les variables Railway');

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages
  };

  if (useSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(useSearch ? { 'anthropic-beta': 'web-search-2025-03-05' } : {})
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic ${res.status}: ${errText}`);
  }
  return res.json();
}

function extractJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(clean.slice(s, e + 1)); } catch { return null; }
}

app.post('/api/analyze', limiter, async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL manquante' });

  const cleanUrl = url.startsWith('http') ? url.trim() : `https://${url.trim()}`;
  console.log(`[ANALYZE] ${new Date().toISOString()} | ${cleanUrl}`);

  // Tentative 1 : avec recherche web
  try {
    let messages = [{ role: 'user', content: `Analyse ce site : ${cleanUrl}. Retourne uniquement le JSON.` }];
    let data = await callAnthropic(messages, true);
    let turns = 0;

    while (data.stop_reason === 'tool_use' && turns < 4) {
      turns++;
      messages.push({ role: 'assistant', content: data.content });
      const toolResults = (data.content || [])
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: [{ type: 'text', text: 'Recherche effectuée.' }] }));
      messages.push({ role: 'user', content: toolResults });
      data = await callAnthropic(messages, true);
    }

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const result = extractJSON(text);
    if (result) return res.json(result);
    throw new Error('JSON introuvable dans la réponse');

  } catch (err1) {
    console.error('[SEARCH ERROR]', err1.message);

    // Tentative 2 : sans recherche web (fallback)
    try {
      const data = await callAnthropic([{
        role: 'user',
        content: `Analyse ce site : ${cleanUrl}. Génère un diagnostic réaliste basé sur l'URL et les problèmes typiques de ce type de site. Retourne uniquement le JSON.`
      }], false);

      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const result = extractJSON(text);
      if (result) return res.json(result);
      throw new Error('JSON introuvable');

    } catch (err2) {
      console.error('[FALLBACK ERROR]', err2.message);
      return res.status(500).json({
        error: `Analyse impossible. Détail : ${err2.message.slice(0, 200)}`
      });
    }
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'Humio Audit API', model: 'claude-sonnet-4-6' }));

app.listen(PORT, () => console.log(`🚀 Humio Audit API — port ${PORT}`));
