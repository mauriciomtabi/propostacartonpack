const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Extract CNPJ from path: /api/cnpja/[cnpj]
  const cnpj = req.query.cnpj || req.url.split('/').pop().replace(/\D/g, '');

  if (!cnpj || cnpj.length !== 14) {
    res.status(400).json({ error: 'CNPJ inválido (14 dígitos)' });
    return;
  }

  try {
    const data = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'open.cnpja.com',
        path: `/office/${cnpj}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        timeout: 10000,
      };

      const proxyReq = https.request(options, (proxyRes) => {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          try {
            resolve({ status: proxyRes.statusCode, body: JSON.parse(body) });
          } catch {
            reject(new Error('Invalid JSON from CNPJá'));
          }
        });
      });

      proxyReq.on('timeout', () => { proxyReq.destroy(); reject(new Error('CNPJá timeout')); });
      proxyReq.on('error', reject);
      proxyReq.end();
    });

    res.status(data.status).json(data.body);
  } catch (err) {
    console.error('[cnpja proxy error]', err.message);
    res.status(502).json({ error: err.message });
  }
};
