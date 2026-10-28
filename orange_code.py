import cv2
import numpy as np
import time
import struct
import threading
import queue
import asyncio
import serial
import websockets
from rknnlite.api import RKNNLite

MODEL_PATH = 'best.rknn' 
VIDEO_SOURCE = 0
JPEG_QUALITY = 75

GPS_PORT = '/dev/ttyS4'
GPS_BAUD = 115200         

RADIO_PORT = '/dev/ttyUSB0'
RADIO_BAUD = 57600
RADIO_MAX_FPS = 10       

WS_HOST = '0.0.0.0'
WS_PORT = 8765

CONF_THRESHOLD = 0.25
NMS_THRESHOLD = 0.45

ORIG_WIDTH = 1920
ORIG_HEIGHT = 1080
TILE_SIZE = 1024          
NN_SIZE = 640
KEYFRAME_INTERVAL = 4     

TILES_OFFSETS = [
    (0, 0),                                         
    (ORIG_WIDTH - TILE_SIZE, 0),                     
    (0, ORIG_HEIGHT - TILE_SIZE),                    
    (ORIG_WIDTH - TILE_SIZE, ORIG_HEIGHT - TILE_SIZE) 
]

CLASSES = ['human', 'transport', 'stuff', 'smoke', 'fire', 'postburn']

class RKNNPool:
    def __init__(self, model_path, num_threads=3):
        self.num_threads = num_threads
        self.input_queue = queue.Queue(maxsize=12)
        self.output_queue = queue.Queue(maxsize=12)
        self.rknn_pool = []
        self.threads = []
        self.running = True

        core_masks = [RKNNLite.NPU_CORE_0, RKNNLite.NPU_CORE_1, RKNNLite.NPU_CORE_2]

        for i in range(num_threads):
            rknn = RKNNLite()
            if rknn.load_rknn(model_path) != 0:
                raise RuntimeError(f"Ошибка загрузки модели для Core {i}")
            
            if rknn.init_runtime(core_mask=core_masks[i % 3]) != 0:
                raise RuntimeError(f"Ошибка инициализации Core {i}")
            
            self.rknn_pool.append(rknn)
            t = threading.Thread(target=self._worker, args=(rknn,), daemon=True)
            t.start()
            self.threads.append(t)

        print(f"[RKNNPool] Запущены {num_threads} ядра NPU (Core 0, Core 1, Core 2).")

    def _worker(self, rknn_instance):
        while self.running:
            try:
                task = self.input_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            tile_id, tensor, extra = task
            try:
                outputs = rknn_instance.inference(inputs=[tensor])
            except Exception as e:
                print(f"[Ошибка NPU]: {e}")
                outputs = None

            self.output_queue.put((tile_id, outputs, extra))
            self.input_queue.task_done()

    def submit(self, tile_id, tensor, extra):
        """Отправляет тайл в очередь свободного ядра NPU."""
        self.input_queue.put((tile_id, tensor, extra))

    def get_result(self, timeout=1.0):
        try:
            return self.output_queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def release(self):
        self.running = False
        for t in self.threads:
            t.join(timeout=0.5)
        for rknn in self.rknn_pool:
            rknn.release()


