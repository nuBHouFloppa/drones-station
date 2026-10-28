import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import './App.css';
import {
  DroneData,
  FlightMeta,
  SavedFlight,
  Detection,
  MapDetectionPoint,
  ALL_CLASSES,
  classColors,
  classTranslations
} from './types';
import {
  saveFlightToDB,
  loadFlightMetasFromDB,
  loadFlightDataById,
  deleteFlightFromDB
} from './services/archiveDb';
import { exportFrameSnapshot } from './utils/snapshot';
import {
  calculateTargetGps,
  calculateDistanceAndBearing,
  ensureDemTileLoaded,
  clearRendererDemCache
} from './utils/geoMath';
import { TopHud } from './components/TopHud';
import { DroneMap } from './components/DroneMap';
import { VideoFeed } from './components/VideoFeed';
import { DetectionsList } from './components/DetectionsList';
import { PlayerControls } from './components/PlayerControls';
import { VideoModal } from './components/VideoModal';

const AUTOSAVE_FRAMES = 100;
const MAX_HISTORY_FRAMES = 500;

function App() {
  const [wsUrl, setWsUrl] = useState<string>(
    () => localStorage.getItem('drone_ws_url') || 'ws://localhost:8080/ws'
  );
  const [droneData, setDroneData] = useState<DroneData | null>(null);
  const [wsStatus, setWsStatus] = useState<string>('ОТКЛЮЧЕНО');

  // Пути к карте (.mbtiles) и папке высот (DEM)
  const [mbtilesPath, setMbtilesPath] = useState<string | null>(null);
  const [demDirPath, setDemDirPath] = useState<string | null>(null);

  const [fps, setFps] = useState<number>(0);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const lastPacketTimeRef = useRef<number | null>(null);
  const fpsFramesRef = useRef<number>(0);

  const [isSwapped, setIsSwapped] = useState<boolean>(false);

  const [history, setHistory] = useState<DroneData[]>([]);
  const [flightMetas, setFlightMetas] = useState<FlightMeta[]>([]);
  const [loadedArchiveData, setLoadedArchiveData] = useState<DroneData[]>([]);
  const [selectedArchiveId, setSelectedArchiveId] = useState<number | 'LIVE'>('LIVE');

  const [isRewinding, setIsRewinding] = useState<boolean>(false);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  const [minConfidence, setMinConfidence] = useState<number>(0.25);
  const [enabledClasses, setEnabledClasses] = useState<Record<string, boolean>>(() =>
    ALL_CLASSES.reduce((acc, cls) => ({ ...acc, [cls]: true }), {})
  );

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const frameCounterRef = useRef<number>(0);
  const lastCourseRef = useRef<number>(0);

  const currentBuffer = selectedArchiveId === 'LIVE' ? history : loadedArchiveData;
  const safeHistoryIndex = Math.min(historyIndex, Math.max(0, currentBuffer.length - 1));
  const rawDisplayData =
    selectedArchiveId === 'LIVE' && !isRewinding
      ? droneData
      : currentBuffer.length > 0
        ? currentBuffer[safeHistoryIndex]
        : droneData;

  const currentLat = rawDisplayData?.telemetry.lat ?? 55.7558;
  const currentLng = rawDisplayData?.telemetry.lng ?? 37.6173;
  const latFloor = Math.floor(currentLat);
  const lngFloor = Math.floor(currentLng);

  // Получаем текущие пути к карте и DEM при старте
  useEffect(() => {
    window.api?.getPaths?.().then(info => {
      setMbtilesPath(info.mbtilesPath);
      setDemDirPath(info.demDirPath);
    });
  }, []);

  // Предзагрузка тайла высот DEM при смене координат или папки DEM
  useEffect(() => {
    ensureDemTileLoaded(currentLat, currentLng);
  }, [latFloor, lngFloor, demDirPath]);

  useEffect(() => {
    loadFlightMetasFromDB()
      .then(setFlightMetas)
      .catch(err => console.error('Ошибка загрузки архива:', err));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setFps(fpsFramesRef.current);
      fpsFramesRef.current = 0;

      if (lastPacketTimeRef.current && Date.now() - lastPacketTimeRef.current > 3000) {
        setPingMs(null);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;

    const connect = () => {
      if (isUnmounted) return;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        setWsStatus('НЕВЕРНЫЙ URL');
        return;
      }

      ws.onopen = () => !isUnmounted && setWsStatus('ПОДКЛЮЧЕНО');
      ws.onclose = () => {
        if (!isUnmounted) {
          setWsStatus('ПЕРЕПОДКЛЮЧЕНИЕ...');
          setPingMs(null);
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => {
        if (!isUnmounted) setWsStatus('ОШИБКА СЕТИ');
        ws?.close();
      };

      ws.onmessage = (event) => {
        try {
          const now = Date.now();
          if (lastPacketTimeRef.current !== null) {
            setPingMs(now - lastPacketTimeRef.current);
          }
          lastPacketTimeRef.current = now;
          fpsFramesRef.current += 1;

          const rawData: DroneData = JSON.parse(event.data);
          ensureDemTileLoaded(rawData.telemetry.lat, rawData.telemetry.lng);

          setHistory(prev => {
            if (prev.length > 0 && rawData.telemetry.yaw === undefined) {
              const prevTel = prev[prev.length - 1].telemetry;
              const move = calculateDistanceAndBearing(
                prevTel.lat,
                prevTel.lng,
                rawData.telemetry.lat,
                rawData.telemetry.lng
              );
              if (move.distanceMeters > 0.5) {
                lastCourseRef.current = move.bearingDeg;
              }
            }

            const enrichedDetections: Detection[] = (rawData.detections || []).map(det => {
              const gps = calculateTargetGps(rawData.telemetry, det.bbox, lastCourseRef.current);
              return {
                ...det,
                targetLat: gps.targetLat,
                targetLng: gps.targetLng,
                distanceMeters: gps.distanceMeters,
                targetElevation: gps.targetElevation
              };
            });

            const enrichedFrame: DroneData = {
              ...rawData,
              detections: enrichedDetections
            };

            setDroneData(enrichedFrame);
            frameCounterRef.current += 1;
            const currentCount = frameCounterRef.current;

            const next = [...prev, enrichedFrame];
            if (currentCount % AUTOSAVE_FRAMES === 0) {
              const chunk = next.slice(-AUTOSAVE_FRAMES);
              const autoFlight: SavedFlight = {
                id: Date.now(),
                name: `[АВТО] ${new Date().toLocaleTimeString('ru-RU')} (${chunk.length} КАДРОВ)`,
                frameCount: chunk.length,
                data: chunk
              };
              setFlightMetas(fm => [
                ...fm,
                { id: autoFlight.id, name: autoFlight.name, frameCount: autoFlight.frameCount }
              ]);
              saveFlightToDB(autoFlight);
            }
            return next.length > MAX_HISTORY_FRAMES
              ? next.slice(next.length - MAX_HISTORY_FRAMES)
              : next;
          });
        } catch (error) {
          console.error('Ошибка парсинга пакета:', error);
        }
      };
    };

    connect();
    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [wsUrl]);

  const filterDetections = useCallback(
    (dets: Detection[] | undefined, telemetry?: DroneData['telemetry']) =>
      (dets || [])
        .filter(d => d.confidence >= minConfidence && (enabledClasses[d.class] ?? true))
        .map(d => {
          if (d.targetLat !== undefined && d.targetLng !== undefined && d.targetElevation !== undefined) {
            return d;
          }
          if (!telemetry) return d;
          const gps = calculateTargetGps(telemetry, d.bbox, lastCourseRef.current);
          return {
            ...d,
            targetLat: gps.targetLat,
            targetLng: gps.targetLng,
            distanceMeters: gps.distanceMeters,
            targetElevation: gps.targetElevation
          };
        }),
    [minConfidence, enabledClasses, demDirPath]
  );

  const filteredDetections = useMemo(
    () => filterDetections(rawDisplayData?.detections, rawDisplayData?.telemetry),
    [rawDisplayData, filterDetections]
  );

  useEffect(() => {
    if (!isPlaying || currentBuffer.length === 0) return;
    const intervalMs = Math.max(25, Math.round(120 / playbackSpeed));
    const timer = setInterval(() => {
      setHistoryIndex(prev => {
        if (prev >= currentBuffer.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed, currentBuffer.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === 'Escape' && isModalOpen) {
        setIsModalOpen(false);
      } else if (e.key === 'ArrowLeft' && currentBuffer.length > 0) {
        e.preventDefault();
        setIsPlaying(false);
        setIsRewinding(true);
        setHistoryIndex(prev => Math.max(0, (isRewinding ? prev : currentBuffer.length - 1) - 1));
      } else if (e.key === 'ArrowRight' && currentBuffer.length > 0) {
        e.preventDefault();
        setIsPlaying(false);
        setIsRewinding(true);
        setHistoryIndex(prev =>
          Math.min(currentBuffer.length - 1, (isRewinding ? prev : currentBuffer.length - 1) + 1)
        );
      } else if (e.key === ' ' && currentBuffer.length > 0) {
        e.preventDefault();
        if (!isRewinding && selectedArchiveId === 'LIVE') {
          setIsRewinding(true);
          setHistoryIndex(Math.max(0, currentBuffer.length - 1));
          setIsPlaying(false);
        } else {
          setIsPlaying(p => !p);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, currentBuffer.length, isRewinding, selectedArchiveId]);

  const flightPath = useMemo(() => {
    const sliceEnd =
      selectedArchiveId === 'LIVE' && !isRewinding ? currentBuffer.length : safeHistoryIndex + 1;
    return currentBuffer
      .slice(0, sliceEnd)
      .map(item => ({ lat: item.telemetry.lat, lng: item.telemetry.lng }));
  }, [currentBuffer, selectedArchiveId, isRewinding, safeHistoryIndex]);

  const detectionPoints = useMemo<MapDetectionPoint[]>(() => {
    const pts: MapDetectionPoint[] = [];
    currentBuffer.forEach((frame, idx) => {
      const valid = filterDetections(frame.detections, frame.telemetry);
      if (valid.length > 0) {
        const best = valid.reduce((a, b) => (a.confidence > b.confidence ? a : b));
        pts.push({
          frameIndex: idx,
          lat: best.targetLat ?? frame.telemetry.lat,
          lng: best.targetLng ?? frame.telemetry.lng,
          distanceMeters: best.distanceMeters,
          targetElevation: best.targetElevation,
          color: classColors[best.class] || '#ffffff',
          label: `${classTranslations[best.class] || best.class} (${(best.confidence * 100).toFixed(0)}%)`
        });
      }
    });
    return pts;
  }, [currentBuffer, filterDetections]);

  const handleSelectArchive = async (val: string) => {
    setIsPlaying(false);
    if (val === 'LIVE') {
      setSelectedArchiveId('LIVE');
      setLoadedArchiveData([]);
      setIsRewinding(false);
      setHistoryIndex(history.length > 0 ? history.length - 1 : 0);
    } else {
      const id = Number(val);
      setSelectedArchiveId(id);
      setIsRewinding(true);
      setHistoryIndex(0);
      setLoadedArchiveData(await loadFlightDataById(id));
    }
  };

  const handleSaveToArchive = () => {
    if (history.length === 0) return;
    const manualFlight: SavedFlight = {
      id: Date.now(),
      name: `[РУЧНАЯ] ${new Date().toLocaleTimeString('ru-RU')} (${history.length} КАДРОВ)`,
      frameCount: history.length,
      data: [...history]
    };
    setFlightMetas(prev => [
      ...prev,
      { id: manualFlight.id, name: manualFlight.name, frameCount: manualFlight.frameCount }
    ]);
    saveFlightToDB(manualFlight);
  };

  const handleDeleteArchive = () => {
    if (selectedArchiveId === 'LIVE') return;
    deleteFlightFromDB(selectedArchiveId);
    setFlightMetas(prev => prev.filter(f => f.id !== selectedArchiveId));
    setSelectedArchiveId('LIVE');
    setLoadedArchiveData([]);
    setIsRewinding(false);
    setIsPlaying(false);
  };

  // Диалог выбора файла карты (.mbtiles)
  const handleSelectMbtiles = async () => {
    if (!window.api?.selectMbtiles) return;
    const info = await window.api.selectMbtiles();
    setMbtilesPath(info.mbtilesPath);
  };

  // Диалог выбора папки высот (DEM)
  const handleSelectDemDir = async () => {
    if (!window.api?.selectDemDir) return;
    const info = await window.api.selectDemDir();
    clearRendererDemCache();
    setDemDirPath(info.demDirPath);
    ensureDemTileLoaded(currentLat, currentLng);
  };

  // key={mbtilesPath} гарантирует автоматическую перезагрузку карты при выборе другого файла .mbtiles
  const mapElement = (
    <DroneMap
      key={mbtilesPath || 'default-map'}
      lat={currentLat}
      lng={currentLng}
      path={flightPath}
      detectionPoints={detectionPoints}
      onSelectFrame={(frameIdx) => {
        setIsPlaying(false);
        setIsRewinding(true);
        setHistoryIndex(frameIdx);
      }}
    />
  );

  const videoElement = (
    <VideoFeed
      imageBase64={rawDisplayData?.image_base64 || ''}
      detections={filteredDetections}
      onToggleExpand={() => setIsModalOpen(true)}
      onSnapshot={
        rawDisplayData?.image_base64
          ? () => exportFrameSnapshot(rawDisplayData, filteredDetections)
          : undefined
      }
    />
  );

  return (
    <div className="app-root">
      <TopHud
        wsStatus={wsStatus}
        wsUrl={wsUrl}
        onChangeWsUrl={(newUrl) => {
          localStorage.setItem('drone_ws_url', newUrl);
          setWsUrl(newUrl);
        }}
        telemetry={rawDisplayData?.telemetry}
        fps={fps}
        pingMs={pingMs}
        isSwapped={isSwapped}
        onToggleSwap={() => setIsSwapped(prev => !prev)}
        isArchive={selectedArchiveId !== 'LIVE'}
        isRewinding={isRewinding}
        mbtilesPath={mbtilesPath}
        demDirPath={demDirPath}
        onSelectMbtiles={handleSelectMbtiles}
        onSelectDemDir={handleSelectDemDir}
      />

      <div className="workspace">
        <div
          className="map-container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000',
            overflow: 'hidden'
          }}
        >
          {isSwapped ? videoElement : mapElement}
        </div>

        <div className="sidebar">
          {isSwapped ? (
            <div style={{ width: '100%', aspectRatio: '4/3', border: '1px solid #333', position: 'relative' }}>
              {mapElement}
            </div>
          ) : (
            videoElement
          )}

          <DetectionsList
            detections={filteredDetections}
            minConfidence={minConfidence}
            onChangeMinConfidence={setMinConfidence}
            enabledClasses={enabledClasses}
            onToggleClass={(cls) => setEnabledClasses(prev => ({ ...prev, [cls]: !prev[cls] }))}
          />
        </div>
      </div>

      <PlayerControls
        selectedArchiveId={selectedArchiveId}
        flightMetas={flightMetas}
        onSelectArchive={handleSelectArchive}
        onSaveToArchive={handleSaveToArchive}
        onDeleteArchive={handleDeleteArchive}
        isPlaying={isPlaying}
        onTogglePlay={() => {
          if (!isRewinding && selectedArchiveId === 'LIVE') {
            setIsRewinding(true);
            setHistoryIndex(0);
            setIsPlaying(true);
          } else {
            if (safeHistoryIndex >= currentBuffer.length - 1) setHistoryIndex(0);
            setIsPlaying(p => !p);
          }
        }}
        playbackSpeed={playbackSpeed}
        onChangeSpeed={setPlaybackSpeed}
        isRewinding={isRewinding}
        onReturnToLive={() => {
          setIsPlaying(false);
          setIsRewinding(false);
        }}
        totalFrames={currentBuffer.length}
        currentFrameIndex={safeHistoryIndex}
        onScrub={(idx) => {
          setIsPlaying(false);
          setIsRewinding(true);
          setHistoryIndex(idx);
        }}
        detectionPoints={detectionPoints}
      />

      {isModalOpen && (
        <VideoModal
          imageBase64={rawDisplayData?.image_base64 || ''}
          detections={filteredDetections}
          onClose={() => setIsModalOpen(false)}
          onSnapshot={() => exportFrameSnapshot(rawDisplayData, filteredDetections)}
        />
      )}
    </div>
  );
}

export default App;