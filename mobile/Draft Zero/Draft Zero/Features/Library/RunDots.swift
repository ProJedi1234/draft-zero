import SwiftUI

/// Three squares hopping in turn: this story is generating right now. The same
/// beat as the web's run mark. With Reduce Motion the squares only brighten.
struct RunDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .footnote) private var dot = 3.5

    /// One hop every 1.2 seconds, the three dots 0.16 seconds apart.
    static let period = 1.2
    static let stagger = 0.16

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: dot * 0.6) {
                ForEach(0..<3, id: \.self) { index in
                    let lift = Self.lift(at: time - Double(index) * Self.stagger)
                    Rectangle()
                        .frame(width: dot, height: dot)
                        .opacity(0.3 + 0.7 * lift)
                        .offset(y: reduceMotion ? 0 : -dot * lift)
                }
            }
            .padding(.vertical, dot)
        }
        .foregroundStyle(.tint)
    }

    /// 0 at rest, 1 at the top of the hop: up and down over the first 70% of
    /// the period, eased, then still.
    static func lift(at time: Double) -> Double {
        let phase = (time.truncatingRemainder(dividingBy: period) + period)
            .truncatingRemainder(dividingBy: period) / period
        guard phase < 0.7 else { return 0 }
        let x = 1 - abs(phase - 0.35) / 0.35
        return x * x * (3 - 2 * x)
    }
}
