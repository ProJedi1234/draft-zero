import SwiftUI

/// A model's spend as a share of the busiest one. The row's own text carries
/// the number, so the bar is decoration for assistive technology.
struct ShareBar: View {
    let fraction: Double

    var body: some View {
        ProgressView(value: min(max(fraction, 0), 1))
            .accessibilityHidden(true)
    }
}
