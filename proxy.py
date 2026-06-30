"""
Proxy CORS local para a apresentação Carton Pack.
Roda em Python puro (sem dependências externas).
Encaminha chamadas da página para a API Speedio e CNPJá.

Como usar:
  1. Abra um terminal nesta pasta
  2. Execute: python proxy.py
  3. Abra o index.html no navegador
  4. Mantenha o terminal aberto durante a apresentação!
"""

import http.server
import urllib.request
import urllib.parse
import json
import threading

PORT = 3456

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    
    def log_message(self, format, *args):
        print(f"[PROXY] {args[0]} {args[1]}")

    def send_cors_headers(self, status=200, content_type='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_OPTIONS(self):
        self.send_cors_headers(204)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = parsed.query

        if path.startswith('/speedio'):
            target_path = path.replace('/speedio', '', 1) + ('?' + query if query else '')
            target_url = f'https://api-publica.speedio.com.br{target_path}'
        elif path.startswith('/cnpja'):
            target_path = path.replace('/cnpja', '', 1) + ('?' + query if query else '')
            target_url = f'https://open.cnpja.com{target_path}'
        else:
            self.send_cors_headers(404)
            self.wfile.write(json.dumps({'error': 'Unknown route'}).encode())
            return

        print(f"  → {target_url}")

        try:
            req = urllib.request.Request(
                target_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'pt-BR,pt;q=0.9',
                }
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = resp.read()
                self.send_cors_headers(resp.status)
                self.wfile.write(data)
                print(f"  ✅ {resp.status} ({len(data)} bytes)")
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_cors_headers(e.code)
            self.wfile.write(body)
            print(f"  ❌ HTTP {e.code}")
        except Exception as e:
            self.send_cors_headers(502)
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            print(f"  ❌ Erro: {e}")


if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), ProxyHandler)
    print()
    print('╔══════════════════════════════════════════════════════╗')
    print(f'║  ✅ Proxy CORS Carton Pack rodando!                  ║')
    print(f'║     http://localhost:{PORT}                          ║')
    print('╚══════════════════════════════════════════════════════╝')
    print()
    print('  Rotas:')
    print(f'  → Speedio: http://localhost:{PORT}/speedio/buscarbi?cnae=...')
    print(f'  → CNPJá:   http://localhost:{PORT}/cnpja/office/CNPJ')
    print()
    print('  ⚠️  Mantenha este terminal aberto durante a apresentação!')
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Proxy encerrado.')
        server.shutdown()
