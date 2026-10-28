import React from 'react';
import { FlightMeta, MapDetectionPoint } from '../types';
import { openArchiveDirectory } from '../services/archiveDb';

interface PlayerControlsProps {
  selectedArchiveId: number | 'LIVE';
  flightMetas: FlightMeta[];
  onSelectArchive: (val: string) => void;
  onSaveToArchive: () => void;
  onDeleteArchive: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  playbackSpeed: number;
  onChangeSpeed: (speed: number) => void;
  isRewinding: boolean;
  onReturnToLive: () => void;
  totalFrames: number;
  currentFrameIndex: number;
  onScrub: (index: number) => void;
  detectionPoints: MapDetectionPoint[];
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  selectedArchiveId,
  flightMetas,
  onSelectArchive,
  onSaveToArchive,
  onDeleteArchive,
  isPlaying,
  onTogglePlay,
  playbackSpeed,
  onChangeSpeed,
  isRewinding,
  onReturnToLive,
  totalFrames,
  currentFrameIndex,
  onScrub,
  detectionPoints
}) => {
  return (
    <div className="player-bar">
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <select
          value={selectedArchiveId}
          onChange={e => onSelectArchive(e.target.value)}
          className="tactical-select"
        >
          <option value="LIVE">ОСНОВНОЙ ПОТОК (LIVE)</option>
          {flightMetas.map(f => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>

        <button onClick={onSaveToArchive} className="tactical-btn" style={{ color: '#00ff00' }}>
          [ В АРХИВ ]
        </button>

        <button
          onClick={openArchiveDirectory}
          className="tactical-btn"
          style={{ color: '#00e5ff' }}
          title="Открыть папку с файлами архивов на диске (Документы/UAV_Archive)"
        >
          [ 📁 ПАПКА ]
        </button>

        {selectedArchiveId !== 'LIVE' && (
          <button onClick={onDeleteArchive} className="tactical-btn" style={{ color: '#ff3333', borderColor: '#ff3333' }}>
            [ УДАЛИТЬ ]
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button
          disabled={totalFrames === 0}
          onClick={onTogglePlay}
          className="tactical-btn"
          style={{
            background: isPlaying ? '#00e5ff' : '#121212',
            color: isPlaying ? '#000' : '#00e5ff',
            borderColor: '#00e5ff',
            fontWeight: 'bold',
            cursor: totalFrames === 0 ? 'not-allowed' : 'pointer'
          }}
        >
          {isPlaying ? '[ ⏸ ПАУЗА ]' : '[ ▶ ПУСК ]'}
        </button>

        <select
          value={playbackSpeed}
          onChange={e => onChangeSpeed(Number(e.target.value))}
          className="tactical-select"
          style={{ color: '#aaa' }}
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1.0x</option>
          <option value={2}>2.0x</option>
          <option value={4}>4.0x</option>
        </select>

        {selectedArchiveId === 'LIVE' && isRewinding && (
          <button
            onClick={onReturnToLive}
            className="tactical-btn"
            style={{ background: '#ff3333', color: '#000', border: 'none', fontWeight: 'bold' }}
          >
            В ЭФИР
          </button>
        )}
      </div>

      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', marginLeft: '6px', height: '28px' }}>
        <div style={{ position: 'absolute', left: '6px', right: '6px', bottom: '0px', height: '5px', pointerEvents: 'none' }}>
          {totalFrames > 1 &&
            detectionPoints.map((pt, i) => {
              const leftPct = (pt.frameIndex / (totalFrames - 1)) * 100;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: `${leftPct}%`,
                    top: 0,
                    width: '2px',
                    height: '5px',
                    backgroundColor: pt.color
                  }}
                />
              );
            })}
        </div>

        <input
          type="range"
          min="0"
          max={totalFrames > 0 ? totalFrames - 1 : 0}
          value={isRewinding || selectedArchiveId !== 'LIVE' ? currentFrameIndex : (totalFrames > 0 ? totalFrames - 1 : 0)}
          onChange={e => onScrub(Number(e.target.value))}
          disabled={totalFrames === 0}
          style={{ width: '100%', cursor: 'pointer', accentColor: selectedArchiveId !== 'LIVE' ? '#00ff00' : '#00e5ff', zIndex: 2 }}
        />
      </div>

      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#888', minWidth: '145px', textAlign: 'right' }}>
        КАДР: {totalFrames > 0 ? `${currentFrameIndex + 1} / ${totalFrames}` : '0 / 0'}
      </span>
    </div>
  );
};