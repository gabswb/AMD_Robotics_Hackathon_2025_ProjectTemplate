import SwiftUI
import Combine
import UIKit

enum ColorState: String {
    case green = "GREEN"
    case red = "RED"
    case blue = "BLUE"

    var displayColor: Color {
        switch self {
        case .green:
            return .green
        case .red:
            return .red
        case .blue:
            return .blue
        }
    }
}

final class AppState: ObservableObject {
    @Published var colorState: ColorState = .red
    @Published var latestBarcode: String = ""
    @Published var websocketStatus: String = "disconnected"
}

struct ContentView: View {
    @StateObject private var appState = AppState()
    @StateObject private var wsClient = WebSocketClient()
    @StateObject private var scanner = BarcodeScannerController()

    /// Host IP, configurable from the UI and persisted across launches.
    @AppStorage("hostAddress") private var hostAddress: String = "192.168.50.47"
    /// Auto-reset: when enabled, automatically return to RED after GREEN.
    @AppStorage("timeoutEnabled") private var timeoutEnabled: Bool = false
    /// Legacy single timing value (used for migration only).
    @AppStorage("timeoutSeconds") private var legacyTimeoutSeconds: Double = 3.0
    /// Max random delay (seconds) before turning GREEN after barcode detection.
    @AppStorage("greenDelayMaxSeconds") private var greenDelayMaxSeconds: Double = 1.0
    /// Fixed duration (seconds) to stay GREEN before returning to RED.
    @AppStorage("greenTimeoutSeconds") private var greenTimeoutSeconds: Double = 3.0
    @AppStorage("timingMigratedV2") private var timingMigratedV2: Bool = false
    /// When enabled, after a successful scan the app may show BLUE instead of GREEN.
    @AppStorage("blueChanceEnabled") private var blueChanceEnabled: Bool = false
    /// Probability [0,1] of showing BLUE after a successful scan.
    @AppStorage("blueChance") private var blueChance: Double = 0.0
    /// How to decide BLUE/GREEN after a scan:
    /// - "random": phone decides (optionally with BLUE chance).
    /// - "host": host decides based on barcode (send state_update BLUE/GREEN).
    @AppStorage("scannedDecisionMode") private var scannedDecisionMode: String = "random"
    /// When enabled, pressing any hardware keyboard key resets to RED.
    @AppStorage("anyKeyResetEnabled") private var anyKeyResetEnabled: Bool = false

    @State private var showingSettings: Bool = false
    @State private var robotMode: Bool = false
    @State private var timeoutWorkItem: DispatchWorkItem?
    @State private var pendingGreenWorkItem: DispatchWorkItem?

