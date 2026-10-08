import SwiftUI

/// One lorebook entry riding with a brief; struck through when muted.
struct LoreChip: View {
    let name: String
    let muted: Bool
    let disabled: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            Text(name)
                .font(.caption)
                .strikethrough(muted)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .foregroundStyle(muted ? .tertiary : .secondary)
                .overlay {
                    Capsule()
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: muted ? [3, 3] : []))
                        .foregroundStyle(.separator)
                }
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel("\(name) — \(muted ? "left out of" : "included in") this prompt")
        .accessibilityHint(muted ? "Puts it back" : "Leaves it out")
    }
}
