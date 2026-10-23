import SwiftUI

/// The composer's moves: which move is armed, Continue (or re-develop for a
/// picture), and the one send slot. History and Retry join them unless the
/// toolbar is a side rail with room for them.
struct ComposerActionBar: View {
    let workspace: StoryWorkspace
    let showsHistory: Bool

    var body: some View {
        // A foldable's front display is too narrow for the regular row; HStack
        // won't shrink flexible buttons reliably, so pick a narrower fixed row.
        ViewThatFits(in: .horizontal) {
            row(compact: false)
            row(compact: true)
        }
    }

    @ViewBuilder
    private func row(compact: Bool) -> some View {
        let generation = workspace.generation
        let composer = workspace.composer
        let isImage = composer.mode == .image

        HStack(spacing: 2) {
            ComposerModePicker(composer: composer, segmentWidth: compact ? 34 : 42)

            Spacer(minLength: 4)

            if showsHistory {
                Button(generation.undoLabel, systemImage: "arrow.uturn.backward", action: generation.undo)
                    .disabled(!generation.canUndo)
                Button(generation.redoLabel, systemImage: "arrow.uturn.forward", action: generation.redo)
                    .disabled(!generation.canRedo)
            }

            if isImage {
                Button(composer.hasText ? "Develop Again" : "Write a Prompt From the Story", systemImage: "wand.and.sparkles") {
                    workspace.developFromComposer()
                }
                .disabled(!composer.imageAssisted || workspace.derivation.deriving || workspace.illustration.isBusy)
                .help("Costs a call")
            } else {
                if showsHistory {
                    RetryMenu(workspace: workspace, disabled: generation.busy)
                }
                Button("Continue", systemImage: "forward.fill", action: generation.continueStory)
                    .disabled(generation.busy)
                    .keyboardShortcut(.return, modifiers: [.command, .shift])
            }

            ComposerSendButton(workspace: workspace)
                .padding(.leading, 4)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(ComposerIconButtonStyle(width: compact ? 30 : 38))
    }
}
