import React, { useRef, useState, useEffect } from 'react';

// value: string com os índices (1-9) do padrão separados por vírgula, ex: "1,2,3,6,9"
export default function PatternLock({ value, onChange }) {
  const containerRef = useRef(null);
  const draggingRef = useRef(false);
  const selectedRef = useRef(value ? value.split(',').filter(Boolean).map(Number) : []);
  const [selected, setSelected] = useState(selectedRef.current);
  const [dragging, setDragging] = useState(false);
  const [mousePos, setMousePos] = useState(null);

  useEffect(() => {
    const next = value ? value.split(',').filter(Boolean).map(Number) : [];
    selectedRef.current = next;
    setSelected(next);
  }, [value]);

  const SIZE = 180;
  const PAD = 30;
  const STEP = (SIZE - PAD * 2) / 2;

  function dotPos(n) {
    const idx = n - 1;
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    return { x: PAD + col * STEP, y: PAD + row * STEP };
  }

  function dotAtPoint(clientX, clientY) {
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (let n = 1; n <= 9; n++) {
      const p = dotPos(n);
      if (Math.hypot(p.x - x, p.y - y) < 18) return n;
    }
    return null;
  }

  function commit(next) {
    selectedRef.current = next;
    setSelected(next);
    onChange(next.join(','));
  }

  function start(clientX, clientY) {
    const n = dotAtPoint(clientX, clientY);
    if (n) {
      draggingRef.current = true;
      setDragging(true);
      commit([n]);
    }
  }

  function move(clientX, clientY) {
    if (!draggingRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({ x: clientX - rect.left, y: clientY - rect.top });
    const n = dotAtPoint(clientX, clientY);
    if (n && !selectedRef.current.includes(n)) {
      commit([...selectedRef.current, n]);
    }
  }

  function end() {
    draggingRef.current = false;
    setDragging(false);
    setMousePos(null);
  }

  function clear() {
    commit([]);
  }

  return (
    <div>
      <svg
        ref={containerRef}
        width={SIZE}
        height={SIZE}
        style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border)', borderRadius: 10, touchAction: 'none', cursor: 'pointer' }}
        onMouseDown={(e) => start(e.clientX, e.clientY)}
        onMouseMove={(e) => move(e.clientX, e.clientY)}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={(e) => { const t = e.touches[0]; start(t.clientX, t.clientY); }}
        onTouchMove={(e) => { const t = e.touches[0]; move(t.clientX, t.clientY); }}
        onTouchEnd={end}
      >
        {selected.slice(1).map((n, i) => {
          const a = dotPos(selected[i]);
          const b = dotPos(n);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--gold)" strokeWidth={3} strokeLinecap="round" />;
        })}
        {dragging && selected.length > 0 && mousePos && (
          <line x1={dotPos(selected[selected.length - 1]).x} y1={dotPos(selected[selected.length - 1]).y} x2={mousePos.x} y2={mousePos.y} stroke="var(--gold)" strokeWidth={3} strokeLinecap="round" opacity={0.5} />
        )}
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
          const p = dotPos(n);
          const active = selected.includes(n);
          return (
            <g key={n}>
              <circle cx={p.x} cy={p.y} r={14} fill="none" stroke={active ? 'var(--gold)' : 'var(--border)'} strokeWidth={2} />
              <circle cx={p.x} cy={p.y} r={active ? 6 : 4} fill={active ? 'var(--gold)' : 'var(--text-dim)'} />
            </g>
          );
        })}
      </svg>
      <div style={{ marginTop: 6 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Limpar padrão</button>
      </div>
    </div>
  );
}
