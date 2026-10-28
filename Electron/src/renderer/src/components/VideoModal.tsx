import React, { useState } from 'react';
import { Detection } from '../types';
import { VideoFeed } from './VideoFeed';

interface VideoModalProps {
  imageBase64: string;
  detections: Detection[];
  onClose: () => void;
  onSnapshot: () => void;
}

export const VideoModal: React.FC<VideoModalProps> = ({
  imageBase64,
  detections,
  onClose,
  onSnapshot
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  return (
    <div
      className="modal-backdrop"
      onWheel={e => setZoom(prev => Math.min(Math.max(1, prev - e.deltaY * 0.005), 10))}
      onMouseDown={e => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }}
      onMouseMove={e => {
        if (isDragging) setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
      }}
      onMouseUp={() => setIsDragging(false)}
      onMouseLeave={() => setIsDragging(false)}
    >
      <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 10000, display: 'flex', gap: '12px' }}>
        <button
          onClick={e => {
            e.stopPropagation();
            onSnapshot();
          }}
          style={{
            background: 'rgba(0,0,0,0.8)', border: '1px solid #00ff00', color: '#00ff00',
            padding: '10px 20px', fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 'bold',
            cursor: 'pointer', letterSpacing: '1px'
          }}
        >
          [ СНИМОК КАДРА ]
        </button>

        <button
          onClick={e => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            background: 'rgba(0,0,0,0.8)', border: '1px solid #ff3333', color: '#ff3333',
            padding: '10px 20px', fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 'bold',
            cursor: 'pointer', letterSpacing: '1px'
          }}
        >
          [ ЗАКРЫТЬ (ESC) ]
        </button>
      </div>

      <div
        style={{
          width: '80%',
          maxWidth: '1400px',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: isDragging || zoom !== 1 ? 'none' : 'transform 0.1s',
          cursor: isDragging ? 'grabbing' : (zoom > 1 ? 'grab' : 'default')
        }}
      >
        <VideoFeed imageBase64={imageBase64} detections={detections} isExpanded={true} />
      </div>
    </div>
  );
};