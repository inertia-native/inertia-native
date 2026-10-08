import Foundation
import HotwireNative
import UIKit

/// Native counterpart of the `button` bridge component. Draws a navigation-bar
/// button from the web side's `connect` message and relays taps back by replying
/// to that same message.
///
/// Register once with `Hotwire.registerBridgeComponents([ButtonComponent.self])`.
final class ButtonComponent: BridgeComponent {
    override nonisolated class var name: String { "button" }

    override func onReceive(message: Message) {
        guard let event = Event(rawValue: message.event) else {
            return
        }

        switch event {
        case .connect:
            handleConnectEvent(message: message)
        }
    }

    // MARK: Private

    private var viewController: UIViewController? {
        delegate?.destination as? UIViewController
    }

    private func handleConnectEvent(message: Message) {
        guard let data: MessageData = message.data() else { return }

        let action = UIAction { [unowned self] _ in
            // Reply to "connect" — the web side treats this as the tap signal.
            reply(to: Event.connect.rawValue)
        }
        let item = UIBarButtonItem(title: data.title, primaryAction: action)

        switch data.side {
        case "left":
            viewController?.navigationItem.leftBarButtonItem = item
        default:
            viewController?.navigationItem.rightBarButtonItem = item
        }
    }
}

// MARK: Events

private extension ButtonComponent {
    enum Event: String {
        case connect
    }
}

// MARK: Message data

private extension ButtonComponent {
    struct MessageData: Decodable {
        let title: String
        let side: String?
    }
}
