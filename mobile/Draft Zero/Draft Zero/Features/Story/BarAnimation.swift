import SwiftUI
import UIKit

/// Applies a change that shows or hides the system bars inside a UIKit
/// animation. SwiftUI swaps the bars and the safe area in a single frame,
/// even under `withAnimation`; laying out inside the block lets UIKit animate
/// the bars, the status bar and the safe area together.
func withBarAnimation(_ change: @escaping () -> Void) {
    let window = UIApplication.shared.connectedScenes
        .compactMap { ($0 as? UIWindowScene)?.keyWindow }
        .first
    UIView.animate(withDuration: UINavigationController.hideShowBarDuration) {
        withAnimation { change() }
        window?.layoutIfNeeded()
    }
}
