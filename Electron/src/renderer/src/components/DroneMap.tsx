import { useEffect, useRef, useState, useMemo } from 'react';
import Map, { Marker, Source, Layer, MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapDetectionPoint } from '../types';
import { calculateDistanceAndBearing } from '../utils/geoMath';

interface DroneMapProps {
  lat: number;
  lng: number;
  path?: Array<{ lat: number; lng: number }>;
  detectionPoints?: MapDetectionPoint[];
  onSelectFrame?: (frameIndex: number) => void;
}

const mapStyle = {
  version: 8,
  sources: {
    openmaptiles: {
      type: 'vector',
      tiles: ['map-tile://localhost/{z}/{x}/{y}.pbf'],
      minzoom: 5,
      maxzoom: 14
    }
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#1a1a1a' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#1f2d3d' } },
    { id: 'roads', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#333333', 'line-width': 1 } },
    { id: 'buildings', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', paint: { 'fill-color': '#2a2a2a' } }
  ]
};

export const DroneMap = ({
  lat,
  lng,
  path = [],
  detectionPoints = [],
  onSelectFrame
}: DroneMapProps) => {
  const mapRef = useRef<MapRef | null>(null);
  const [followDrone, setFollowDrone] = useState<boolean>(true);
  const [showDetectionsOnMap, setShowDetectionsOnMap] = useState<boolean>(true);

  const [rulerMode, setRulerMode] = useState<boolean>(false);
  const [rulerPoint, setRulerPoint] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (followDrone && mapRef.current) {
      mapRef.current.easeTo({
        center: [lng, lat],
        duration: 250
      });
    }
  }, [lat, lng, followDrone]);

  const routeGeoJson = useMemo(() => ({
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: path.map(p => [p.lng, p.lat])
    },
    properties: {}
  }), [path]);

  const rulerGeoJson = useMemo(() => {
    if (!rulerPoint) return null;
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [lng, lat],
          [rulerPoint.lng, rulerPoint.lat]
        ]
      },
      properties: {}
    };
  }, [lat, lng, rulerPoint]);

  const rulerStats = useMemo(() => {
    if (!rulerPoint) return null;
    return calculateDistanceAndBearing(lat, lng, rulerPoint.lat, rulerPoint.lng);
  }, [lat, lng, rulerPoint]);

  const handleMapClick = (e: MapLayerMouseEvent) => {
    if (rulerMode) {
      setRulerPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    }
  };

  const handleMapRightClick = (e: MapLayerMouseEvent) => {
    e.preventDefault();
    setRulerPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Map
        ref={mapRef}
        initialViewState={{ longitude: lng, latitude: lat, zoom: 13 }}
        style={{ width: '100%', height: '100%', cursor: rulerMode ? 'crosshair' : 'grab' }}
        mapStyle={mapStyle as any}
        interactive={true}
        attributionControl={false}
        onDragStart={() => setFollowDrone(false)}
        onClick={handleMapClick}
        onContextMenu={handleMapRightClick}
      >
        {path.length > 1 && (
          <Source id="drone-route" type="geojson" data={routeGeoJson}>
            <Layer
              id="drone-route-line"
              type="line"
              paint={{
                'line-color': '#00e5ff',
                'line-width': 2,
                'line-opacity': 0.75
              }}
            />
          </Source>
        )}

        {rulerGeoJson && (
          <Source id="ruler-line-source" type="geojson" data={rulerGeoJson}>
            <Layer
              id="ruler-line-layer"
              type="line"
              paint={{
                'line-color': '#ffcc00',
                'line-width': 2,
                'line-dasharray': [2, 2]
              }}
            />
          </Source>
        )}

        {rulerPoint && (
          <Marker longitude={rulerPoint.lng} latitude={rulerPoint.lat} anchor="center">
            <div
              style={{
                width: '14px',
                height: '14px',
                border: '2px solid #ffcc00',
                backgroundColor: 'rgba(255, 204, 0, 0.25)',
                borderRadius: '50%',
                boxShadow: '0 0 8px #ffcc00'
              }}
            />
          </Marker>
        )}

        {showDetectionsOnMap &&
          detectionPoints.map((pt, idx) => (
            <Marker
              key={`${pt.frameIndex}-${idx}`}
              longitude={pt.lng}
              latitude={pt.lat}
              anchor="center"
            >
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectFrame?.(pt.frameIndex);
                }}
                title={`${pt.label} | Рельеф: ${pt.targetElevation ?? '---'}м | GPS: ${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}`}
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: pt.color,
                  border: '2px solid #000',
                  boxShadow: `0 0 6px ${pt.color}`,
                  cursor: 'pointer'
                }}
              />
            </Marker>
          ))}

        <Marker longitude={lng} latitude={lat} color="#ff3333" />
      </Map>

      {rulerPoint && rulerStats && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            backgroundColor: 'rgba(18, 18, 18, 0.92)',
            border: '1px solid #ffcc00',
            color: '#ffcc00',
            padding: '8px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}
        >
          <div style={{ fontWeight: 'bold', borderBottom: '1px solid #444', paddingBottom: '4px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            <span>📏 ЛИНЕЙКА (ОТ БПЛА)</span>
            <span
              onClick={() => setRulerPoint(null)}
              style={{ color: '#ff3333', cursor: 'pointer', fontWeight: 'bold' }}
            >
              [✕]
            </span>
          </div>
          <div>
            ДИСТАНЦИЯ:{' '}
            <strong style={{ color: '#fff' }}>
              {rulerStats.distanceMeters >= 1000
                ? `${(rulerStats.distanceMeters / 1000).toFixed(2)} КМ`
                : `${Math.round(rulerStats.distanceMeters)} М`}
            </strong>
          </div>
          <div>
            АЗИМУТ: <strong style={{ color: '#fff' }}>{rulerStats.bearingDeg.toFixed(1)}°</strong>
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', bottom: '12px', left: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap', zIndex: 10 }}>
        <button
          onClick={() => {
            setFollowDrone(true);
            mapRef.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 500 });
          }}
          style={{
            background: followDrone ? 'rgba(0, 229, 255, 0.15)' : 'rgba(0, 0, 0, 0.85)',
            border: `1px solid ${followDrone ? '#00e5ff' : '#ff3333'}`,
            color: followDrone ? '#00e5ff' : '#ff3333',
            padding: '6px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          {followDrone ? '[ АВТОСЛЕЖЕНИЕ: ВКЛ ]' : '[ ЦЕНТР НА БПЛА ]'}
        </button>

        <button
          onClick={() => setShowDetectionsOnMap(prev => !prev)}
          style={{
            background: showDetectionsOnMap ? 'rgba(0, 255, 0, 0.15)' : 'rgba(0, 0, 0, 0.85)',
            border: `1px solid ${showDetectionsOnMap ? '#00ff00' : '#666'}`,
            color: showDetectionsOnMap ? '#00ff00' : '#888',
            padding: '6px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          {showDetectionsOnMap ? `[ ЦЕЛИ: ВКЛ (${detectionPoints.length}) ]` : '[ ЦЕЛИ: ВЫКЛ ]'}
        </button>

        <button
          onClick={() => setRulerMode(prev => !prev)}
          style={{
            background: rulerMode ? 'rgba(255, 204, 0, 0.2)' : 'rgba(0, 0, 0, 0.85)',
            border: `1px solid ${rulerMode ? '#ffcc00' : '#666'}`,
            color: rulerMode ? '#ffcc00' : '#aaa',
            padding: '6px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          {rulerMode ? '[ 📏 ЛИНЕЙКА: АКТИВНА ]' : '[ 📏 ЛИНЕЙКА (ПКМ) ]'}
        </button>
      </div>
    </div>
  );
};