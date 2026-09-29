import React, { useEffect, useRef, useState } from 'react';

// Botão de impressão com um menuzinho pra escolher o formato (Térmica ou A4)
// na hora, sem precisar ir em Configurações. Usa como padrão o formato salvo
// em Configurações → Impressora (formatoPadrao), mas deixa escolher outro só
// pra essa impressão.
export default function ImprimirMenu({ onImprimir, formatoPadrao = 'termica', label = '🖨️', title = 'Imprimir', small = false }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e) {
      if (ref.current && !ref.current.contains(e.target)) setAberto(false);
    }
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, [aberto]);

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
        onClick={() => setAberto((a) => !a)}
      >
        {small ? <>{label} Imprimir</> : label}
      </button>
      {aberto && (
        <div
          style={{
            position: 'absolute', right: 0, top: '110%', zIndex: 20,
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
        </div>
      )}
    </div>
  );
}
