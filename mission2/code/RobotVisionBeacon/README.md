# RobotVisionBeacon + Santa’s Happiness Warehouse

RobotVisionBeacon is a lightweight WebSocket “vision beacon” system that connects:

- an iOS barcode-scanner app (front camera) and
- a host WebSocket server (your robot / lerobot / VLA computer)

This repo also includes a static web dashboard: **Santa’s Happiness Warehouse**, a 3‑lane kanban UI used to assign scanned barcodes to “Kid 1 / Kid 2” and track collection progress.

## Repository layout

- `iOSapp/`
  - Xcode project for the iOS app:
    - `iOSapp/RobotVisionBeacon.xcodeproj`
    - Swift sources under `iOSapp/RobotVisionBeacon/`
- `host/`
  - Python WebSocket server + demos:
    - `host/robot_vision_beacon_server.py`
    - `host/interactive_demo.py`
    - `host/barcode_color_map_demo.py`
    - `host/requirements.txt`
- `webapp/`
  - Static dashboard UI (no build step):
    - `webapp/index.html`, `webapp/app.js`, `webapp/styles.css`
    - `webapp/README.md`
- `run_backend.sh`
  - Convenience wrapper for `host/` scripts (assumes dependencies installed).

## Quick start (recommended)

### 1) Start the host server (Python)

From `mission/code/RobotVisionBeacon`:

```bash
python -m pip install -r host/requirements.txt
python host/interactive_demo.py --any-key-red
```

- If you use conda (example env name `lerobot`):
  ```bash
  ~/miniconda3/bin/conda run -n lerobot python -m pip install -r host/requirements.txt
  ~/miniconda3/bin/conda run -n lerobot python host/interactive_demo.py --any-key-red
  ```

- Listens on `ws://0.0.0.0:8765`.
- Press any key in the terminal to send `RED` to the phone (used as “collected” in the webapp).

### 2) Start the webapp (Santa’s Happiness Warehouse)

```bash
python3 -m http.server 5173 --directory webapp
```

Open `http://localhost:5173`, click **Entry →**, open the 🎁 drawer, and set WebSocket URL to:

- `ws://localhost:8765` (if browser runs on the same host), or
- `ws://<host-ip>:8765` (if opening the webapp from another machine).

### 3) Run the iOS app

In Xcode:

1. Open `iOSapp/RobotVisionBeacon.xcodeproj`.
2. Set the host IP in the app (search for `hostAddress` in the Swift sources).
3. Run on a real device (camera required).

## How the “Santa’s Happiness Warehouse” workflow works

1. Create recorded items (🎁 drawer) and create cards in **Warehouse Storage**.
2. Drag cards into:
   - **Kid 1** wishlist (assigned signal `GREEN`), or
   - **Kid 2** wishlist (assigned signal `BLUE`).
3. When the phone scans a barcode:
   - it sends `barcode_result` to the host,
   - the host forwards that barcode to other clients (webapp),
   - and the host also drives the phone UI color based on the wishlist assignment:
     - Kid 1 → `GREEN`
     - Kid 2 → `BLUE`
4. When the host later sends `state_update: RED` (e.g. `interactive_demo.py --any-key-red`):
   - the webapp marks the most recently “putting away…” card as **collected**.

## Protocol (JSON over WebSocket)

### Color states

- `GREEN`: scanned/assigned to Kid 1
- `BLUE`: scanned/assigned to Kid 2
- `RED`: reset / collected signal (used by the webapp)

### Messages

- `hello` (host → client on connect)
  ```json
  {"type":"hello","source":"host","state":"RED"}
  ```

- `barcode_result` (phone → host)
  ```json
  {"type":"barcode_result","source":"phone","code":"123","symbology":"QR","confidence":0.95}
  ```

- `state_update` (either direction)
  ```json
  {"type":"state_update","source":"host","state":"GREEN"}
  ```

- `assignment_update` (webapp/dashboard → host, optional)
  - Assign a barcode to a host-driven phone color on scan:
  ```json
  {"type":"assignment_update","source":"webapp","code":"123","state":"BLUE"}
  ```
  - Unassign:
  ```json
  {"type":"assignment_update","source":"webapp","code":"123","state":null}
  ```

- `assignment_sync` (webapp/dashboard → host, optional)
  ```json
  {"type":"assignment_sync","source":"webapp","targets":{"123":"GREEN","456":"BLUE"}}
  ```

### Multi-client note

The host server is designed to handle multiple WebSocket clients at once (e.g. phone + webapp):

- It forwards (rebroadcasts) client‑sent `barcode_result` / `state_update` messages to other connected clients.
- It can also actively send `state_update` to drive the phone UI.

## Quirks / notes

- **Python env**: `host/` requires `websockets` (see `host/requirements.txt`). If you use conda, ensure you install it into that env (e.g. `lerobot`).
- **`run_backend.sh`**: defaults to `python3`; if you want to run inside conda, set `PYTHON` (or use `conda run` directly).
- **`interactive_demo.py`** uses `termios/tty` and expects a local terminal (macOS/Linux).
- **Webapp persistence**: recorded-item images are stored in `localStorage` and are compressed, but very large images can still hit browser storage limits.
- **Webapp CSS**: column border styling uses modern CSS (e.g. `color-mix()`); if you see missing accents on older browsers, try a newer Chrome/Safari.
