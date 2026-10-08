import SwiftUI

/// A borderless icon button with a full 44pt tap target, dimmed when disabled.
struct ComposerIconButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(isEnabled ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
            .frame(minWidth: 38, minHeight: 44)
            .contentShape(.rect)
            .opacity(configuration.isPressed ? 0.5 : 1)
    }
}
