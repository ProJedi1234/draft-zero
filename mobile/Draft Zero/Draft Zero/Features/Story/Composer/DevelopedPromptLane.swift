import SwiftUI

/// The developed prompt under the brief. Monospaced because it is machine
/// text addressed to a machine: the writer can edit it, but it is not prose.
struct DevelopedPromptLane: View {
    @Bindable var composer: ComposerModel
    let deriving: Bool
    let returnSends: Bool
    let lineBreakRequest: Int
    let onFocus: () -> Void
    let send: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(status)
                .font(.caption)
                .textCase(.uppercase)
                .foregroundStyle(composer.laneStale ? .orange : .secondary)
                .accessibilityAddTraits(.updatesFrequently)
            ComposerTextInput(
                text: $composer.imagePromptText,
                placeholder: "Developed prompt",
                accessibilityLabel: "Developed prompt",
                machineText: true,
                disabled: deriving,
                returnSends: returnSends,
                lineBreakRequest: lineBreakRequest,
                onFocus: onFocus,
                send: send
            )
        }
        .padding(.top, 8)
        .overlay(alignment: .top) { Divider() }
    }

    private var status: String {
        if deriving { return "Developing…" }
        if composer.laneStale { return "Brief changed — Send develops again" }
        return "Developed prompt — Send draws"
    }
}
