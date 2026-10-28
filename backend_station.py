import os
import time
import struct
import threading
import asyncio
import base64
import json
from concurrent.futures import ThreadPoolExecutor
import serial
import websockets

ORANGE_PI_IP = '192.168.1.200'  
DRONE_WS_URL = f'ws://{ORANGE_PI_IP}:8765'

RADIO_PORT = 'COM5'
RADIO_BAUD = 57600

SAVE_DIR = 'received_frames'

FRAME_WIDTH = 1920
FRAME_HEIGHT = 1080

UI_WS_HOST = '0.0.0.0'
UI_WS_PORT = 8080

CLASSES = ['human', 'transport', 'stuff', 'smoke', 'fire', 'postburn']
# ===================================================

os.makedirs(SAVE_DIR, exist_ok=True)

disk_writer_pool = ThreadPoolExecutor(max_workers=2)

telemetry_lock = threading.Lock()
latest_telemetry = {
    "lat": 55.9821,
    "lng": 37.4108,
    "altitude": 100.0,
    "speed": 0.0,
    "yaw": 0.0,
    "pitch": 0.0
}
latest_detections = []

broadcast_queue = asyncio.Queue()
asyncio_loop = None
connected_ui_clients = set()


def write_file_worker(filepath, jpeg_bytes):
    try:
        with open(filepath, 'wb') as f:
            f.write(jpeg_bytes)
    except Exception as e:
        print(f"[Ошибка диска]: {e}")


def parse_radio_packet(line):
    global latest_telemetry, latest_detections
    if not line.startswith('@ID:'):
        return

    try:
        fields = {}
        for part in line[1:].split('|'):
            if ':' in part:
                k, v = part.split(':', 1)
                fields[k] = v

        lat = float(fields.get('LAT', 0.0))
        lon = float(fields.get('LON', 0.0))
        alt = float(fields.get('ALT', 0.0))
        spd = float(fields.get('SPD', 0.0))
        crs = float(fields.get('CRS', 0.0))
        obj_raw = fields.get('OBJ', 'NONE')

        detections = []
        if obj_raw != 'NONE' and obj_raw:
            for item in obj_raw.split(';'):
                parts = item.split(':')
                if len(parts) == 6:
                    cid = int(parts[0])
                    conf = float(parts[1])
                    x_min = float(parts[2])
                    y_min = float(parts[3])
                    box_w = float(parts[4])
                    box_h = float(parts[5])

                    x_center = (x_min + box_w / 2.0) / FRAME_WIDTH
                    y_center = (y_min + box_h / 2.0) / FRAME_HEIGHT
                    norm_w = box_w / FRAME_WIDTH
                    norm_h = box_h / FRAME_HEIGHT

                    cname = CLASSES[cid] if 0 <= cid < len(CLASSES) else f"cls_{cid}"

                    detections.append({
                        "class": cname,
                        "class_name": cname,
                        "confidence": conf,
                        "bbox": {
                            "x_center": max(0.0, min(1.0, x_center)),
                            "y_center": max(0.0, min(1.0, y_center)),
                            "width": max(0.0, min(1.0, norm_w)),
                            "height": max(0.0, min(1.0, norm_h))
                        }
                    })

        with telemetry_lock:
            latest_telemetry = {
                "lat": lat,
                "lng": lon,
                "altitude": alt,
                "speed": spd,
                "yaw": crs,
                "pitch": 0.0
            }
            latest_detections = detections

    except Exception as e:
        print(f"[Ошибка парсинга радио]: {line} -> {e}")


def radio_listener_thread():
    print(f"[Радио] Открытие порта {RADIO_PORT} ({RADIO_BAUD})...")
    try:
        rx = serial.Serial(RADIO_PORT, RADIO_BAUD, timeout=0.1)
        rx.reset_input_buffer()
        print("[Радио] COM-порт открыт. Приём телеметрии запущен.\n")
        buffer = ""

        while True:
            if rx.in_waiting > 0:
                chunk = rx.read(rx.in_waiting).decode('ascii', errors='ignore')
                buffer += chunk
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    line = line.strip()
                    if line.startswith('@ID:'):
                        parse_radio_packet(line)
            else:
                time.sleep(0.005)
    except Exception as e:
        print(f"[Радио Ошибка]: {e}")


async def drone_wifi_receiver():
    while True:
        try:
            print(f"[Wi-Fi] Подключение к Orange Pi {DRONE_WS_URL}...")
            async with websockets.connect(DRONE_WS_URL, max_queue=None) as ws:
                print(f"[Wi-Fi] Видеопоток подключен! Трансляция активна.\n")
                while True:
                    data = await ws.recv()
                    if isinstance(data, bytes) and len(data) > 4:
                        frame_id = struct.unpack('>I', data[:4])[0]
                        jpeg_bytes = data[4:]

                        # 1. Фоновое сохранение на диск
                        filepath = os.path.join(SAVE_DIR, f"frame_{frame_id}.jpg")
                        disk_writer_pool.submit(write_file_worker, filepath, jpeg_bytes)

                        # 2. Формируем Base64
                        b64_str = base64.b64encode(jpeg_bytes).decode('utf-8')
                        image_data_url = f"data:image/jpeg;base64,{b64_str}"

                        # 3. Берём свежую телеметрию из радио
                        with telemetry_lock:
                            telem_copy = dict(latest_telemetry)
                            det_copy = list(latest_detections)

                        payload = {
                            "frame_id": frame_id,
                            "telemetry": telem_copy,
                            "image_base64": image_data_url,
                            "detections": det_copy,
                            "timestamp": time.time()
                        }

                        await broadcast_queue.put(payload)

        except Exception as e:
            print(f"[Wi-Fi] Ошибка соединения ({e}). Реконнект через 2 сек...")
            await asyncio.sleep(2.0)


async def ui_ws_handler(websocket, *args):
    print(f"[UI] Клиент фронтенда подключен!")
    connected_ui_clients.add(websocket)
    try:
        async for _ in websocket:
            pass
    except Exception:
        pass
    finally:
        connected_ui_clients.discard(websocket)
        print(f"[UI] Клиент фронтенда отключился.")


async def ui_broadcaster():
    while True:
        payload = await broadcast_queue.get()
        if connected_ui_clients:
            msg_str = json.dumps(payload)
            dead_clients = set()
            for ws in list(connected_ui_clients):
                try:
                    await ws.send(msg_str)
                except Exception:
                    dead_clients.add(ws)
            for ws in dead_clients:
                connected_ui_clients.discard(ws)
        broadcast_queue.task_done()


async def main_async():
    global asyncio_loop
    asyncio_loop = asyncio.get_running_loop()

    await websockets.serve(ui_ws_handler, UI_WS_HOST, UI_WS_PORT)
    print(f"[UI Сервер] Ожидание подключения фронтенда на ws://localhost:{UI_WS_PORT}")

    await asyncio.gather(
        drone_wifi_receiver(),
        ui_broadcaster()
    )


def main():
    t_radio = threading.Thread(target=radio_listener_thread, daemon=True)
    t_radio.start()

    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        print("\nОстановка.")


if __name__ == '__main__':
    main()