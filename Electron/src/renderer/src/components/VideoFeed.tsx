import React from 'react';

export interface BBox {
  x_center: number;
  y_center: number;
  width: number;
  height: number;
}

export interface Detection {
  class: string;
  confidence: number;
  bbox: BBox;
}

interface VideoFeedProps {
  imageBase64: string;
  detections: Detection[];
  onToggleExpand?: () => void;
  onSnapshot?: () => void;
  isExpanded?: boolean;
}

export const classColors: Record<string, string> = {
  human: '#ff3333',
  transport: '#00e5ff',
  smoke: '#a0a0a0',
  fire: '#ff9900',
  stuff: '#00ff00',
  postburn: '#555555',
};

export const classTranslations: Record<string, string> = {
  human: 'ЧЕЛОВЕК',
  transport: 'ТРАНСПОРТ',
  smoke: 'ДЫМ',
  fire: 'ОГОНЬ',
  stuff: 'ОБЪЕКТ',
  postburn: 'ВЫГОРЕВШАЯ ЗОНА',
};

export const VideoFeed: React.FC<VideoFeedProps> = ({ 
  imageBase64, detections, onToggleExpand, onSnapshot, isExpanded 
}) => {
  if (!imageBase64) {
    return (
      <div style={{ 
        display: 'flex', alignItems: 'center', justifyContent: 'center', 
        width: '100%', aspectRatio: '4/3', backgroundColor: '#1a1a1a', 
        color: '#777', border: '1px solid #333', boxSizing: 'border-box',
        textTransform: 'uppercase', letterSpacing: '1px', fontSize: '12px'
      }}>
        NO SIGNAL / ТРАНСЛЯЦИЯ НЕДОСТУПНА
      </div>
    );
  }

  const imageSrc = imageBase64.startsWith('data:image')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  return (
    <div style={{ 
      position: 'relative', width: '100%', 
      backgroundColor: '#000', overflow: 'hidden', 
      border: '1px solid #333', boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{ position: 'relative', width: '100%', lineHeight: 0 }}>
        <img 
          src={imageSrc} 
          alt="Drone Feed" 
          style={{ width: '100%', height: 'auto', display: 'block', pointerEvents: 'none', userSelect: 'none' }} 
        />

        {/* Прицельное перекрестие */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', width: '20px', height: '1px', background: 'rgba(255,255,255,0.4)', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', width: '1px', height: '20px', background: 'rgba(255,255,255,0.4)', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} />

        {/* Панель кнопок поверх видео */}
        <div style={{ position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '6px', zIndex: 10, lineHeight: 'normal' }}>
          {onSnapshot && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSnapshot();
              }}
              style={{
                background: 'rgba(0,0,0,0.75)', border: '1px solid #00ff00',
                color: '#00ff00', padding: '5px 8px',
                fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold',
                cursor: 'pointer'
              }}
              title="Сохранить кадр с рамками и координатами в PNG"
            >
              [ СНИМОК ]
            </button>
          )}

          {onToggleExpand && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              style={{
                background: 'rgba(0,0,0,0.75)', border: '1px solid #00e5ff',
                color: '#00e5ff', padding: '5px 8px',
                fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              [ УВЕЛИЧИТЬ ]
            </button>
          )}
        </div>

        {/* Отрисовка рамок обнаруженных объектов */}
        {detections.map((det, idx) => {
          const left = Math.max(0, Math.min(100, (det.bbox.x_center - det.bbox.width / 2) * 100));
          const top = Math.max(0, Math.min(100, (det.bbox.y_center - det.bbox.height / 2) * 100));
          const width = Math.min(100 - left, det.bbox.width * 100);
          const height = Math.min(100 - top, det.bbox.height * 100);
          const color = classColors[det.class] || '#ffffff';
          const translatedClass = classTranslations[det.class] || det.class;
          const fontSize = isExpanded ? '14px' : '10px';
          const labelHeightOffset = isExpanded ? '-22px' : '-18px';

          return (
            <div
              key={idx}
              style={{
                position: 'absolute', left: `${left}%`, top: `${top}%`,
                width: `${width}%`, height: `${height}%`,
                border: `1px solid ${color}`,
                boxShadow: `0 0 4px ${color}40 inset, 0 0 4px ${color}40`,
                boxSizing: 'border-box', pointerEvents: 'none',
                lineHeight: 'normal'
              }}
            >
              <div style={{
                position: 'absolute',
                top: top < 6 ? '0px' : labelHeightOffset,
                left: '-1px',
                backgroundColor: color, color: '#000', fontSize: fontSize,
                padding: '2px 4px', fontWeight: 'bold', letterSpacing: '0.5px',
                whiteSpace: 'nowrap', fontFamily: 'monospace'
              }}>
                {translatedClass} [{(det.confidence * 100).toFixed(0)}%]
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};