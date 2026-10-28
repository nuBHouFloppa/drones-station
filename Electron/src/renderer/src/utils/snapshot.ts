import { DroneData, Detection, classColors, classTranslations } from '../types';

export const exportFrameSnapshot = (
  frameData: DroneData | null | undefined,
  detections: Detection[]
): void => {
  if (!frameData?.image_base64) return;

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const hudHeight = 44;
    const imgW = img.naturalWidth || 1280;
    const imgH = img.naturalHeight || 720;

    canvas.width = imgW;
    canvas.height = imgH + hudHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Отрисовка видеокадра
    ctx.drawImage(img, 0, 0, imgW, imgH);

    // 2. Отрисовка рамок и вероятностей
    ctx.font = 'bold 14px Consolas, monospace';
    detections.forEach(det => {
      const x = (det.bbox.x_center - det.bbox.width / 2) * imgW;
      const y = (det.bbox.y_center - det.bbox.height / 2) * imgH;
      const w = det.bbox.width * imgW;
      const h = det.bbox.height * imgH;
      const color = classColors[det.class] || '#ffffff';
      const label = `${classTranslations[det.class] || det.class} [${(det.confidence * 100).toFixed(0)}%]`;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      const textWidth = ctx.measureText(label).width + 10;
      const labelY = y > 22 ? y - 22 : y;
      ctx.fillStyle = color;
      ctx.fillRect(x, labelY, textWidth, 20);

      ctx.fillStyle = '#000000';
      ctx.fillText(label, x + 5, labelY + 15);
    });

    // 3. Отрисовка нижней панели телеметрии
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, imgH, imgW, hudHeight);
    ctx.strokeStyle = '#333333';
    ctx.beginPath();
    ctx.moveTo(0, imgH);
    ctx.lineTo(imgW, imgH);
    ctx.stroke();

    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 15px Consolas, monospace';
    const { lat, lng, altitude } = frameData.telemetry;
    const timeStr = new Date().toLocaleString('ru-RU');
    const hudText = `ВРЕМЯ: ${timeStr}   |   ШИРОТА: ${lat.toFixed(6)}   |   ДОЛГОТА: ${lng.toFixed(6)}   |   ВЫСОТА: ${altitude.toFixed(1)} М   |   ЦЕЛЕЙ: ${detections.length}`;
    ctx.fillText(hudText, 16, imgH + 27);

    // 4. Сохранение файла
    const link = document.createElement('a');
    link.download = `uav_snapshot_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  img.src = frameData.image_base64.startsWith('data:image')
    ? frameData.image_base64
    : `data:image/jpeg;base64,${frameData.image_base64}`;
};