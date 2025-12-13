"""
Demo: decide SCANNED color (BLUE/GREEN) by barcode on the host.

Workflow:
- Phone scans a barcode and sends `barcode_result`.
- Host looks up the barcode in a mapping (can be replaced by your DB).
- Host sends `state_update` with BLUE or GREEN back to the phone.

Run:
  cd host
  pip install -r requirements.txt
  python barcode_color_map_demo.py

Edit `host/barcode_color_map.json` to control which barcodes map to BLUE/GREEN.
"""

import asyncio
import json
from pathlib import Path
from typing import Dict

from robot_vision_beacon_server import BarcodeResult, ColorState, RobotVisionBeaconServer


def load_map(path: Path) -> Dict[str, str]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def decide_color(code: str, mapping: Dict[str, str]) -> ColorState:
    value = (mapping.get(code) or "GREEN").upper()
    if value == "BLUE":
        return ColorState.BLUE
    return ColorState.GREEN


async def main() -> None:
    server = RobotVisionBeaconServer()
    mapping_path = Path(__file__).with_name("barcode_color_map.json")
    mapping = load_map(mapping_path)

    async def on_barcode(result: BarcodeResult) -> None:
        nonlocal mapping
        # Reload map on each scan so you can edit JSON without restarting.
        mapping = load_map(mapping_path)
        color = decide_color(result.code, mapping)
        print(f"[map] {result.code} -> {color.value}")
        await server.send_state(color, source="host")

    server.set_barcode_callback(on_barcode)

    print("RobotVisionBeaconServer listening on ws://0.0.0.0:8765")
    print(f"Using map: {mapping_path}")
    print("Press Ctrl+C to stop.")
    await server.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

