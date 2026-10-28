import React, { useState } from 'react';
import { Telemetry } from '../types';

interface TopHudProps {
  wsStatus: string;
  wsUrl: string;
  onChangeWsUrl: (newUrl: string) => void;
  telemetry?: Telemetry;
  fps: number;
  pingMs: number | null;
  isSwapped: boolean;
  onToggleSwap: () => void;
  isArchive: boolean;
  isRewinding: boolean;
  mbtilesPath: string | null;
  demDirPath: string | null;
  onSelectMbtiles: () => void;
  onSelectDemDir: () => void;
}

export const TopHud: React.FC<TopHudProps> = ({
  wsStatus,
  wsUrl,
  onChangeWsUrl,
  telemetry,
  fps,
  pingMs,
  isSwapped,
  onToggleSwap,
  isArchive,
  isRewinding,
  mbtilesPath,
  demDirPath,
  onSelectMbtiles,
  onSelectDemDir
}) => {
  const [isEditingWs, setIsEditingWs] = useState(false);
  const [inputVal, setInputVal] = useState(wsUrl);
  const [isPathsOpen, setIsPathsOpen] = useState(false);

  const pingColor =
    pingMs === null ? '#777' : pingMs < 150 ? '#00ff00' : pingMs < 500 ? '#ff9900' : '#ff3333';

  return (
    <div className="hud-bar" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span>
          СИСТЕМА:{' '}
          <span style={{ color: wsStatus === 'ПОДКЛЮЧЕНО' ? '#00e5ff' : '#ff3333', fontWeight: 'bold' }}>
            {wsStatus}
          </span>
        </span>

        {isEditingWs ? (
          <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              type="text"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              style={{
                background: '#121212', color: '#00e5ff', border: '1px solid #00e5ff',
                padding: '2px 6px', fontFamily: 'var(--font-mono)', fontSize: '11px', width: '180px'
              }}
            />
            <button
              onClick={() => {
                onChangeWsUrl(inputVal);
                setIsEditingWs(false);
              }}
              style={{ background: '#00e5ff', color: '#000', border: 'none', padding: '2px 6px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 'bold' }}
            >
              ОК
            </button>
          </span>
        ) : (
          <button
            onClick={() => setIsEditingWs(true)}
            style={{ background: 'transparent', color: '#888', border: '1px dashed #444', padding: '2px 6px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
            title="Изменить адрес WebSocket сервера"
          >
            [{wsUrl}]
          </button>
        )}

        <span style={{ fontFamily: 'var(--font-mono)', color: fps > 0 ? '#00ff00' : '#777' }}>
          FPS: {fps}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', color: pingColor }}>
          ПИНГ: {pingMs !== null ? `${pingMs} МС` : '---'}
        </span>

        <span style={{ fontFamily: 'var(--font-mono)' }}>ВЫС: {telemetry?.altitude.toFixed(1) || '00.0'} М</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>ШИР: {telemetry?.lat.toFixed(6) || '00.000000'}</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>ДОЛ: {telemetry?.lng.toFixed(6) || '00.000000'}</span>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <button
          onClick={() => setIsPathsOpen(prev => !prev)}
          className="tactical-btn"
          style={{
            padding: '4px 10px',
            borderColor: mbtilesPath && demDirPath ? '#444' : '#ff9900',
            color: mbtilesPath && demDirPath ? '#e0e0e0' : '#ff9900',
            fontSize: '11px',
            fontWeight: 'bold'
          }}
          title="Настроить пути к файлу карты (.mbtiles) и папке высот (DEM)"
        >
          [ ⚙ КАРТА И DEM ]
        </button>

        <button
          onClick={onToggleSwap}
          className="tactical-btn"
          style={{
            padding: '4px 10px',
            borderColor: '#00e5ff',
            color: isSwapped ? '#000' : '#00e5ff',
            backgroundColor: isSwapped ? '#00e5ff' : '#121212',
            fontWeight: 'bold',
            fontSize: '11px'
          }}
        >
          [ ⇄ ВИД: {isSwapped ? 'ВИДЕО ГЛАВНОЕ' : 'КАРТА ГЛАВНАЯ'} ]
        </button>

        {isArchive ? (
          <span style={{ color: '#00ff00', fontWeight: 'bold', animation: 'blink 1s infinite' }}>[ АРХИВ ]</span>
        ) : isRewinding ? (
          <span style={{ color: '#ff3333', fontWeight: 'bold', animation: 'blink 1s infinite' }}>[ ПОВТОР ]</span>
        ) : (
          <span style={{ color: '#00e5ff', fontWeight: 'bold' }}>[ ЭФИР ]</span>
        )}
      </div>

      {/* Всплывающая панель выбора путей к карте и папке высот */}
      {isPathsOpen && (
        <div
          style={{
            position: 'absolute',
            top: '40px',
            right: '16px',
            width: '520px',
            backgroundColor: '#181818',
            border: '1px solid #00e5ff',
            boxShadow: '0 8px 24px rgba(0,0,0,0.85)',
            padding: '12px 16px',
            zIndex: 9000,
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '6px' }}>
            <span style={{ color: '#00e5ff', fontWeight: 'bold' }}>НАСТРОЙКА ИСТОЧНИКОВ КАРТЫ И ВЫСОТ (DEM)</span>
            <span
              onClick={() => setIsPathsOpen(false)}
              style={{ color: '#ff3333', cursor: 'pointer', fontWeight: 'bold' }}
            >
              [✕ ЗАКРЫТЬ]
            </span>
          </div>

          {/* Выбор файла карты .mbtiles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '11px', color: '#aaa', display: 'flex', justifyContent: 'space-between' }}>
              <span>ФАЙЛ ВЕКТОРНОЙ КАРТЫ (.MBTILES):</span>
              <span style={{ color: mbtilesPath ? '#00ff00' : '#ff3333' }}>
                {mbtilesPath ? '● ПОДКЛЮЧЕН' : '● НЕ НАЙДЕН'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div
                style={{
                  flex: 1,
                  background: '#121212',
                  border: '1px solid #333',
                  padding: '6px 8px',
                  fontSize: '11px',
                  color: mbtilesPath ? '#e0e0e0' : '#666',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={mbtilesPath || 'Файл не выбран'}
              >
                {mbtilesPath || 'Файл russia.mbtiles не выбран'}
              </div>
              <button
                onClick={onSelectMbtiles}
                className="tactical-btn"
                style={{ color: '#00e5ff', borderColor: '#00e5ff', whiteSpace: 'nowrap' }}
              >
                [ ВЫБРАТЬ ФАЙЛ... ]
              </button>
            </div>
          </div>

          {/* Выбор папки с высотами DEM */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '11px', color: '#aaa', display: 'flex', justifyContent: 'space-between' }}>
              <span>ПАПКА КАРТЫ ВЫСОТ РЕЛЬЕФА (DEM .TIF):</span>
              <span style={{ color: demDirPath ? '#00ff00' : '#ff3333' }}>
                {demDirPath ? '● ПОДКЛЮЧЕНА' : '● НЕ НАЙДЕНА'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div
                style={{
                  flex: 1,
                  background: '#121212',
                  border: '1px solid #333',
                  padding: '6px 8px',
                  fontSize: '11px',
                  color: demDirPath ? '#e0e0e0' : '#666',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={demDirPath || 'Папка не выбрана'}
              >
                {demDirPath || 'Папка russia_dem не выбрана'}
              </div>
              <button
                onClick={onSelectDemDir}
                className="tactical-btn"
                style={{ color: '#00ff00', borderColor: '#00ff00', whiteSpace: 'nowrap' }}
              >
                [ ВЫБРАТЬ ПАПКУ... ]
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};