import SwiftUI

/// The story's pictures full screen, starting on one: swipe between them,
/// zoom, and choose between a picture's takes.
struct StoryImageViewer: View {
    let image: StoryImage
    let workspace: StoryWorkspace

    var body: some View {
        let title = workspace.story?.title
        let slots = (workspace.story?.images ?? [image]).map {
            LightboxSlot($0, storyId: workspace.storyId, storyTitle: title)
        }
        ImageLightbox(
            slots: slots,
            startingAt: image.imageGroupId,
            imageURL: workspace.api.imageURL,
            onUseTake: useTake
        )
    }

    private func useTake(_ slot: LightboxSlot, _ take: ImageTake) async throws {
        try await workspace.api.selectImage(storyId: workspace.storyId, imageGroupId: slot.id, imageId: take.id)
        await workspace.refreshNow()
    }
}
