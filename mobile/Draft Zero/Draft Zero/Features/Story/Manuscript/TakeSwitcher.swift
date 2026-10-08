import SwiftUI

/// "‹ 2 / 3 ›" — steps between the takes of a passage or a picture.
struct TakeSwitcher: View {
    let index: Int
    let count: Int
    let disabled: Bool
    let step: (Int) -> Void

    var body: some View {
        HStack(spacing: 2) {
            Button("Previous Take", systemImage: "chevron.left") { step(-1) }
                .disabled(disabled || index == 0)
            Text("\(index + 1) / \(count)")
                .monospacedDigit()
                .foregroundStyle(.secondary)
            Button("Next Take", systemImage: "chevron.right") { step(1) }
                .disabled(disabled || index >= count - 1)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Take \(index + 1) of \(count)")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: if index < count - 1 { step(1) }
            case .decrement: if index > 0 { step(-1) }
            @unknown default: break
            }
        }
    }
}
