const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
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

const PROMPT = `Expert web pour Humio (agence TPE/artisans Normandie). Analyse le site fourni.
Tu recevras le contenu HTML réel du site. Base ton analyse UNIQUEMENT sur ce contenu visible, pas sur des suppositions.
IMPORTANT : réponds avec UNIQUEMENT l'objet JSON brut. Pas de balises markdown, pas de backticks, pas d'explication, juste le JSON.
Format attendu :
{"nom_entreprise":"string","secteur":"string","score_global":42,"resume":"2-3 phrases","criteres":[{"id":"seo","nom":"Référencement Google","score":30,"etat":"critique","problemes":["pb1","pb2"],"impact":"impact chiffré","recommandation":"solution"},{"id":"google_business","nom":"Fiche Google Business","score":25,"etat":"critique","problemes":["pb1"],"impact":"impact","recommandation":"solution"},{"id":"mobile","nom":"Compatibilité mobile","score":40,"etat":"faible","problemes":["pb1"],"impact":"impact","recommandation":"solution"},{"id":"design","nom":"Design et modernité","score":25,"etat":"critique","problemes":["pb1","pb2"],"impact":"impact","recommandation":"solution"},{"id":"contenu","nom":"Contenu et messages","score":50,"etat":"moyen","problemes":["pb1"],"impact":"impact","recommandation":"solution"},{"id":"confiance","nom":"Éléments de confiance","score":20,"etat":"critique","problemes":["pb1","pb2"],"impact":"impact","recommandation":"solution"}],"points_positifs":["point"],"top_3_actions":["action1","action2","action3"],"potentiel":"phrase motivante"}
États: critique=0-30, faible=31-50, moyen=51-70, bon=71-100.`;

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch {}
  const clean = text
    .replace(/^```json\s*/m, '')
    .replace(/^```\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  try { return JSON.parse(clean); } catch {}
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch (err) {
      console.error('[PARSE ERROR]', err.message);
    }
  }
  return null;
}

async function fetchSiteContent(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HumioAuditBot/1.0)' },
      signal: AbortSignal.timeout(10000)
    });
    const html = await response.text();
    // Extraire les balises meta importantes
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/i);
    const title = titleMatch ? titleMatch[1] : '';
    const desc = descMatch ? descMatch[1] : '';
    // Extraire le texte visible
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 7000);
    return `TITRE : ${title}\nDESCRIPTION META : ${desc}\nCONTENU : ${text}`;
  } catch (err) {
    console.warn('[FETCH WARN]', err.message);
    return null;
  }
}

app.post('/api/analyze', limiter, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL manquante' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante' });

  const cleanUrl = url.startsWith('http') ? url.trim() : `https://${url.trim()}`;
  console.log(`[ANALYZE] ${new Date().toISOString()} | ${cleanUrl}`);

  // Récupérer le vrai contenu du site
  const siteContent = await fetchSiteContent(cleanUrl);
  const userMessage = siteContent
    ? `Analyse ce site : ${cleanUrl}\n\nContenu réel récupéré :\n---\n${siteContent}\n---\nRappel : réponds avec l'objet JSON uniquement, sans markdown ni backticks.`
    : `Analyse ce site : ${cleanUrl}. Rappel : réponds avec l'objet JSON uniquement, sans markdown ni backticks.`;

  console.log(`[CONTENT] ${siteContent ? siteContent.length + ' chars' : 'non récupéré'}`);

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
        max_tokens: 4000,
        system: PROMPT,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[API ERROR]', err);
      return res.status(500).json({ error: `Erreur API ${response.status}` });
    }

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    console.log('[RAW RESPONSE]', text.slice(0, 100));

    const result = extractJSON(text);
    if (!result) {
      console.error('[JSON ERROR] Impossible de parser:', text.slice(0, 300));
      return res.status(500).json({ error: 'Réponse invalide, réessayez.' });
    }

    console.log(`[SUCCESS] ${result.nom_entreprise} — score ${result.score_global}`);
    res.json(result);

  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'Humio Audit API' }));
app.listen(PORT, () => console.log(`🚀 Humio Audit API — port ${PORT}`));
