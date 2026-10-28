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
  // Вычисленные реальные координаты объекта на земле с учетом карты высот (DEM)
  targetLat?: number;
  targetLng?: number;
  distanceMeters?: number;
  targetElevation?: number; // Высота рельефа в точке цели (м над ур. моря)
}

export interface Telemetry {
  lat: number;
  lng: number;
  altitude: number;
  yaw?: number;
  pitch?: number;
}

export interface DroneData {
  telemetry: Telemetry;
  detections: Detection[];
  image_base64: string;
}

export interface FlightMeta {
  id: number;
  name: string;
  frameCount: number;
}

export interface SavedFlight extends FlightMeta {
  data: DroneData[];
}

export interface MapDetectionPoint {
  frameIndex: number;
  lat: number;
  lng: number;
  color: string;
  label: string;
  distanceMeters?: number;
  targetElevation?: number;
}

export const ALL_CLASSES = ['human', 'fire', 'smoke', 'transport', 'stuff', 'postburn'] as const;

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