class GPSReader:
    def __init__(self, port, baud):
        self.port, self.baud = port, baud
        self.running, self.lock = True, threading.Lock()
        self.state = {'status': 'V', 'lat': 0.0, 'lon': 0.0, 'alt': 0.0, 'spd_kmh': 0.0, 'course': 0.0, 'sats': 0}
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    @staticmethod
    def _nmea_to_dec(c_str, dir):
        if not c_str or not dir: return 0.0
        try:
            val = float(c_str)
            dec = int(val // 100) + ((val % 100) / 60.0)
            return round(-dec if dir in ['S', 'W'] else dec, 6)
        except: return 0.0

    def _parse_line(self, line):
        parts = line.split('*')[0].split(',')
        if len(parts) < 6: return
        with self.lock:
            if parts[0].endswith('RMC') and len(parts) >= 9:
                self.state['status'] = parts[2] if parts[2] else 'V'
                if parts[2] == 'A':
                    self.state['lat'] = self._nmea_to_dec(parts[3], parts[4])
                    self.state['lon'] = self._nmea_to_dec(parts[5], parts[6])
                    self.state['spd_kmh'] = round((float(parts[7]) if parts[7] else 0.0) * 1.852, 1)
                    if parts[8]: self.state['course'] = round(float(parts[8]), 1)
            elif parts[0].endswith('GGA') and len(parts) >= 10:
                self.state['sats'] = int(parts[7]) if parts[7].isdigit() else 0
                if parts[9]: self.state['alt'] = round(float(parts[9]), 1)

    def _worker(self):
        try:
            ser = serial.Serial(self.port, self.baud, timeout=0.2)
            ser.reset_input_buffer()
            buffer = ""
            while self.running:
                if ser.in_waiting > 0:
                    buffer += ser.read(ser.in_waiting).decode('ascii', errors='ignore')
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        if line.strip().startswith('$G'): self._parse_line(line.strip())
                else: time.sleep(0.005)
            ser.close()
        except Exception as e: print(f"[GPS Ошибка]: {e}")

    def get_snapshot(self):
        with self.lock: return self.state.copy()
    def stop(self): self.running = False


class LatestFrameCapture:
    def __init__(self, src):
        self.cap = cv2.VideoCapture(src, cv2.CAP_V4L2)
        self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, ORIG_WIDTH)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, ORIG_HEIGHT)
        self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
        self.cap.set(cv2.CAP_PROP_FPS, 30)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)

        self.lock = threading.Lock()
        self.frame = None
        self.seq = 0
        self.running = True

        # Прогрев сенсора
        for _ in range(5):
            self.cap.read()

        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def _worker(self):
        while self.running:
            ret, frm = self.cap.read()
            if ret and frm is not None and frm.size > 0:
                if not frm.any():
                    continue

                with self.lock:
                    self.frame = frm
                    self.seq += 1
            else:
                time.sleep(0.002)

    def get_latest(self, last_seq):
        with self.lock:
            if self.frame is None or self.seq == last_seq:
                return None, last_seq
            return self.frame.copy(), self.seq

    def release(self):
        self.running = False
        self.thread.join(timeout=1.0)
        self.cap.release()


class LiveWebSocketServer:
    def __init__(self, host, port):
        self.host, self.port = host, port
        self.lock, self.latest_id, self.latest_payload = threading.Lock(), 0, None
        self.thread = threading.Thread(target=self._run_server, daemon=True)
        self.thread.start()

    def update_frame(self, frame_id, jpeg_bytes):
        with self.lock:
            self.latest_id = frame_id
            self.latest_payload = struct.pack('>I', frame_id) + jpeg_bytes

    async def _handler(self, websocket):
        sent_id = -1
        try:
            while True:
                payload = None
                with self.lock:
                    if self.latest_id > sent_id and self.latest_payload:
                        sent_id, payload = self.latest_id, self.latest_payload
                if payload: await websocket.send(payload)
                else: await asyncio.sleep(0.005)
        except websockets.exceptions.ConnectionClosed: pass

    def _run_server(self):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        async def start():
            async with websockets.serve(self._handler, self.host, self.port, max_queue=1):
                await asyncio.Future()
        loop.run_until_complete(start())


def extract_tile_boxes(outputs, scale, offset_x, offset_y):
    if outputs is None or len(outputs) == 0:
        return [], [], []

    preds = np.squeeze(outputs[0]).T
    scores = preds[:, 4:]
    cls_ids = np.argmax(scores, axis=1)
    confs = np.max(scores, axis=1)

    mask = confs > CONF_THRESHOLD
    if not np.any(mask):
        return [], [], []

    valid_boxes = preds[mask, :4]
    valid_confs = confs[mask]
    valid_cls = cls_ids[mask]

    x_c = (valid_boxes[:, 0] / scale) + offset_x
    y_c = (valid_boxes[:, 1] / scale) + offset_y
    w = valid_boxes[:, 2] / scale
    h = valid_boxes[:, 3] / scale

    x1 = np.clip((x_c - w / 2), 0, ORIG_WIDTH).astype(int)
    y1 = np.clip((y_c - h / 2), 0, ORIG_HEIGHT).astype(int)
    w_int = np.clip(w, 1, ORIG_WIDTH).astype(int)
    h_int = np.clip(h, 1, ORIG_HEIGHT).astype(int)

    boxes = np.stack([x1, y1, w_int, h_int], axis=1).tolist()
    return boxes, valid_confs.tolist(), valid_cls.tolist()


def merge_tiles_nms(all_boxes, all_confs, all_cls):
    if not all_boxes:
        return []

    detections = []
    indices = cv2.dnn.NMSBoxes(all_boxes, all_confs, CONF_THRESHOLD, NMS_THRESHOLD)
    if len(indices) > 0:
        for i in indices.flatten():
            detections.append((all_cls[i], round(float(all_confs[i]), 2), all_boxes[i]))
    return detections


