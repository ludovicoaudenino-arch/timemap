import React from "react";

/**
 * ZoomControls: il selettore del livello di dettaglio, nella fascia libera a
 * destra della timeline.
 *
 * Ogni livello e' un'ampiezza di finestra, in minuti, e determina di
 * conseguenza la grana con cui i dati vengono mostrati: mesi interi si leggono
 * per giornate, una giornata per ore, un'ora a blocchi di dieci minuti, e sotto
 * quella soglia le sessioni compaiono una per una. Le voci arrivano da
 * `app.timeline.zoomLevels` (config.js), non sono scritte qui.
 *
 * Il livello attivo e' quello la cui durata e' piu' vicina all'ampiezza
 * corrente: l'utente puo' anche trascinare la timeline a mano, quindi
 * l'ampiezza non coincide quasi mai in modo esatto con un livello.
 */
function activeIndex(levels, extent) {
  if (!extent) return -1;

  let best = -1;
  let bestDistance = Infinity;

  levels.forEach((level, idx) => {
    // Distanza in rapporto, non in differenza: fra "un giorno" e "un'ora" ci
    // sono 1380 minuti, ma fra "un'ora" e "dieci minuti" solo 50, e in scala
    // logaritmica i due salti pesano quasi uguale.
    const ratio = level.duration / extent;
    const distance = Math.abs(Math.log(ratio));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = idx;
    }
  });

  return best;
}

const TimelineZoomControls = ({ extent, zoomLevels, dims, onApplyZoom }) => {
  const levels = Array.isArray(zoomLevels) ? zoomLevels : [];
  if (levels.length === 0) return null;

  const active = activeIndex(levels, extent);

  return (
    <g
      className="zoom-controls"
      transform={`translate(${dims.width - dims.width_controls + 8}, 0)`}
    >
      <text className="zoom-level-title" x="0" y="16">
        VISTA
      </text>
      {levels.map((level, idx) => (
        <text
          className={`zoom-level-button ${idx === active ? "active" : ""}`}
          x="0"
          y={idx * 16 + 34}
          onClick={() => onApplyZoom(level)}
          key={level.label}
        >
          {level.label}
        </text>
      ))}
    </g>
  );
};

export default TimelineZoomControls;
