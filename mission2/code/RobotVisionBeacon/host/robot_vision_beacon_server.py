import asyncio
import json
import re
import subprocess
from dataclasses import dataclass
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set

import websockets


class ColorState(str, Enum):
    GREEN = "GREEN"
    RED = "RED"
    BLUE = "BLUE"


@dataclass
class BarcodeResult:
    code: str
    symbology: str
    confidence: float
    source: str


StateCallback = Callable[[ColorState, Dict[str, Any]], Awaitable[None]]
BarcodeCallback = Callable[[BarcodeResult], Awaitable[None]]


class RobotVisionBeaconServer:
    """
    Minimal WebSocket server for the beacon (RED / GREEN / BLUE).

    - Sends color state updates to the phone.
    - Receives manual overrides and barcode_result messages from the phone.
    """

    def __init__(self, host: str = "0.0.0.0", port: int = 8765) -> None:
        self._host = host
        self._port = port
        self._clients: Set[Any] = set()
        self._current_state: ColorState = ColorState.RED
        self._state_callback: Optional[StateCallback] = None
        self._barcode_callback: Optional[BarcodeCallback] = None
        # Optional: a dashboard (e.g. webapp) can assign a target color state
        # per barcode so the host can drive the phone UI on scans.
        self._barcode_target_state: Dict[str, ColorState] = {}
        # Optional: web dashboard interactive mode (for "any key = RED" control).
        # Modes:
        # - passive: interactive process running, but keys should not trigger RED
        # - any_key_red: any key triggers RED
        self._interactive_mode: str = "passive"

    def get_interactive_mode(self) -> str:
        return self._interactive_mode

    def set_state_callback(self, cb: StateCallback) -> None:
        self._state_callback = cb

    def set_barcode_callback(self, cb: BarcodeCallback) -> None:
        self._barcode_callback = cb

    def has_clients(self) -> bool:
        """
        Return True if at least one client (phone app) is connected.
        """
        return bool(self._clients)

    async def send_state(self, state: ColorState, source: str = "host") -> None:
        """
        Broadcast a new color state (GREEN / RED / BLUE) to all connected clients.
        """
        self._current_state = state
        msg = {
            "type": "state_update",
            "source": source,
            "state": state.value,
        }
        await self._broadcast(msg)

    async def send_barcode_result(
        self,
        code: str,
        symbology: str,
        confidence: float,
        source: str = "host",
    ) -> None:
        """
        Broadcast a barcode result to all connected clients.

        Normally barcodes are detected on the phone, but this is provided
        for completeness if the host also wants to report results.
        """
        msg = {
            "type": "barcode_result",
            "source": source,
            "code": code,
            "symbology": symbology,
            "confidence": confidence,
        }
        await self._broadcast(msg)

    async def _broadcast(self, payload: Dict[str, Any]) -> None:
        if not self._clients:
            return
        data = json.dumps(payload)
        await asyncio.gather(
            *[self._safe_send(ws, data) for ws in list(self._clients)],
            return_exceptions=True,
        )

    async def _broadcast_except(self, payload: Dict[str, Any], exclude: Any) -> None:
        if not self._clients:
            return
        data = json.dumps(payload)
        recipients = [ws for ws in list(self._clients) if ws is not exclude]
        if not recipients:
            return
        await asyncio.gather(
            *[self._safe_send(ws, data) for ws in recipients],
            return_exceptions=True,
        )

    async def _safe_send(self, ws: Any, data: str) -> None:
        try:
            await ws.send(data)
        except Exception:
            self._clients.discard(ws)

    async def _handle_client(self, websocket: Any) -> None:
        self._clients.add(websocket)
        try:
            # Send initial hello and current state.
            await websocket.send(
                json.dumps(
                    {
                        "type": "hello",
                        "source": "host",
                        "state": self._current_state.value,
                        "interactive_mode": self._interactive_mode,
                    }
                )
            )
            async for message in websocket:
                await self._handle_message(message, websocket)
        finally:
            self._clients.discard(websocket)

    async def _handle_message(self, message: str, websocket: Any) -> None:
        try:
            data = json.loads(message)
        except json.JSONDecodeError:
            return

        msg_type = data.get("type")
        if msg_type == "state_update":
            await self._on_state_update(data, websocket)
        elif msg_type == "barcode_result":
            await self._on_barcode_result(data, websocket)
        elif msg_type == "assignment_update":
            await self._on_assignment_update(data)
        elif msg_type == "assignment_sync":
            await self._on_assignment_sync(data)
        elif msg_type == "interactive_control":
            await self._on_interactive_control(data)
        elif msg_type == "interactive_key":
            await self._on_interactive_key(data)
        elif msg_type == "heartbeat":
            return

    async def _on_interactive_control(self, data: Dict[str, Any]) -> None:
        mode = data.get("mode")
        if not isinstance(mode, str):
            return
        mode = mode.strip()
        if mode not in ("stopped", "passive", "any_key_red"):
            return
        if mode == self._interactive_mode:
            return
        self._interactive_mode = mode
        await self._broadcast(
            {"type": "interactive_status", "source": "host", "mode": self._interactive_mode}
        )

    async def _on_interactive_key(self, data: Dict[str, Any]) -> None:
        if self._interactive_mode != "any_key_red":
            return
        # Any key from dashboard triggers RED.
        await self.send_state(ColorState.RED, source="host")

    async def _on_assignment_update(self, data: Dict[str, Any]) -> None:
        code = data.get("code") or data.get("barcode")
        if not code or not isinstance(code, str):
            return
        code = code.strip()
        if not code:
            return

        state_str = data.get("state")
        if state_str is None:
            self._barcode_target_state.pop(code, None)
            return

        if not isinstance(state_str, str):
            return
        state_str = state_str.strip().upper()
        if state_str in ("", "NONE", "NULL"):
            self._barcode_target_state.pop(code, None)
            return

        try:
            state = ColorState(state_str)
        except ValueError:
            return

        self._barcode_target_state[code] = state

    async def _on_assignment_sync(self, data: Dict[str, Any]) -> None:
        targets = data.get("targets")
        if not isinstance(targets, dict):
            return
        next_map: Dict[str, ColorState] = {}
        for code, state_str in targets.items():
            if not isinstance(code, str) or not isinstance(state_str, str):
                continue
            code = code.strip()
            state_str = state_str.strip().upper()
            if not code or state_str in ("", "NONE", "NULL"):
                continue
            try:
                next_map[code] = ColorState(state_str)
            except ValueError:
                continue
        self._barcode_target_state = next_map

    async def _on_state_update(self, data: Dict[str, Any], websocket: Any) -> None:
        state_str = data.get("state")
        if not state_str:
            return
        try:
            state = ColorState(state_str)
        except ValueError:
            # Ignore unsupported states (e.g. YELLOW/BLUE from older clients).
            return

        self._current_state = state
        if self._state_callback is not None:
            await self._state_callback(state, data)
        # Re-broadcast client state updates so dashboards (e.g. webapp) can react.
        await self._broadcast_except(data, exclude=websocket)

    async def _on_barcode_result(self, data: Dict[str, Any], websocket: Any) -> None:
        code = data.get("code")
        symbology = data.get("symbology", "")
        confidence = float(data.get("confidence", 0.0))
        source = data.get("source", "phone")
        if not code:
            return

        result = BarcodeResult(
            code=code,
            symbology=symbology,
            confidence=confidence,
            source=source,
        )
        if self._barcode_callback is not None:
            await self._barcode_callback(result)
        # Re-broadcast barcode results so dashboards (e.g. webapp) can match cards.
        await self._broadcast_except(data, exclude=websocket)

        # If a dashboard assigned this barcode to a "kid list", drive the phone
        # UI color from the host to indicate which list it belongs to.
        target_state = self._barcode_target_state.get(code)
        if target_state is not None:
            await self.send_state(target_state, source="host")

    async def run(self) -> None:
        """
        Run the WebSocket server forever.
        """
        async with websockets.serve(
            self._handle_client, self._host, self._port
        ):
            await asyncio.Future()  # run forever


