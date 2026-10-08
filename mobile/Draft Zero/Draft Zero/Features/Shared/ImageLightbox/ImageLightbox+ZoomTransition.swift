import SwiftUI

extension View {
    /// Zooms from the tile marked with `sourceID`, when a namespace was given.
    @ViewBuilder
    func zoomTransition(from namespace: Namespace.ID?, sourceID: String?) -> some View {
        if let namespace, let sourceID {
            navigationTransition(.zoom(sourceID: sourceID, in: namespace))
        } else {
            self
        }
    }
}
