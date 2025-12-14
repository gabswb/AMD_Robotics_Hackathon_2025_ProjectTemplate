import AVFoundation
import Foundation
import Vision
import Combine

final class BarcodeScannerController: NSObject, ObservableObject {
    let session = AVCaptureSession()

    /// Normalized region of interest in image coordinates (0-1).
    /// Use a large region in the top half for robust detection.
    let roi = CGRect(x: 0.05, y: 0.0, width: 0.9, height: 0.5)

    /// Maximum detection rate (Hz).
    private let maxDetectionsPerSecond: Double = 10.0
    private var lastDetectionTime: CFTimeInterval = 0

    /// Callback when a barcode is detected.
    var onBarcodeDetected: ((String, String, Float) -> Void)?

    private let videoQueue = DispatchQueue(label: "BarcodeScannerVideoQueue")

    override init() {
        super.init()
        configureSession()
    }

    func start() {
        guard !session.isRunning else { return }
        session.startRunning()
    }

    func stop() {
        guard session.isRunning else { return }
        session.stopRunning()
    }

    private func configureSession() {
        session.beginConfiguration()
        session.sessionPreset = .high

        guard let device = AVCaptureDevice.default(
            .builtInWideAngleCamera,
            for: .video,
            position: .front
        ) else {
            session.commitConfiguration()
            return
        }

        do {
            let input = try AVCaptureDeviceInput(device: device)
            if session.canAddInput(input) {
                session.addInput(input)
            }
        } catch {
            session.commitConfiguration()
            return
        }

        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: videoQueue)

        if session.canAddOutput(output) {
            session.addOutput(output)
        }

        if let connection = output.connection(with: .video) {
            if #available(iOS 17.0, *) {
                if connection.isVideoRotationAngleSupported(90) {
                    connection.videoRotationAngle = 90
                }
            } else if connection.isVideoOrientationSupported {
                connection.videoOrientation = .portrait
            }
        }

        session.commitConfiguration()
    }

    private func shouldRunDetection(now: CFTimeInterval) -> Bool {
        let minInterval = 1.0 / maxDetectionsPerSecond
        if now - lastDetectionTime < minInterval {
            return false
        }
        lastDetectionTime = now
        return true
    }

    private func handleSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }

        let request = VNDetectBarcodesRequest { [weak self] request, error in
            guard error == nil else {
                return
            }
            guard let self = self else { return }

            let observations = request.results as? [VNBarcodeObservation] ?? []
            guard let best = observations.max(by: { $0.confidence < $1.confidence }) else {
                return
            }
            guard let payload = best.payloadStringValue else {
                return
            }

            let symbology = best.symbology.rawValue
            let confidence = best.confidence

            DispatchQueue.main.async {
                self.onBarcodeDetected?(payload, symbology, confidence)
            }
        }

        // Support common 1D/2D codes; can be customized.
        request.symbologies = [
            .ean13,
            .ean8,
            .code128,
            .qr
        ]
        // For robustness, start with full-frame detection.
        // You can later switch back to `roi` if performance is an issue.
        request.regionOfInterest = CGRect(x: 0.0, y: 0.0, width: 1.0, height: 1.0)

        // Portrait orientation for front camera without mirroring.
        let handler = VNImageRequestHandler(
            cvPixelBuffer: pixelBuffer,
            orientation: .right,
            options: [:]
        )

        do {
            try handler.perform([request])
        } catch {
            // Ignore individual frame errors.
        }
    }
}

extension BarcodeScannerController: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        let now = CACurrentMediaTime()
        guard shouldRunDetection(now: now) else {
            return
        }
        handleSampleBuffer(sampleBuffer)
    }
}
