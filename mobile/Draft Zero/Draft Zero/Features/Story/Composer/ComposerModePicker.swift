import SwiftUI

/// Which move the next keystroke means. In image mode the writing moves
/// collapse into one chip that names the mode and offers the way back.
struct ComposerModePicker: View {
    let composer: ComposerModel

    var body: some View {
        if composer.mode == .image {
            Button(action: composer.leaveImageMode) {
                Label("Image", systemImage: "photo.badge.plus")
                    .labelStyle(.titleAndIcon)
                Image(systemName: "xmark")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .accessibilityLabel("Image — leave for \(composer.lastWritingMode.label)")
        } else {
            HStack(spacing: 0) {
                ForEach(ComposerMode.allCases) { mode in
                    ModeButton(mode: mode, selected: composer.mode == mode) {
                        composer.mode = mode
                    }
                }
            }
            .padding(2)
            .background(.fill.tertiary, in: .capsule)
        }
    }
}
