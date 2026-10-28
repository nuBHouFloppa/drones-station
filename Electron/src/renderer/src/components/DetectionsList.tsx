import React, { useState } from 'react';
import { Detection, ALL_CLASSES, classColors, classTranslations } from '../types';

interface DetectionsListProps {
  detections: Detection[];
  minConfidence: number;
  onChangeMinConfidence: (val: number) => void;
  enabledClasses: Record<string, boolean>;
  onToggleClass: (cls: string) => void;
}

export const DetectionsList: React.FC<DetectionsListProps> = ({
  detections,
  minConfidence,
  onChangeMinConfidence,
  enabledClasses,
  onToggleClass
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyGps = (det: Detection, idx: number) => {
    if (det.targetLat === undefined || det.targetLng === undefined) return;
    const elevStr = det.targetElevation !== undefined ? ` (выс. ${det.targetElevation}м)` : '';
    const text = `${det.targetLat.toFixed(6)}, ${det.targetLng.toFixed(6)}${elevStr}`;
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1200);
  };

  return (
    <>
      <div className="panel" style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#aaa' }}>
          <span>ПОРОГ УВЕРЕННОСТИ: {Math.round(minConfidence * 100)}%</span>
          <input
            type="range"
            min="0"
            max="0.95"
            step="0.05"
            value={minConfidence}
            onChange={e => onChangeMinConfidence(Number(e.target.value))}
            style={{ width: '160px', accentColor: '#00e5ff', cursor: 'pointer' }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {ALL_CLASSES.map(cls => {
            const active = enabledClasses[cls];
            const color = classColors[cls] || '#fff';
            return (
              <button
                key={cls}
                onClick={() => onToggleClass(cls)}
                style={{
                  background: active ? `${color}22` : '#121212',
                  border: `1px solid ${active ? color : '#333'}`,
                  color: active ? color : '#555',
                  padding: '3px 6px',
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                {classTranslations[cls] || cls}
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '8px', borderBottom: '1px solid #333', fontSize: '11px', letterSpacing: '1px', color: '#888', display: 'flex', justifyContent: 'space-between' }}>
          <span>ЖУРНАЛ ЦЕЛЕЙ // КООРДИНАТЫ (С УЧЕТОМ DEM)</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: '#00e5ff' }}>[{detections.length}]</span>
        </div>

        <div className="hide-scroll" style={{ padding: '8px', overflowY: 'auto', flex: 1 }}>
          {detections.map((det, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
                padding: '6px 0',
                borderBottom: '1px dashed #333',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: classColors[det.class] || '#fff', fontWeight: 'bold' }}>
                  {'>'} {classTranslations[det.class] || det.class}
                </span>
                <span style={{ color: '#aaa' }}>
                  {det.distanceMeters !== undefined ? `~${det.distanceMeters} М | ` : ''}
                  {det.targetElevation !== undefined ? `РЕЛЬЕФ: ${det.targetElevation} М | ` : ''}
                  [{(det.confidence * 100).toFixed(0)}%]
                </span>
              </div>

              {det.targetLat !== undefined && det.targetLng !== undefined && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#888' }}>
                  <span>
                    GPS ЦЕЛИ: <span style={{ color: '#00e5ff' }}>{det.targetLat.toFixed(6)}, {det.targetLng.toFixed(6)}</span>
                  </span>
                  <button
                    onClick={() => handleCopyGps(det, i)}
                    style={{
                      background: 'transparent',
                      border: '1px solid #444',
                      color: copiedIndex === i ? '#00ff00' : '#aaa',
                      fontSize: '10px',
                      padding: '1px 5px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)'
                    }}
                    title="Скопировать координаты и высоту цели"
                  >
                    {copiedIndex === i ? 'СКОПИРОВАНО' : 'КОПИРОВАТЬ'}
                  </button>
                </div>
              )}
            </div>
          ))}
          {detections.length === 0 && (
            <div style={{ color: '#555', fontFamily: 'var(--font-mono)', fontSize: '12px', marginTop: '8px' }}>
              {'>'} ЦЕЛИ НЕ ОБНАРУЖЕНЫ
            </div>
          )}
        </div>
      </div>
    </>
  );
};