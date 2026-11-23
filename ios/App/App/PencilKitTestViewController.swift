import PencilKit
import UIKit

final class PencilKitTestViewController: UIViewController, PKCanvasViewDelegate {
    private let canvas = PKCanvasView()
    private let toolPicker = PKToolPicker()
    private let drawingURL: URL
    private var saveTimer: Timer?
    private var hasUnsavedChanges = false

    init(fileManager: FileManager = .default) throws {
        let support = try fileManager.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true
        )
        drawingURL = support.appendingPathComponent("PencilKitTest", isDirectory: true)
            .appendingPathComponent("drawing.pkdrawing")
        super.init(nibName: nil, bundle: nil)

        do {
            canvas.drawing = try PKDrawing(data: Data(contentsOf: drawingURL))
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            // The first visit starts with an empty canvas.
        }
    }

    required init?(coder: NSCoder) {
        fatalError("Use init()")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "PencilKit Test"
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done, target: self, action: #selector(close)
        )
        view.backgroundColor = .systemBackground
        canvas.backgroundColor = .systemBackground
        canvas.drawingPolicy = .pencilOnly
        canvas.contentSize = CGSize(width: 2400, height: 2400)
        canvas.minimumZoomScale = 0.5
        canvas.maximumZoomScale = 4
        canvas.delegate = self
        canvas.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(canvas)
        let safeArea = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            canvas.topAnchor.constraint(equalTo: safeArea.topAnchor),
            canvas.bottomAnchor.constraint(equalTo: safeArea.bottomAnchor),
            canvas.leadingAnchor.constraint(equalTo: safeArea.leadingAnchor),
            canvas.trailingAnchor.constraint(equalTo: safeArea.trailingAnchor)
        ])

        toolPicker.showsDrawingPolicyControls = false
        toolPicker.addObserver(canvas)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        toolPicker.setVisible(true, forFirstResponder: canvas)
        canvas.becomeFirstResponder()
        NotificationCenter.default.addObserver(
            self, selector: #selector(sceneDidEnterBackground(_:)),
            name: UIScene.didEnterBackgroundNotification, object: view.window?.windowScene
        )
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        toolPicker.setVisible(false, forFirstResponder: canvas)
        canvas.resignFirstResponder()
        NotificationCenter.default.removeObserver(self, name: UIScene.didEnterBackgroundNotification, object: nil)
    }

    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        hasUnsavedChanges = true
        saveTimer?.invalidate()
        saveTimer = Timer.scheduledTimer(
            timeInterval: 0.35, target: self, selector: #selector(saveAfterDelay(_:)),
            userInfo: nil, repeats: false
        )
    }

    @objc private func saveAfterDelay(_ timer: Timer) {
        autosave()
    }

    @objc private func sceneDidEnterBackground(_ notification: Notification) {
        autosave()
    }

    private func autosave() {
        do {
            try saveDrawing()
        } catch {
            navigationItem.prompt = "测试笔迹保存失败，将在完成时重试。"
        }
    }

    private func saveDrawing() throws {
        saveTimer?.invalidate()
        saveTimer = nil
        guard hasUnsavedChanges else { return }
        try FileManager.default.createDirectory(at: drawingURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try canvas.drawing.dataRepresentation().write(to: drawingURL, options: .atomic)
        hasUnsavedChanges = false
        navigationItem.prompt = nil
    }

    @objc private func close() {
        do {
            try saveDrawing()
            dismiss(animated: true)
        } catch {
            let alert = UIAlertController(title: "无法保存测试笔迹", message: error.localizedDescription, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "继续编辑", style: .cancel))
            alert.addAction(UIAlertAction(title: "返回，舍弃未保存更改", style: .destructive) { [weak self] _ in
                self?.dismiss(animated: true)
            })
            present(alert, animated: true)
        }
    }
}