def consumer_thread(pool, frame_queue, ws_server, radio, scale):
    last_radio_send = 0.0
    radio_interval = 1.0 / RADIO_MAX_FPS
    fps_cnt, fps_timer = 0, time.time()

    cached_detections = []

    while pool.running:
        try:
            item = frame_queue.get(timeout=0.5)
        except queue.Empty:
            continue

        frame_id, is_keyframe, frame, gps_snap = item

        if is_keyframe:
            all_boxes, all_confs, all_cls = [], [], []
            for _ in range(len(TILES_OFFSETS)):
                res = pool.get_result(timeout=1.0)
                if res is not None:
                    _, outputs, (off_x, off_y) = res
                    b, cf, cl = extract_tile_boxes(outputs, scale, off_x, off_y)
                    all_boxes.extend(b)
                    all_confs.extend(cf)
                    all_cls.extend(cl)

            cached_detections = merge_tiles_nms(all_boxes, all_confs, all_cls)

        detections = cached_detections

        ok, enc_jpg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
        if ok:
            ws_server.update_frame(frame_id, enc_jpg.tobytes())

        now = time.time()
        if (now - last_radio_send >= radio_interval) and (radio.out_waiting < 128):
            obj_strs = [f"{cid}:{cf}:{b[0]}:{b[1]}:{b[2]}:{b[3]}" for cid, cf, b in detections]
            obj_payload = ";".join(obj_strs) if obj_strs else "NONE"

            radio_packet = (
                f"@ID:{frame_id}|ST:{gps_snap['status']}|"
                f"LAT:{gps_snap['lat']}|LON:{gps_snap['lon']}|"
                f"ALT:{gps_snap['alt']}|SPD:{gps_snap['spd_kmh']}|"
                f"CRS:{gps_snap['course']}|SATS:{gps_snap['sats']}|"
                f"OBJ:{obj_payload}\n"
            )
            radio.write(radio_packet.encode('ascii'))
            radio.flush()
            last_radio_send = now

        frame_queue.task_done()

        fps_cnt += 1
        if time.time() - fps_timer >= 1.0:
            fps = fps_cnt / (time.time() - fps_timer)
            mode_str = "KEYFRAME 4x" if is_keyframe else "CACHED"
            print(f"[БОРТ SAHI] Кадр #{frame_id} ({mode_str}) | FPS: {fps:4.1f} | Объектов: {len(detections)}")
            fps_cnt, fps_timer = 0, time.time()


def main():
    try:
        radio = serial.Serial(RADIO_PORT, RADIO_BAUD, timeout=0.1)
        radio.reset_output_buffer()
    except Exception as e:
        print(f"Не удалось открыть радио: {e}"); return

    try:
        pool = RKNNPool(MODEL_PATH, num_threads=3)
    except Exception as e:
        print(e); return

    gps = GPSReader(GPS_PORT, GPS_BAUD)
    cam = LatestFrameCapture(VIDEO_SOURCE)
    ws_server = LiveWebSocketServer(WS_HOST, WS_PORT)

    frame_queue = queue.Queue(maxsize=4)
    scale = NN_SIZE / TILE_SIZE

    t_cons = threading.Thread(
        target=consumer_thread,
        args=(pool, frame_queue, ws_server, radio, scale),
        daemon=True
    )
    t_cons.start()

    print(f"Система запущена (3-Core SAHI 4x + Skip 3)! WS: {WS_PORT} | GPS: {GPS_BAUD} | Радио: {RADIO_PORT}")
    time.sleep(1.0)

    frame_id = 0
    last_cam_seq = -1

    try:
        while True:
            frame, cam_seq = cam.get_latest(last_cam_seq)
            if frame is None:
                time.sleep(0.001)
                continue
            last_cam_seq = cam_seq

            if frame_queue.full():
                continue

            frame_id += 1

            if frame.shape[1] != ORIG_WIDTH or frame.shape[0] != ORIG_HEIGHT:
                frame_rs = cv2.resize(frame, (ORIG_WIDTH, ORIG_HEIGHT))
            else:
                frame_rs = frame

            gps_snap = gps.get_snapshot()

            is_keyframe = (frame_id % KEYFRAME_INTERVAL == 1)

            if is_keyframe:
                for idx, (offset_x, offset_y) in enumerate(TILES_OFFSETS):
                    tile_input = np.zeros((1, NN_SIZE, NN_SIZE, 3), dtype=np.uint8)

                    tile = frame_rs[offset_y:offset_y + TILE_SIZE, offset_x:offset_x + TILE_SIZE]
                    resized = cv2.resize(tile, (NN_SIZE, NN_SIZE), interpolation=cv2.INTER_NEAREST)
                    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
                    tile_input[0, :, :, :] = rgb

                    pool.submit(idx, tile_input, extra=(offset_x, offset_y))

            frame_queue.put((frame_id, is_keyframe, frame_rs.copy(), gps_snap))

    except KeyboardInterrupt:
        print("\nОстановка бортовой программы...")
    finally:
        pool.release()
        cam.release()
        gps.stop()
        radio.close()

if __name__ == '__main__':
    main()