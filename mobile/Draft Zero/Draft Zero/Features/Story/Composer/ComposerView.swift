import SwiftUI

/// The composer, floating over the manuscript: where the writer types a move,
/// or briefs a picture, and every move is made.
struct ComposerView: View {
    let workspace: StoryWorkspace

    @FocusState private var focused: Bool

    var body: some View {
        @Bindable var composer = workspace.composer
        let deriving = workspace.derivation.deriving
        let isImage = composer.mode == .image

        VStack(alignment: .leading, spacing: 10) {
            if isImage && composer.imageAssisted {
                LoreChipsRow(
                    matches: composer.loreMatches(in: workspace.lorebook),
                    excluded: composer.excludedLoreIds,
                    disabled: deriving,
                    toggle: composer.toggleLore
                )
            }

            TextField(composer.placeholder, text: $composer.text, axis: .vertical)
                .font(Theme.proseFont)
                .lineLimit(1...6)
                .focused($focused)
                .disabled(isImage && deriving)
                .textInputAutocapitalization(.sentences)
                .submitLabel(.send)
                .onKeyPress(.return, phases: .down, action: handleReturn)
                .onKeyPress(.tab, phases: .down) { _ in
                    guard !isImage else { return .ignored }
                    composer.swapWritingMode()
                    return .handled
                }
                .accessibilityLabel(fieldLabel(for: composer))

            if isImage && composer.laneVisible {
                DevelopedPromptLane(composer: composer, deriving: deriving, send: workspace.sendFromComposer)
            }

            if isImage {
                ImageOptionsRow(composer: composer, disabled: deriving || workspace.illustration.isBusy)
            }

            ComposerActionBar(workspace: workspace)
        }
        .padding(12)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: Theme.readingWidth + 40)
        .frame(maxWidth: .infinity)
        .onChange(of: composer.focusRequest) { focused = true }
        .onChange(of: composer.laneReadyAnnouncement) {
            AccessibilityNotification.Announcement("Image prompt ready. Send to draw.").post()
        }
    }

    /// A hardware Return sends; Shift-Return is a newline. The on-screen
    /// keyboard's return always types a newline, and Send is the button.
    private func handleReturn(_ press: KeyPress) -> KeyPress.Result {
        if press.modifiers.contains(.shift) || press.modifiers.contains(.option) { return .ignored }
        if press.modifiers.contains(.command) && !workspace.composer.hasText && workspace.composer.mode != .image {
            workspace.generation.continueStory()
            return .handled
        }
        workspace.sendFromComposer()
        return .handled
    }

    private func fieldLabel(for composer: ComposerModel) -> String {
        switch composer.mode {
        case .image: composer.imageAssisted ? "Image — say what the picture is" : "Image — describe the picture"
        case .do, .say: "\(composer.mode.label) — write your next move"
        }
    }
}
