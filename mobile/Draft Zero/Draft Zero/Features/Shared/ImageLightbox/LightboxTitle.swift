import SwiftUI

/// "3 of 8" while paging pictures, "Take 2 of 3" while paging takes.
struct LightboxTitle: View {
    let position: (index: Int, count: Int)?
    let pagesTakes: Bool

    var body: some View {
        if let position, position.count > 1 {
            Text(pagesTakes ? "Take \(position.index + 1) of \(position.count)" : "\(position.index + 1) of \(position.count)")
                .font(.headline)
                .monospacedDigit()
        }
    }
}
