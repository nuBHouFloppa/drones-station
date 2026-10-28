import { BBox, Telemetry } from '../types';

export const CAMERA_CONFIG = {
  RESOLUTION_WIDTH: 1920,
  RESOLUTION_HEIGHT: 1080,
  HFOV_DEG: 78,
  VFOV_DEG: 48
};

const EARTH_RADIUS_M = 6378137;
const degToRad = (deg: number) => (deg * Math.PI) / 180;
const radToDeg = (rad: number) => (rad * 180) / Math.PI;


interface DemTile {
  key: string;
  latFloor: number;
  lngFloor: number;
  width: number;
  height: number;
  data: Float32Array | Int16Array;
}

const rendererDemCache = new Map<string, DemTile>();
const pendingDemRequests = new Set<string>();

export function clearRendererDemCache(): void {
  rendererDemCache.clear();
  pendingDemRequests.clear();
}

/**
 * Асинхронно подгружает тайл высот 1x1 градус (и соседние при необходимости) из Main-процесса
 */
export async function ensureDemTileLoaded(lat: number, lng: number): Promise<boolean> {
  const latFloor = Math.floor(lat);
  const lngFloor = Math.floor(lng);
  const key = `${latFloor}_${lngFloor}`;

  if (rendererDemCache.has(key)) return true;
  if (pendingDemRequests.has(key)) return false;

  if (!window.api?.getDemTile) return false;

  pendingDemRequests.add(key);
  try {
    const res = await window.api.getDemTile(latFloor, lngFloor);
    if (res && res.data) {
      if (rendererDemCache.size >= 6) {
        const oldest = rendererDemCache.keys().next().value;
        if (oldest) rendererDemCache.delete(oldest);
      }
      rendererDemCache.set(key, {
        key,
        latFloor,
        lngFloor,
        width: res.width,
        height: res.height,
        data: res.data
      });
      return true;
    }
  } catch (e) {
    console.error('Ошибка загрузки DEM тайла:', e);
  } finally {
    pendingDemRequests.delete(key);
  }
  return false;
}

/**
 * Получение высоты рельефа (м над уровнем моря) с билинейной интерполяцией
 * по 4 соседним точкам матрицы GeoTIFF для сглаживания 30-метровых ступенек
 */
export function getTerrainElevation(lat: number, lng: number): number | null {
  const latFloor = Math.floor(lat);
  const lngFloor = Math.floor(lng);
  const key = `${latFloor}_${lngFloor}`;

  const tile = rendererDemCache.get(key);
  if (!tile) {
    // Если тайл еще не в кэше — запрашиваем асинхронную подгрузку для следующих кадров
    ensureDemTileLoaded(latFloor, lngFloor);
    return null;
  }

  // Точные дробные координаты внутри матрицы (от 0 до width-1 / height-1)
  const u = (lng - lngFloor) * (tile.width - 1);
  const v = (1 - (lat - latFloor)) * (tile.height - 1);

  const x0 = Math.max(0, Math.min(tile.width - 1, Math.floor(u)));
  const x1 = Math.max(0, Math.min(tile.width - 1, x0 + 1));
  const y0 = Math.max(0, Math.min(tile.height - 1, Math.floor(v)));
  const y1 = Math.max(0, Math.min(tile.height - 1, y0 + 1));

  // Дробные веса смещения между соседними пикселями (от 0.0 до 1.0)
  const dx = u - x0;
  const dy = v - y0;

  // Высоты в 4 соседних узлах сетки
  const z00 = tile.data[y0 * tile.width + x0];
  const z10 = tile.data[y0 * tile.width + x1];
  const z01 = tile.data[y1 * tile.width + x0];
  const z11 = tile.data[y1 * tile.width + x1];

  // Защита от пустых зон (NoData в GeoTIFF обычно меньше -1000)
  if (z00 < -1000 || z10 < -1000 || z01 < -1000 || z11 < -1000) {
    return z00 > -1000 ? z00 : null;
  }

  // Билинейная интерполяция по горизонтали и вертикали
  const top = z00 * (1 - dx) + z10 * dx;
  const bottom = z01 * (1 - dx) + z11 * dx;
  return top * (1 - dy) + bottom * dy;
}

/**
 * Расчет GPS-координат цели для камеры 90° вниз (в надир)
 * с вычитанием рельефа DEM из GPS-высоты БПЛА (ASL)
 */
