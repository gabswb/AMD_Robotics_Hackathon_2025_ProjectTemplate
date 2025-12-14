"""
Interactive demo for RobotVisionBeacon two-color mode.

- Starts the WebSocket server.
- Lets you press keys in the terminal to drive the phone's color:
  - 'g': turn GREEN
  - 'r': turn RED
  - 'b': turn BLUE
  - (optional) any other key: turn RED
  - 'q': quit
"""

import asyncio
import argparse
import sys
import termios
import tty

from robot_vision_beacon_server import (
    ColorState,
    RobotVisionBeaconServer,
    _get_host_ipv4_addresses,
)


async def input_loop(server: RobotVisionBeaconServer, any_key_red: bool) -> None:
    loop = asyncio.get_running_loop()
    print("Interactive controls (single key, no Enter):")
    if any_key_red:
        print("  any key can be RED (controlled by webapp interactive_mode)")
    print("  q = quit")
    print("Press keys in this terminal...")

    fd = sys.stdin.fileno()
    old_settings = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        while True:
            ch = await loop.run_in_executor(None, sys.stdin.read, 1)
            if not ch:
                break
            cmd = ch.lower()

            if cmd in ("q", "\x03"):  # q or Ctrl+C
                print("Exiting interactive demo...")
                break

            if any_key_red:
                # Webapp controls whether "any key" should trigger RED.
                if server.get_interactive_mode() == "any_key_red":
                    print("-> RED")
                    await server.send_state(ColorState.RED)
                continue

            if cmd == "g":
                print("-> GREEN")
                await server.send_state(ColorState.GREEN)
            elif cmd == "r":
                print("-> RED")
                await server.send_state(ColorState.RED)
            elif cmd == "b":
                print("-> BLUE")
                await server.send_state(ColorState.BLUE)
            else:
                # Ignore other keys quietly.
                continue
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--any-key-red",
        action="store_true",
        help="Send RED when any other key is pressed (besides g/r/b/q).",
    )
    args = parser.parse_args()

    server = RobotVisionBeaconServer()

    async def on_state(state: ColorState, meta):
        print(
            f"[state] {state.value} from {meta.get('source')} "
            f"manual={meta.get('manual')}"
        )

    async def on_barcode(result):
        print(
            f"[barcode] {result.code} ({result.symbology}) "
            f"conf={result.confidence:.2f} source={result.source}"
        )

    server.set_state_callback(on_state)
    server.set_barcode_callback(on_barcode)

    # Start WebSocket server in the background.
    server_task = asyncio.create_task(server.run())

    print("RobotVisionBeaconServer listening on ws://0.0.0.0:8765")
    ipv4_addrs = _get_host_ipv4_addresses()
    if ipv4_addrs:
        print("Host IPv4 addresses (use one in the iOS app):")
        for addr in ipv4_addrs:
            print(f"  - {addr}  (ws://{addr}:8765)")
    if args.any_key_red:
        print("Press any key to send RED; press q to quit.")
    else:
        print("Press g / r / b / q in this terminal.")

    try:
        await input_loop(server, any_key_red=args.any_key_red)
    finally:
        server_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await server_task


if __name__ == "__main__":
    import contextlib

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
