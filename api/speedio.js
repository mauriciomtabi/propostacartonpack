const https = require('https');
const url = require('url');

module.exports = async (req, res) => {
  // CORS — allow any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { cnae, uf, municipio } = req.query;

  if (!cnae || !uf || !municipio) {
    res.status(400).json({ error: 'Params required: cnae, uf, municipio' });
    return;
  }

  const targetUrl = `https://api-publica.speedio.com.br/buscarbi?cnae=${encodeURIComponent(cnae)}&uf=${encodeURIComponent(uf)}&municipio=${encodeURIComponent(municipio)}`;

  try {
    const data = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api-publica.speedio.com.br',
        path: `/buscarbi?cnae=${encodeURIComponent(cnae)}&uf=${encodeURIComponent(uf)}&municipio=${encodeURIComponent(municipio)}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'Referer': 'https://www.speedio.com.br/',
        },
        timeout: 12000,
      };

      const proxyReq = https.request(options, (proxyRes) => {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          try {
            resolve({ status: proxyRes.statusCode, body: JSON.parse(body) });
          } catch {
            reject(new Error('Invalid JSON from upstream'));
          }
        });
      });

      proxyReq.on('timeout', () => { proxyReq.destroy(); reject(new Error('Upstream timeout')); });
      proxyReq.on('error', reject);
      proxyReq.end();
    });

    res.status(data.status).json(data.body);
  } catch (err) {
    console.error('[speedio proxy error]', err.message);
    res.status(502).json({ error: err.message });
  }
};
