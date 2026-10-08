import SwiftUI

/// The composer's moves: which move is armed, history, Retry and Continue
/// (or re-develop for a picture), and the one send slot.
struct ComposerActionBar: View {
    let workspace: StoryWorkspace
    let insertLineBreak: () -> Void
    @AppStorage("composerReturnSends") private var returnSends = true

    var body: some View {
        let generation = workspace.generation
        let composer = workspace.composer
        let isImage = composer.mode == .image

        HStack(spacing: 2) {
            ComposerModePicker(composer: composer)

            Menu("Composer keyboard options", systemImage: "keyboard") {
                Button("Insert line break", systemImage: "return", action: insertLineBreak)
                    .disabled(isImage && workspace.derivation.deriving)
                Picker("Mobile Return key", selection: $returnSends) {
                    Text("Send").tag(true)
                    Text("Insert new line").tag(false)
                }
                Text("Saved on this device")
            }

            Spacer(minLength: 4)

            Button(generation.undoLabel, systemImage: "arrow.uturn.backward", action: generation.undo)
                .disabled(!generation.canUndo)
            Button(generation.redoLabel, systemImage: "arrow.uturn.forward", action: generation.redo)
                .disabled(!generation.canRedo)

            if isImage {
                Button(composer.hasText ? "Develop Again" : "Write a Prompt From the Story", systemImage: "wand.and.sparkles") {
                    workspace.developFromComposer()
                }
                .disabled(!composer.imageAssisted || workspace.derivation.deriving || workspace.illustration.isBusy)
                .help("Costs a call")
            } else {
                RetryMenu(workspace: workspace, disabled: generation.busy)
                Button("Continue", systemImage: "forward.fill", action: generation.continueStory)
                    .disabled(generation.busy)
                    .keyboardShortcut(.return, modifiers: [.command, .shift])
            }

            ComposerSendButton(workspace: workspace)
                .padding(.leading, 4)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(ComposerIconButtonStyle())
    }
}