export function calculateTargetGps(
  telemetry: Telemetry,
  bbox: BBox,
  fallbackCourseDeg: number = 0
): { targetLat: number; targetLng: number; distanceMeters: number; targetElevation?: number } {
  // 1. Нормализация смещения от центра кадра в диапазон [-1 ... +1]
  const normOffsetX = (bbox.x_center - 0.5) * 2;
  const normOffsetY = (0.5 - bbox.y_center) * 2; // Верх кадра = вперед по курсу (+Y)

  // 2. Углы отклонения луча от вертикали (в радианах)
  const halfHfovRad = (CAMERA_CONFIG.HFOV_DEG * Math.PI) / 360;
  const halfVfovRad = (CAMERA_CONFIG.VFOV_DEG * Math.PI) / 360;

  const alphaX = Math.atan(normOffsetX * Math.tan(halfHfovRad));
  const alphaY = Math.atan(normOffsetY * Math.tan(halfVfovRad));

  // Курс БПЛА (Yaw) в радианах
  const courseDeg = telemetry.yaw !== undefined ? telemetry.yaw : fallbackCourseDeg;
  const yawRad = (courseDeg * Math.PI) / 180;

  // 3. Начальная истинная высота камеры над землей (H = Z_GPS - Z_DEM)
  const droneGpsAsl = Math.max(1, telemetry.altitude || 100);
  const droneGroundElev = getTerrainElevation(telemetry.lat, telemetry.lng);

  // Если GPS-высота больше высоты рельефа под дроном — вычитаем рельеф.
  // Иначе (например, на тестовых данных с малой высотой) берем саму высоту как AGL.
  let effectiveHeight =
    droneGroundElev !== null && droneGpsAsl > droneGroundElev + 2
      ? droneGpsAsl - droneGroundElev
      : droneGpsAsl;

  let targetLat = telemetry.lat;
  let targetLng = telemetry.lng;
  let dNorth = 0;
  let dEast = 0;
  let targetElevation: number | undefined =
    droneGroundElev !== null ? Math.round(droneGroundElev) : undefined;

  const EARTH_RADIUS = 6378137;
  const cosLat = Math.cos((telemetry.lat * Math.PI) / 180);

  const MAX_ITERATIONS = 8;
  const CONVERGENCE_EPSILON_M = 0.05; // Порог сходимости 5 см

  // 4. Адаптивная трассировка луча к рельефу
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Смещение по земле в системе координат кадра (метры)
    const rightMeters = effectiveHeight * Math.tan(alphaX);
    const forwardMeters = effectiveHeight * Math.tan(alphaY);

    // Поворот вектора смещения по курсу БПЛА (Север / Восток)
    dNorth = forwardMeters * Math.cos(yawRad) - rightMeters * Math.sin(yawRad);
    dEast = forwardMeters * Math.sin(yawRad) + rightMeters * Math.cos(yawRad);

    // Перевод метров в градусы широты и долготы
    const dLat = (dNorth / EARTH_RADIUS) * (180 / Math.PI);
    const dLng = (dEast / (EARTH_RADIUS * cosLat)) * (180 / Math.PI);

    targetLat = telemetry.lat + dLat;
    targetLng = telemetry.lng + dLng;

    // Запрос интерполированной высоты рельефа в точке падения луча
    const elevAtTarget = getTerrainElevation(targetLat, targetLng);
    if (elevAtTarget !== null) {
      targetElevation = Math.round(elevAtTarget);

      if (droneGpsAsl > elevAtTarget + 2) {
        const nextHeight = droneGpsAsl - elevAtTarget;
        const diff = Math.abs(nextHeight - effectiveHeight);

        // Плавное схождение для защиты от колебаний на крутых склонах
        effectiveHeight = effectiveHeight * 0.3 + nextHeight * 0.7;

        // Досрочный выход, если луч сошелся с рельефом точнее чем на 5 см
        if (diff < CONVERGENCE_EPSILON_M) {
          break;
        }
      }
    } else {
      break;
    }
  }

  const groundDistance = Math.hypot(dNorth, dEast);

  return {
    targetLat,
    targetLng,
    distanceMeters: Math.round(groundDistance),
    targetElevation
  };
}

/**
 * Вычисляет расстояние (в метрах) и азимут (0-360°) между двумя GPS-точками
 */
export function calculateDistanceAndBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): { distanceMeters: number; bearingDeg: number } {
  const phi1 = degToRad(lat1);
  const phi2 = degToRad(lat2);
  const deltaPhi = degToRad(lat2 - lat1);
  const deltaLambda = degToRad(lng2 - lng1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceMeters = EARTH_RADIUS_M * c;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const bearingDeg = (radToDeg(Math.atan2(y, x)) + 360) % 360;

  return { distanceMeters, bearingDeg };
}