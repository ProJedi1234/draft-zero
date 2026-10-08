import SwiftUI

/// How much of the context window the prompt used.
struct ContextBudgetMeter: View {
    let used: Int
    let budget: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Gauge(value: Double(min(used, budget)), in: 0...Double(max(budget, 1))) {
                Text("Context")
            } currentValueLabel: {
                Text("≈\(Format.tokens(used)) of \(GenerationLimits.contextWindowLabel(budget))")
            }
            .gaugeStyle(.linearCapacity)
            .tint(used > budget ? .orange : .accentColor)
            if used > budget {
                Text("Memory, the narrator and the author's note alone exceed the window; nothing else could be trimmed.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
    }
}
