import SwiftUI
import UIKit

struct AnyKeyResetView: UIViewRepresentable {
    let enabled: Bool
    let onAnyKey: () -> Void

    func makeUIView(context: Context) -> AnyKeyCaptureUIView {
        let view = AnyKeyCaptureUIView()
        view.onAnyKey = onAnyKey
        view.isEnabled = enabled
        return view
    }

    func updateUIView(_ uiView: AnyKeyCaptureUIView, context: Context) {
        uiView.onAnyKey = onAnyKey
        uiView.isEnabled = enabled
    }
}

final class AnyKeyCaptureUIView: UIView {
    var onAnyKey: (() -> Void)?
    var isEnabled: Bool = false {
        didSet {
            if isEnabled {
                becomeFirstResponder()
            } else if isFirstResponder {
                resignFirstResponder()
            }
        }
    }

    override var canBecomeFirstResponder: Bool { true }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if isEnabled {
            becomeFirstResponder()
        }
    }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        guard isEnabled else {
            super.pressesBegan(presses, with: event)
            return
        }

        // Hardware keyboard input (external keyboard). `press.key` is non-nil.
        if presses.contains(where: { $0.key != nil }) {
            onAnyKey?()
        }

        super.pressesBegan(presses, with: event)
    }
}

