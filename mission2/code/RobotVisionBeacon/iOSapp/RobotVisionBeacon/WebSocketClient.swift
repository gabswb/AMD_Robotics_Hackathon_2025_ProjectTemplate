import Foundation
import Combine

final class WebSocketClient: NSObject, ObservableObject {
    @Published private(set) var isConnected: Bool = false

    private var task: URLSessionWebSocketTask?
    private var appState: AppState?

    func bind(appState: AppState) {
        self.appState = appState
    }

    func connect(urlString: String) {
        guard task == nil else { return }
        guard let url = URL(string: urlString) else { return }

        let config = URLSessionConfiguration.default
        let session = URLSession(configuration: config, delegate: self, delegateQueue: OperationQueue())
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
        receive()
        DispatchQueue.main.async {
            self.appState?.websocketStatus = "connecting"
        }
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        DispatchQueue.main.async {
            self.isConnected = false
            self.appState?.websocketStatus = "disconnected"
        }
    }

    func sendStateUpdate(state: ColorState, manual: Bool) {
        let payload: [String: Any] = [
            "type": "state_update",
            "source": "phone",
            "state": state.rawValue,
            "manual": manual
        ]
        send(json: payload)
    }

    func sendHeartbeat() {
        let payload: [String: Any] = [
            "type": "heartbeat",
            "source": "phone"
        ]
        send(json: payload)
    }

    func sendBarcodeResult(code: String, symbology: String, confidence: Double) {
        let payload: [String: Any] = [
            "type": "barcode_result",
            "source": "phone",
            "code": code,
            "symbology": symbology,
            "confidence": confidence
        ]
        send(json: payload)
    }

    private func send(json: [String: Any]) {
        guard let task = task else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: json, options: []) else {
            return
        }
        let text = String(data: data, encoding: .utf8) ?? ""
        task.send(.string(text)) { error in
            if let error = error {
                print("WebSocket send error: \(error)")
            }
        }
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let error):
                print("WebSocket receive error: \(error)")
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.appState?.websocketStatus = "error"
                }
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handle(text: text)
                case .data:
                    break
                @unknown default:
                    break
                }
                self.receive()
            }
        }
    }

    private func handle(text: String) {
        guard let data = text.data(using: .utf8) else { return }
        guard let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else {
            return
        }
        guard let type = json["type"] as? String else { return }

        switch type {
        case "hello":
            DispatchQueue.main.async {
                self.isConnected = true
                self.appState?.websocketStatus = "connected"
                if let stateStr = json["state"] as? String,
                   let state = ColorState(rawValue: stateStr) {
                    self.appState?.colorState = state
                }
            }
        case "state_update":
            if let stateStr = json["state"] as? String,
               let state = ColorState(rawValue: stateStr) {
                DispatchQueue.main.async {
                    self.appState?.colorState = state
                }
            }
        case "barcode_result":
            if let code = json["code"] as? String {
                DispatchQueue.main.async {
                    self.appState?.latestBarcode = code
                }
            }
        default:
            break
        }
    }
}

extension WebSocketClient: URLSessionWebSocketDelegate {
    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        DispatchQueue.main.async {
            self.isConnected = true
            self.appState?.websocketStatus = "connected"
        }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        DispatchQueue.main.async {
            self.isConnected = false
            self.appState?.websocketStatus = "disconnected"
        }
    }
}
