import SwiftUI

/// One atmosphere, drawn in its hue for the current appearance. The selected
/// swatch carries a checkmark as well as a ring, so colour is never the only
/// signal; a colour the story chose for itself is ringed more quietly.
struct InspectorTintSwatch: View {
    let label: String
    let tint: StoryTintValue
    let isSelected: Bool
    /// Selected by the picker rather than by hand.
    let isProvisional: Bool
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let isNone = tint.hue == nil

        Button(action: action) {
            ZStack {
                if isNone {
                    Circle()
                        .fill(.quaternary)
                } else {
                    Circle()
                        .fill(StoryPalette(tint: tint, scheme: colorScheme).swatch)
                }
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.footnote.bold())
                        .foregroundStyle(isNone ? AnyShapeStyle(.primary) : AnyShapeStyle(.white))
                } else if isNone {
                    Image(systemName: "line.diagonal")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(5)
            .overlay {
                if isSelected {
                    Circle()
                        .strokeBorder(isProvisional ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary), lineWidth: 2)
                }
            }
            .frame(width: 44, height: 44)
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityHint(isSelected && isProvisional ? "Chosen by the story. Double-tap to keep it." : "")
        .help(label)
    }
}
