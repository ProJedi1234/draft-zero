import SwiftUI

/// A picture's moves: redraw it (with this story's model or another), hand
/// its prompt back to the composer, view it, copy it, remove it.
struct ImageMenu: View {
    let image: StoryImage
    let workspace: StoryWorkspace
    let busy: Bool
    let openViewer: () -> Void

    var body: some View {
        Button("View", systemImage: "arrow.up.left.and.arrow.down.right", action: openViewer)
        Button("Redraw", systemImage: "arrow.clockwise") {
            workspace.retryImage(image)
        }
        .disabled(workspace.illustration.isBusy)
        Menu("Redraw With…", systemImage: "paintbrush") {
            ForEach(workspace.imageModels) { model in
                Button {
                    workspace.retryImage(image, modelId: model.id)
                } label: {
                    if model.id == workspace.effectiveImageModelId {
                        Label(model.name, systemImage: "checkmark")
                    } else {
                        Text(model.name)
                    }
                }
                .disabled(workspace.story?.settings.zdr == true && !model.zdr)
            }
        }
        .disabled(workspace.illustration.isBusy || workspace.imageModels.isEmpty)
        Button("Edit Prompt", systemImage: "square.and.pencil") {
            workspace.editImagePrompt(image)
        }
        Button("Copy Prompt", systemImage: "doc.on.doc") {
            UIPasteboard.general.string = image.prompt
        }
        Divider()
        Button("Remove Picture", systemImage: "trash", role: .destructive) {
            Task { await workspace.deleteImage(image) }
        }
        .disabled(busy)
    }
}
