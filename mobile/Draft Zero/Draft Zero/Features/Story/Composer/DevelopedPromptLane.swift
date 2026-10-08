import SwiftUI

/// The developed prompt under the brief. Monospaced because it is machine
/// text addressed to a machine: the writer can edit it, but it is not prose.
struct DevelopedPromptLane: View {
    @Bindable var composer: ComposerModel
    let deriving: Bool
    let send: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(status)
                .font(.caption)
                .textCase(.uppercase)
                .foregroundStyle(composer.laneStale ? .orange : .secondary)
                .accessibilityAddTraits(.updatesFrequently)
            TextField("Developed prompt", text: $composer.imagePromptText, axis: .vertical)
                .font(Theme.machineFont)
                .foregroundStyle(.secondary)
                .lineLimit(1...6)
                .disabled(deriving)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onKeyPress(.return, phases: .down) { press in
                    if press.modifiers.contains(.shift) { return .ignored }
                    send()
                    return .handled
                }
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