    var body: some View {
        GeometryReader { geometry in
            let halfHeight = geometry.size.height * 0.5

            VStack(spacing: 0) {
                // Top: camera preview.
                ZStack {
                    CameraView(session: scanner.session)
                        .ignoresSafeArea()
                }
                .frame(height: halfHeight)
                .frame(maxWidth: .infinity)

                // Bottom: signal color area (RED/GREEN).
                ZStack {
                    appState.colorState.displayColor
                        .ignoresSafeArea(edges: .bottom)

                    VStack(spacing: 8) {
                        if !robotMode {
                            Text("Signal: \(appState.colorState.rawValue)")
                                .font(.title2)
                                .bold()
                                .foregroundColor(.white)

                            Text("WebSocket: \(appState.websocketStatus)")
                                .font(.subheadline)
                                .foregroundColor(.white.opacity(0.8))

                            if !appState.latestBarcode.isEmpty {
                                Text("Barcode: \(appState.latestBarcode)")
                                    .font(.headline)
                                    .padding(8)
                                    .background(Color.white.opacity(0.8))
                                    .cornerRadius(8)
                                    .foregroundColor(.black)
                                    .padding(.top, 8)
                            }

                            Button {
                                showingSettings = true
                            } label: {
                                Text("Connection: \(hostAddress)")
                                    .font(.footnote)
                                    .padding(6)
                                    .background(Color.white.opacity(0.2))
                                    .cornerRadius(6)
                            }
                            .padding(.top, 4)
                        }

                        Spacer()

                        // Thin transparent bar at the very bottom, toggles robot mode.
                        Capsule()
                            .fill(Color.white.opacity(0.25))
                            .frame(width: 120, height: 6)
                            .padding(.bottom, 10)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                robotMode.toggle()
                            }
                    }
                    .padding(.horizontal, 16)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
                .onTapGesture {
                    handleSignalAreaTap()
                }
            }
        }
        .overlay {
            // Avoid intercepting typing inside the settings sheet.
            AnyKeyResetView(enabled: anyKeyResetEnabled && !showingSettings) {
                setSignalState(.red, manual: true)
            }
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
        }
        .ignoresSafeArea()
        .onAppear {
            #if os(iOS)
            UIApplication.shared.isIdleTimerDisabled = true
            #endif
            wsClient.bind(appState: appState)
            connectToHost()

            // Default state: RED.
            appState.colorState = .red

            if !timingMigratedV2 {
                // Migrate old single timing value into the new split settings.
                greenDelayMaxSeconds = legacyTimeoutSeconds
                greenTimeoutSeconds = legacyTimeoutSeconds
                timingMigratedV2 = true
            }

            scanner.onBarcodeDetected = { code, symbology, confidence in
                // Only react when we are in RED and not already waiting to turn GREEN.
                guard appState.colorState == .red else { return }
                guard pendingGreenWorkItem == nil else { return }

                appState.latestBarcode = code
                wsClient.sendBarcodeResult(
                    code: code,
                    symbology: symbology,
                    confidence: Double(confidence)
                )

                scheduleDelayedScanned()
            }
            scanner.start()
        }
        .onDisappear {
            scanner.stop()
            wsClient.disconnect()
            pendingGreenWorkItem?.cancel()
            pendingGreenWorkItem = nil
            timeoutWorkItem?.cancel()
            timeoutWorkItem = nil
            #if os(iOS)
            UIApplication.shared.isIdleTimerDisabled = false
            #endif
        }
        .onChange(of: appState.colorState) { newState in
            // If host drives the state, ensure local timers stay consistent.
            if newState == .red {
                pendingGreenWorkItem?.cancel()
                pendingGreenWorkItem = nil
                timeoutWorkItem?.cancel()
                timeoutWorkItem = nil
            } else if newState == .green || newState == .blue {
                pendingGreenWorkItem?.cancel()
                pendingGreenWorkItem = nil
            }
        }
        .sheet(isPresented: $showingSettings) {
            NavigationStack {
                Form {
                    Section("Host") {
                        TextField("Host IP (e.g. 192.168.50.47)", text: $hostAddress)
                            .keyboardType(.numbersAndPunctuation)
                    }

                    Section("Timing") {
                        HStack {
                            Text("RED → SCANNED max delay (s)")
                            Spacer()
                            TextField("1.0", value: $greenDelayMaxSeconds, format: .number)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 90)
                        }

                        HStack {
                            Text("SCANNED → RED (s)")
                            Spacer()
                            TextField("3.0", value: $greenTimeoutSeconds, format: .number)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 90)
                        }

                        Toggle("Auto reset SCANNED → RED", isOn: $timeoutEnabled)
                    }

                    Section("Mode") {
                        Picker("SCANNED color source", selection: $scannedDecisionMode) {
                            Text("Random on phone").tag("random")
                            Text("Host by barcode").tag("host")
                        }

                        if scannedDecisionMode == "random" {
                            Toggle("Enable BLUE chance", isOn: $blueChanceEnabled)

                            HStack {
                                Text("BLUE probability")
                                Spacer()
                                Text(String(format: "%.2f", min(max(blueChance, 0.0), 1.0)))
                                    .foregroundColor(.secondary)
                            }

                            Slider(
                                value: $blueChance,
                                in: 0.0...1.0,
                                step: 0.01
                            )
                            .disabled(!blueChanceEnabled)
                        } else {
                            Text("Host should respond to barcode_result with state_update BLUE/GREEN. The phone will wait up to “RED → SCANNED max delay (s)” before falling back to GREEN.")
                                .font(.footnote)
                                .foregroundColor(.secondary)
                        }
                    }

                    Section("Features") {
                        Toggle("Any key resets to RED", isOn: $anyKeyResetEnabled)
                    }
                }
                .navigationTitle("Connection")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            showingSettings = false
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Connect") {
                            reconnect()
                            showingSettings = false
                        }
                    }
                }
            }
        }
    }

    private func connectToHost() {
        let urlString = "ws://\(hostAddress):8765"
        wsClient.connect(urlString: urlString)
    }

    private func reconnect() {
        wsClient.disconnect()
        connectToHost()
    }

    private func setSignalState(_ state: ColorState, manual: Bool) {
        if state == .red {
            pendingGreenWorkItem?.cancel()
            pendingGreenWorkItem = nil
            timeoutWorkItem?.cancel()
            timeoutWorkItem = nil
        }
        if state == .green || state == .blue {
            pendingGreenWorkItem?.cancel()
            pendingGreenWorkItem = nil
        }
        appState.colorState = state
        wsClient.sendStateUpdate(state: state, manual: manual)
    }

    private func handleSignalAreaTap() {
        // If we're already in a success state, tap returns to red.
        if appState.colorState == .green || appState.colorState == .blue {
            setSignalState(.red, manual: true)
            return
        }

        // If we're waiting to turn green, tap cancels the pending transition.
        if pendingGreenWorkItem != nil {
            setSignalState(.red, manual: true)
        }
    }

    private func scheduleTimeout() {
        timeoutWorkItem?.cancel()
        let workItem = DispatchWorkItem {
            guard appState.colorState != .red else { return }
            setSignalState(.red, manual: false)
        }
        timeoutWorkItem = workItem
        DispatchQueue.main.asyncAfter(
            deadline: .now() + max(greenTimeoutSeconds, 0.1),
            execute: workItem
        )
    }

    private func scheduleDelayedScanned() {
        pendingGreenWorkItem?.cancel()

        let maxDelay = max(greenDelayMaxSeconds, 0.0)
        let delay: Double
        if scannedDecisionMode == "host" {
            // Wait for host decision; if none arrives in time, fall back to GREEN.
            delay = maxDelay
        } else {
            delay = maxDelay > 0 ? Double.random(in: 0.0...maxDelay) : 0.0
        }

        let workItem = DispatchWorkItem {
            // Only transition if we are still in RED.
            guard appState.colorState == .red else { return }

            if scannedDecisionMode == "host" {
                setSignalState(.green, manual: false)
            } else {
                let useBlue: Bool
                if blueChanceEnabled {
                    let p = min(max(blueChance, 0.0), 1.0)
                    useBlue = Double.random(in: 0.0...1.0) < p
                } else {
                    useBlue = false
                }
                setSignalState(useBlue ? .blue : .green, manual: false)
            }

            // Optionally auto-return to RED after GREEN.
            if timeoutEnabled, greenTimeoutSeconds > 0 {
                scheduleTimeout()
            }
        }

        pendingGreenWorkItem = workItem
        DispatchQueue.main.asyncAfter(
            deadline: .now() + delay,
            execute: workItem
        )
    }
}