def _get_host_ipv4_addresses() -> List[str]:
    """
    Best-effort IPv4 discovery to help configure the iOS device.

    Returns a list of non-loopback IPv4 addresses.
    """
    addrs: Set[str] = set()

    def add(addr: str) -> None:
        addr = addr.strip()
        if not addr:
            return
        if addr.startswith("127."):
            return
        addrs.add(addr)

    # Linux: iproute2
    try:
        res = subprocess.run(
            ["ip", "-4", "-o", "addr", "show"],
            check=False,
            capture_output=True,
            text=True,
        )
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                # e.g. "2: en0    inet 192.168.1.10/24 ..."
                m = re.search(r"\binet\s+(\d+\.\d+\.\d+\.\d+)/", line)
                if m:
                    add(m.group(1))
    except FileNotFoundError:
        pass

    # macOS / fallback: ifconfig
    if not addrs:
        try:
            res = subprocess.run(
                ["ifconfig"],
                check=False,
                capture_output=True,
                text=True,
            )
            if res.returncode == 0:
                for line in res.stdout.splitlines():
                    line = line.strip()
                    if line.startswith("inet "):
                        parts = line.split()
                        if len(parts) >= 2:
                            add(parts[1])
        except FileNotFoundError:
            pass

    # Prefer RFC1918 addresses first for readability.
    def score(a: str) -> int:
        try:
            parts = [int(p) for p in a.split(".")]
        except Exception:
            return 9

        # RFC1918: 10/8, 172.16/12, 192.168/16
        if parts[0] == 10:
            return 0
        if parts[0] == 192 and parts[1] == 168:
            return 0
        if parts[0] == 172 and 16 <= parts[1] <= 31:
            return 0

        # Link-local
        if parts[0] == 169 and parts[1] == 254:
            return 2

        return 1

    return sorted(addrs, key=lambda x: (score(x), x))


async def _demo() -> None:
    """
    Simple demo: run the server and print incoming events.
    """
    server = RobotVisionBeaconServer()

    async def on_state(state: ColorState, metadata: Dict[str, Any]) -> None:
        print(
            f"[state] {state.value} from {metadata.get('source')} "
            f"manual={metadata.get('manual')}"
        )

    async def on_barcode(result: BarcodeResult) -> None:
        print(
            f"[barcode] {result.code} ({result.symbology}) "
            f"conf={result.confidence:.2f} source={result.source}"
        )

    server.set_state_callback(on_state)
    server.set_barcode_callback(on_barcode)

    print("RobotVisionBeaconServer listening on ws://0.0.0.0:8765")
    ipv4_addrs = _get_host_ipv4_addresses()
    if ipv4_addrs:
        print("Host IPv4 addresses (use one in the iOS app):")
        for addr in ipv4_addrs:
            print(f"  - {addr}  (ws://{addr}:8765)")
    else:
        print("Host IPv4 addresses: (not detected)")
    print("Press Ctrl+C to stop.")
    await server.run()


if __name__ == "__main__":
    try:
        asyncio.run(_demo())
    except KeyboardInterrupt:
        pass
