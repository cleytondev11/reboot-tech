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
const VERSAO_CACHE = 'reboot-tech-v25';

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

// ---------- NOTIFICAÇÕES PUSH ----------
// Recebe o aviso enviado pelo servidor (OS, orçamento, venda)
// e mostra a notificação no celular, mesmo com o app fechado.
self.addEventListener('push', (evento) => {
  let dados = {};
  try { dados = evento.data ? evento.data.json() : {}; } catch (e) { dados = { corpo: evento.data ? evento.data.text() : '' }; }
  const titulo = dados.titulo || 'Reboot Tech';
  evento.waitUntil(
    (async () => {
      // App aberto? Pede pra tocar o som do tipo de aviso (venda, OS pronta, entregue...).
      if (dados.som) {
        try {
          const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          janelas.forEach((j) => j.postMessage({ tipo: 'rt-som', som: dados.som }));
        } catch (e) { /* ignora */ }
      }
      return self.registration.showNotification(titulo, {
      body: dados.corpo || '',
      icon: './icons/icon-192.png',
      badge: './icons/favicon-32.png',
      tag: dados.tag || undefined,
      renotify: !!dados.tag, // mudou de status de novo? avisa/vibra de novo em vez de trocar em silêncio
      data: { url: dados.url || './' },
      });
    })()
  );
});

// Ao tocar na notificação: foca o app se já estiver aberto, senão abre.
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = new URL((evento.notification.data && evento.notification.data.url) || './', self.registration.scope).href;
  evento.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const j of janelas) {
        if (j.url.startsWith(self.registration.scope) && 'focus' in j) return j.focus();
      }
      return self.clients.openWindow(destino);
    })()
  );
});
