import SwiftUI

/// One segment of the mode picker.
struct ModeButton: View {
    let mode: ComposerMode
    let selected: Bool
    let select: () -> Void

    var body: some View {
        Button(action: select) {
            Label(mode.label, systemImage: mode.systemImage)
                .labelStyle(.iconOnly)
                .frame(width: 42, height: 38)
                .contentShape(.capsule)
                .background {
                    if selected {
                        Capsule().fill(.background)
                            .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
                    }
                }
                .foregroundStyle(selected ? .primary : .secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(mode.label)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .help(mode == .image || selected ? mode.label : "\(mode.label) (Tab)")
    }
}
