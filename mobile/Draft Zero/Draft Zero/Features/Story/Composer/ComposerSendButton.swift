import SwiftUI

/// One slot, several states — Send, a spinner, Stop, Develop, Draw — all the
/// same size, so the sequence never shifts the row.
struct ComposerSendButton: View {
    let workspace: StoryWorkspace

    var body: some View {
        let generation = workspace.generation
        let composer = workspace.composer

        Group {
            if composer.mode == .image {
                if workspace.derivation.deriving {
                    Spinner(label: "Developing")
                } else if composer.imageSendAction == .draw {
                    Button("Draw This Picture", systemImage: "arrow.up", action: workspace.sendFromComposer)
                        .disabled(workspace.illustration.isBusy || (composer.imageAssisted ? composer.lane.isEmpty : !composer.hasText))
                } else {
                    Button("Develop the Prompt", systemImage: "sparkles", action: workspace.sendFromComposer)
                        .disabled(workspace.illustration.isBusy || !composer.hasText)
                }
            } else if generation.isStoppable {
                Button("Stop", systemImage: "stop.fill", action: generation.stop)
                    .keyboardShortcut(.cancelAction)
            } else if generation.status == .settling || generation.isMovingHistory || generation.isStarting {
                Spinner(label: "Working")
            } else {
                Button("Send", systemImage: "arrow.up", action: workspace.sendFromComposer)
                    .disabled(!composer.hasText || generation.busy)
            }
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.circle)
        .controlSize(.regular)
        .frame(width: 44, height: 44)
    }
}
