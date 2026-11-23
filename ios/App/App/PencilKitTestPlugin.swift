import Capacitor
import UIKit

final class CardinalBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PencilKitTestPlugin())
    }
}

@objc(PencilKitTestPlugin)
final class PencilKitTestPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PencilKitTestPlugin"
    let jsName = "PencilKitTest"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)]

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController,
                  presenter.viewIfLoaded?.window != nil,
                  presenter.presentedViewController == nil else {
                call.reject("当前无法打开 PencilKit 测试页。")
                return
            }

            do {
                let canvas = try PencilKitTestViewController()
                let screen = UINavigationController(rootViewController: canvas)
                screen.modalPresentationStyle = .fullScreen
                presenter.present(screen, animated: true) { call.resolve() }
            } catch {
                call.reject("无法读取测试笔迹：\(error.localizedDescription)")
            }
        }
    }
}
