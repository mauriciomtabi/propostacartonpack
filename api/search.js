const https = require('https');

/**
 * Vercel Serverless Function: /api/search
 * 
 * Uses Google Custom Search to find Brazilian companies by CNAE/sector/city,
 * then enriches each result with CNPJá open API data.
 * 
 * Query params: cnae, uf, municipio, sector (sector name for display)
 */

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX      = process.env.GOOGLE_CX;

// Extract all CNPJ patterns from a text string
function extractCNPJs(text) {
  const patterns = [
    /\b(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})\b/g,  // XX.XXX.XXX/XXXX-XX
    /\bCNPJ[:\s]*(\d{14})\b/gi,                            // CNPJ: 14digits
    /\b(\d{14})\b/g,                                       // 14 raw digits
  ];
  const found = new Set();
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const raw = m[0].replace(/\D/g, '');
      if (raw.length === 14 && isValidCNPJ(raw)) {
        found.add(raw);
      }
    }
  }
  return [...found];
}

// CNPJ check-digit validation
function isValidCNPJ(cnpj) {
  if (!cnpj || cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false; // all same digits
  
  const calc = (len) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += parseInt(cnpj.charAt(len - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === parseInt(cnpj.charAt(12)) && calc(13) === parseInt(cnpj.charAt(13));
}

// Fetch from Google Custom Search API
async function googleSearch(query) {
  return new Promise((resolve, reject) => {
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=10&gl=br&hl=pt`;
    
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { reject(new Error('Invalid JSON from Google')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Google timeout')); });
    req.on('error', reject);
  });
}

// Fetch company details from CNPJá
async function fetchCNPJa(cnpj) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://open.cnpja.com/office/${cnpj}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
      timeout: 8000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Invalid JSON from CNPJá')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('CNPJá timeout')); });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const { cnae, uf, municipio, sector } = req.query;

  if (!cnae || !uf || !municipio) {
    res.status(400).json({ error: 'Params required: cnae, uf, municipio' });
    return;
  }

  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    res.status(500).json({ error: 'GOOGLE_API_KEY and GOOGLE_CX env vars not configured' });
    return;
  }

  try {
    // Build Google search queries to find companies with CNPJs
    // We search multiple patterns to maximize CNPJ discovery
    const city = decodeURIComponent(municipio);
    const sectorName = sector ? decodeURIComponent(sector) : cnae;
    
    const queries = [
      `CNPJ empresa "${city}" ${uf} CNAE ${cnae} ativa`,
      `site:cnpj.biz "${sectorName}" "${city}"`,
      `"${city}" ${uf} CNPJ "${sectorName}" empresa`,
    ];

    console.log('[search] Queries:', queries);

    // Run first query, fallback to others if needed
    let allCNPJs = [];
    
    for (const query of queries) {
      if (allCNPJs.length >= 5) break;
      
      try {
        const { status, data } = await googleSearch(query);
        if (status !== 200 || !data.items) continue;
        
        // Extract CNPJs from all result snippets, titles, URLs
        for (const item of data.items) {
          const text = `${item.title || ''} ${item.snippet || ''} ${item.link || ''}`;
          const found = extractCNPJs(text);
          for (const cnpj of found) {
            if (!allCNPJs.includes(cnpj)) allCNPJs.push(cnpj);
          }
          if (allCNPJs.length >= 5) break;
        }
        
        console.log(`[search] Query "${query.slice(0,50)}..." → ${allCNPJs.length} CNPJs so far`);
      } catch(e) {
        console.warn('[search] Query failed:', e.message);
      }
    }

    if (allCNPJs.length === 0) {
      res.status(200).json({ results: [], source: 'google', message: 'Nenhum CNPJ encontrado via Google para esta busca' });
      return;
    }

    // Enrich each CNPJ with CNPJá data (parallel, max 5)
    const toFetch = allCNPJs.slice(0, 5);
    console.log('[search] Enriching CNPJs:', toFetch);
    
    const enriched = await Promise.all(
      toFetch.map(cnpj =>
        fetchCNPJa(cnpj).catch(e => ({ _error: e.message, _cnpj: cnpj }))
      )
    );

    const results = enriched.filter(r => !r._error && r.company);
    
    console.log(`[search] Final: ${results.length} enriched results`);
    res.status(200).json({ results, source: 'google+cnpja', cnpjsFound: allCNPJs.length });

  } catch(err) {
    console.error('[search] Error:', err);
    res.status(500).json({ error: err.message });
  }
};
