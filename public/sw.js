// Service Worker do Reboot Tech (versão web/PWA).
//
// O que ele faz: guarda em cache os arquivos do "esqueleto" do app (HTML, JS,
// CSS, ícones) pra abrir rápido e continuar aparecendo mesmo sem internet ou
// com conexão ruim. Ele NÃO guarda dados do sistema (clientes, OS, vendas
// etc.) — esses sempre vêm direto do servidor (/api/...), nunca do cache,
// pra nunca mostrar informação desatualizada ou de outra loja.
//
// Suba o número da versão sempre que quiser forçar todo mundo a baixar os
// arquivos novos na próxima abertura do app.
const VERSAO_CACHE = 'reboot-tech-v1';

self.addEventListener('install', (evento) => {
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes.filter((nome) => nome.startsWith('reboot-tech-') && nome !== VERSAO_CACHE).map((nome) => caches.delete(nome))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return; // nunca guarda em cache POST/PUT/DELETE (são sempre dados, nunca esqueleto)

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // nunca intercepta chamadas pro servidor de dados (outra origem)
  if (url.pathname.startsWith('/api/')) return; // dados do sistema: sempre da rede, nunca do cache

  // Navegação (abrir/recarregar a página): tenta a rede primeiro (pra sempre
  // pegar a versão mais nova); se não tiver internet, cai pro app salvo em
  // cache, pra pelo menos abrir a tela de login com um aviso, em vez da tela
  // de erro do navegador.
  if (req.mode === 'navigate') {
    evento.respondWith(
      (async () => {
        try {
          const resposta = await fetch(req);
          const cache = await caches.open(VERSAO_CACHE);
          cache.put('./index.html', resposta.clone());
          return resposta;
        } catch (e) {
          const cache = await caches.open(VERSAO_CACHE);
          return (await cache.match('./index.html')) || Response.error();
        }
      })()
    );
    return;
  }

  // Arquivos estáticos do esqueleto (JS/CSS/ícones com hash no nome, gerados
  // pelo build): busca no cache primeiro (abre instantâneo), e vai atualizar
  // o cache por trás pra próxima vez — sem travar a página esperando a rede.
  evento.respondWith(
    (async () => {
      const cache = await caches.open(VERSAO_CACHE);
      const emCache = await cache.match(req);
      const buscaRede = fetch(req)
        .then((resposta) => {
          if (resposta && resposta.ok) cache.put(req, resposta.clone());
          return resposta;
        })
        .catch(() => null);
      return emCache || (await buscaRede) || Response.error();
    })()
  );
});
