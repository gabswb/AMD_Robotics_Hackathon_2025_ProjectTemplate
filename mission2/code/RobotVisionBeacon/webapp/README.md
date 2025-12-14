# Santa’s Happiness Warehouse (webapp)

Static front-end (no build step) for the RobotVisionBeacon demo.

## Run

From `mission/code/RobotVisionBeacon/webapp`:

```bash
python3 -m http.server 5173
```

Open `http://localhost:5173`.

## Scanner integration (optional)

This UI can listen to the RobotVisionBeacon WebSocket protocol:

- `barcode_result` (with `code`) → sets the matching wishlist card to **putting away…**
- `state_update` with `state: "RED"` → marks the most recently scanned card as **collected**

Default URL is `ws://localhost:8765`. You can change it in the 🎁 drawer.

