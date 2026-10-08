import SwiftUI

/// Sizes itself to its first subview's natural height, up to `maxHeight`, and
/// gives every subview that frame. A flexible `frame(maxHeight:)` cannot do
/// this, because it grows to whatever height it is offered.
struct CappedHeightLayout: Layout {
    let maxHeight: Double

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let sizing = subviews.first else { return .zero }
        let natural = sizing.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
        return CGSize(width: natural.width, height: min(natural.height, maxHeight))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for subview in subviews {
            subview.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
        }
    }
}
