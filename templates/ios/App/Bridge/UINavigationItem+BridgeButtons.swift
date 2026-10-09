import UIKit

/// Lets several bridge components share the navigation bar. Each one adds or
/// replaces only its own item, so they sit side by side (as on Android) and
/// Hotwire's Done button on modals and the back button stay.
extension UINavigationItem {
    enum BridgeButtonSide {
        case left
        case right
    }

    /// Shows `item` on `side`. `previous` is the component's last item: it is
    /// replaced in place when it's still on that side, otherwise removed. A new
    /// item goes outermost (rightmost on the right, next to the back button on
    /// the left).
    func showBridgeButton(_ item: UIBarButtonItem, on side: BridgeButtonSide, replacing previous: UIBarButtonItem?) {
        var items = bridgeButtons(on: side)
        if let previous, let index = items.firstIndex(where: { $0 === previous }) {
            items[index] = item
        } else {
            if let previous {
                leftBarButtonItems = leftBarButtonItems?.filter { $0 !== previous }
                rightBarButtonItems = rightBarButtonItems?.filter { $0 !== previous }
            }
            items = [item] + bridgeButtons(on: side)
        }

        switch side {
        case .left:
            // Without this, a left item replaces the back button.
            leftItemsSupplementBackButton = true
            leftBarButtonItems = items
        case .right:
            rightBarButtonItems = items
        }
    }

    private func bridgeButtons(on side: BridgeButtonSide) -> [UIBarButtonItem] {
        switch side {
        case .left: leftBarButtonItems ?? []
        case .right: rightBarButtonItems ?? []
        }
    }
}
