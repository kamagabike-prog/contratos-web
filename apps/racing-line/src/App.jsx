import React, { useState } from 'react';
import CircuitSelector from './views/CircuitSelector.jsx';
import LiveView from './views/LiveView.jsx';
import AnalysisView from './views/AnalysisView.jsx';
import { getCircuit, hasGeometry } from './data/circuits.js';

const TABS = [
  { id: 'circuits', label: '1. Circuitos', icon: '◰' },
  { id: 'live', label: '2. Pista', icon: '●' },
  { id: 'analysis', label: '3. Análisis', icon: '◫' },
];

const loadPref = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const savePref = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignorado */
  }
};

export default function App() {
  const [tab, setTab] = useState('circuits');
  const [circuitId, setCircuitId] = useState(() => {
    const id = loadPref('racing-line:circuit', 'jerez');
    return hasGeometry(getCircuit(id)) ? id : 'jerez';
  });
  const [sessionId, setSessionId] = useState(null);
  const circuit = getCircuit(circuitId);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-edge bg-[#09090b]/95 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
            <path d="M4 17c-1-5 2-10 8-10s8 3 7 6-4 3-5 1-3-1-3 2-5 4-7 1z" fill="none" stroke="#22c55e" strokeWidth="2" />
            <path d="M5 16c-.5-4 2-8 7-8.5" fill="none" stroke="#ef4444" strokeWidth="2" />
          </svg>
          <span className="font-bold tracking-tight">
            Racing<span className="text-ideal">Line</span>
          </span>
        </div>
        <span className="font-mono text-xs text-zinc-400">{circuit.short}</span>
      </header>

      <main className={`min-h-0 flex-1 ${tab === 'live' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {tab === 'circuits' && (
          <CircuitSelector
            selectedId={circuitId}
            onSelect={(id) => {
              setCircuitId(id);
              savePref('racing-line:circuit', id);
              setTab('live');
            }}
          />
        )}
        {tab === 'live' && (
          <LiveView
            key={circuitId}
            circuit={circuit}
            onFinished={(id) => {
              setSessionId(id);
              setTab('analysis');
            }}
          />
        )}
        {tab === 'analysis' && (
          <AnalysisView sessionId={sessionId} onSelectSession={setSessionId} onGoLive={() => setTab('live')} />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-edge bg-[#09090b]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold uppercase tracking-wider transition ${
                tab === t.id ? 'text-zinc-50' : 'text-zinc-500'
              }`}
            >
              <span className={`text-lg leading-none ${tab === t.id ? (t.id === 'live' ? 'text-rider' : 'text-ideal') : ''}`}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
