import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Botão de impressão com um menuzinho pra escolher o formato (Térmica ou A4)
// na hora, sem precisar ir em Configurações. Usa como padrão o formato salvo
// em Configurações → Impressora (formatoPadrao), mas deixa escolher outro só
// pra essa impressão.
export default function ImprimirMenu({ onImprimir, formatoPadrao = 'termica', label = '🖨️', title = 'Imprimir', small = false }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e) {
      const dentro = (ref.current && ref.current.contains(e.target)) || (menuRef.current && menuRef.current.contains(e.target));
      if (!dentro) setAberto(false);
    }
    const fechar = () => setAberto(false);
    document.addEventListener('mousedown', aoClicarFora);
    window.addEventListener('resize', fechar);
    window.addEventListener('scroll', fechar, true);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora);
      window.removeEventListener('resize', fechar);
      window.removeEventListener('scroll', fechar, true);
    };
  }, [aberto]);

  // O menu é desenhado por cima de tudo (fora da tabela), senão a tabela corta ou esconde as opções.
  function alternar() {
    if (!aberto && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const altura = 120; // altura aproximada do menu
      const abreParaCima = r.bottom + altura > window.innerHeight && r.top > altura;
      // Com o zoom automático da tela as medidas do navegador vêm ampliadas: divide por z para o menu cair no lugar certo.
      const z = parseFloat(document.documentElement.style.zoom) || 1;
      setPos({ right: Math.max(8, window.innerWidth - r.right) / z, top: abreParaCima ? undefined : (r.bottom + 4) / z, bottom: abreParaCima ? (window.innerHeight - r.top + 4) / z : undefined });
    }
    setAberto((a) => !a);
  }

  function escolher(formato) {
    setAberto(false);
    onImprimir(formato);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={ref}>
      <button
        type="button"
        className={small ? 'btn btn-secondary btn-sm' : 'icon-btn'}
        title={title}
        onClick={alternar}
      >
        {small ? <>{label} Imprimir</> : label}
      </button>
      {aberto && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', right: pos.right, top: pos.top, bottom: pos.bottom, zIndex: 1000,
            background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: 'var(--shadow)', minWidth: 190, padding: 4,
          }}
        >
          <button
            type="button"
            className="nav-item"
            style={{ width: '100%', justifyContent: 'flex-start', fontWeight: formatoPadrao === 'termica' ? 700 : 500 }}
            onClick={() => escolher('termica')}
          >
            🧾 Cupom Térmico{formatoPadrao === 'termica' ? ' (padrão)' : ''}
          </button>
          <button
            type="button"
            className="nav-item"
            style={{ width: '100%', justifyContent: 'flex-start', fontWeight: formatoPadrao === 'a4' ? 700 : 500 }}
            onClick={() => escolher('a4')}
          >
            📄 Folha A4{formatoPadrao === 'a4' ? ' (padrão)' : ''}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
