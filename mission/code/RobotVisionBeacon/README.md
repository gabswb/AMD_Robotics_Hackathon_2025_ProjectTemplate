RobotVisionBeacon (GREEN/RED version)
====================================

This project is a lightweight "vision beacon" that connects:

- an iOS device (front camera) and
- a host machine (your robot / lerobot / VLA computer)

via a small WebSocket protocol with a small set of color states:

- `GREEN`: barcode detected successfully,
- `RED`: default / error / reset state.
- `BLUE`: optional success variant (used by the phone's "blue chance" mode).

The phone:

- shows a camera view in the top half of the screen (front camera),
- shows a large green/red signal area in the bottom half,
- starts in `RED`,
- turns `GREEN` automatically when a barcode is detected,
- can optionally show `BLUE` as an alternative scanned state,
- sends the barcode and state to the host over WebSocket,
- can be tapped to manually return to `RED`.

The host:

- runs a minimal WebSocket server (`host/robot_vision_beacon_server.py`),
- receives barcode results and state updates from the phone,
- can optionally send `GREEN` / `RED` state commands back to the phone.


Repository layout
-----------------

- `RobotVisionBeacon/`
  - Xcode target for the iOS app:
    - `RobotVisionBeaconApp.swift`: app entry point.
    - `ContentView.swift`: UI layout + state machine (camera on top, signal on bottom).
    - `BarcodeScanner.swift`: Vision-based barcode detection (front camera, large ROI, ~10 Hz).
    - `CameraView.swift`: camera preview layer wrapper.
    - `WebSocketClient.swift`: WebSocket client (JSON protocol).
- `host/`
  - Minimal Python WebSocket server:
    - `robot_vision_beacon_server.py`
    - `requirements.txt`


Protocol (simplified)
---------------------

Transport: WebSocket (JSON text frames).

Color states:

- `GREEN`: success state.
- `RED`: default / failure / reset state.
- `BLUE`: optional success state.

`GREEN` and `BLUE` are both treated as "SCANNED" states.

Message types:

- `hello`
  - Sent by host when the phone connects:
  - Example:
    ```json
    {"type": "hello", "source": "host", "state": "RED"}
    ```

- `state_update`
  - Both host and phone can send:
  - Example (host → phone):
    ```json
    {"type": "state_update", "source": "host", "state": "GREEN"}
    ```
  - Example (phone → host, manual tap):
    ```json
    {"type": "state_update", "source": "phone", "state": "RED", "manual": true}
    ```

- `barcode_result`
  - Sent by the phone when it detects a barcode:
  - Example:
    ```json
    {
      "type": "barcode_result",
      "source": "phone",
      "code": "1234567890123",
      "symbology": "EAN13",
      "confidence": 0.95
    }
    ```

- `heartbeat`
  - Optional keep-alive from phone:
    ```json
    {"type": "heartbeat", "source": "phone"}
    ```

Any `state` values other than `GREEN` / `RED` / `BLUE` are ignored by the host server.


Host side: setup and usage
--------------------------

1. Install dependencies (Python 3.10+ recommended):

   ```bash
   cd host
   pip install -r requirements.txt
   ```

2. Run the minimal WebSocket server:

   ```bash
   python robot_vision_beacon_server.py
   ```

   - Listens on `ws://0.0.0.0:8765`.
   - Prints:
     - incoming `state_update` events (GREEN/RED from the phone),
     - incoming `barcode_result` events (barcodes detected by the phone).

3. Integrate into your own host code (optional):

   Import and use `RobotVisionBeaconServer`:

   ```python
   import asyncio
   from host.robot_vision_beacon_server import RobotVisionBeaconServer, ColorState

   async def main():
       server = RobotVisionBeaconServer()

       async def on_state(state, meta):
           print("state:", state.value, "manual:", meta.get("manual"))

       async def on_barcode(result):
           print("barcode:", result.code, result.symbology, result.confidence)

       server.set_state_callback(on_state)
       server.set_barcode_callback(on_barcode)

       # Example: force phone to RED at startup:
       await server.send_state(ColorState.RED)

       await server.run()

   asyncio.run(main())
   ```


iOS app: setup and usage
------------------------

The Swift files are already in `RobotVisionBeacon/`. In Xcode:

1. Open `RobotVisionBeacon.xcodeproj`.
2. Ensure these files are part of the main app target:
   - `RobotVisionBeaconApp.swift`
   - `ContentView.swift`
   - `WebSocketClient.swift`
   - `CameraView.swift`
   - `BarcodeScanner.swift`
   (If any file is not in the target, select it in Xcode and tick your app
   target under "Target Membership" in the File Inspector.)
3. Configure camera permission:
   - In your app target `Info` tab (or `Info.plist`), add:
     - Key: `Privacy - Camera Usage Description` (`NSCameraUsageDescription`)
     - Value: e.g. `用于条码识别和信号显示`
4. Set the host IP in `ContentView.swift`:
   - Edit:
     ```swift
     private let hostAddress: String = "192.168.1.10"
     ```
   - Replace `192.168.1.10` with your host machine's IP:
     - Wi‑Fi: the IP shown in macOS / Linux network settings.
     - USB-tethering: the IP of the USB network interface.
5. Build and run on a real device:
   - Select your iPhone as the run target in Xcode.
   - Make sure signing (`Signing & Capabilities`) is configured with your Apple ID.
   - Press Run.


How the app behaves
-------------------

- Top half:
  - Front camera preview.
  - White rounded rectangle as the scan frame.
  - Barcode detection:
    - Uses Vision (`VNDetectBarcodesRequest`),
    - Common symbologies: EAN-13, EAN-8, Code 128, QR,
    - Large ROI in the top half and up to ~10 detections per second.

- Bottom half:
  - Solid color background: `RED` (default) or `GREEN` (after success).
  - Shows:
    - `Signal: GREEN/RED`
    - `WebSocket: connecting/connected/disconnected/error`
    - latest detected barcode string (if any).
  - Tap bottom area:
    - If current state is `GREEN`, it changes back to `RED`,
    - Sends a `state_update` with `"manual": true` to the host.

- Automatic transitions:
  - On startup: app sets state to `RED`.
  - When a barcode is detected while in `RED`:
    - App turns `GREEN`,
    - Sends `barcode_result` and `state_update` (manual = false) to the host.
  - If the host sends a `state_update` with `"state": "RED"` or `"GREEN"`:
    - App updates its color accordingly.


Typical test flow
-----------------

1. Start the host server:

   ```bash
   cd host
   python robot_vision_beacon_server.py
   ```

2. Run the iOS app on a real device with `hostAddress` set to the host IP.

3. Watch the terminal:

   - When the app connects, you see `hello` / connection logs.
   - When you scan a barcode:
     - The bottom half turns GREEN.
     - The terminal prints a `barcode_result` and a `state_update (GREEN)`.

4. Tap the bottom half of the phone screen:

   - The signal returns to RED.
   - The terminal prints `state_update (RED, manual=True)`.

You now have a working, minimal two-color beacon integrated between phone and
host. You can wire `state_update` and `barcode_result` into your robot control
or VLA logic as needed.

Host-decided BLUE/GREEN by barcode (reserved interface)
-------------------------------------------------------

For collecting training data, the phone can pick BLUE/GREEN randomly (menu: "Random on phone").
To reserve an interface for deterministic labeling by product database, you can set the phone menu
to "Host by barcode" and let the host decide the scanned color:

- Phone sends `barcode_result` with the scanned barcode.
- Host looks up the barcode in your DB and sends `state_update` with `BLUE` or `GREEN`.

Demo script:

```bash
cd host
python barcode_color_map_demo.py
```

Edit `host/barcode_color_map.json` to map specific barcodes to `BLUE` or `GREEN`.
