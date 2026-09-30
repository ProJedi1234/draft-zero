import SwiftUI

/// An illustration in the manuscript: its own beat, with its takes, its
/// caption, and the moves a picture offers.
struct ImageBlockView: View {
    let image: StoryImage
    let busy: Bool
    let workspace: StoryWorkspace

    @State private var showingViewer = false
    @State private var captionExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: openViewer) {
                ServerImage(
                    url: workspace.api.imageURL(image.id),
                    aspectRatio: image.aspectRatio.value,
                    accessibilityLabel: caption
                )
                .clipShape(.rect(cornerRadius: Theme.cornerRadius))
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the picture full screen")

            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Button(action: toggleCaption) {
                    Text(caption)
                        .font(.system(.footnote, design: .serif))
                        .italic()
                        .foregroundStyle(.secondary)
                        .lineLimit(captionExpanded ? nil : 2)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Prompt: \(caption)")
                .accessibilityHint(captionExpanded ? "Collapses the prompt" : "Shows the whole prompt")

                if image.imageCount > 1 {
                    TakeSwitcher(index: image.imageIndex, count: image.imageCount, disabled: busy, step: step)
                        .font(.footnote)
                }
                Menu("Picture Actions", systemImage: "ellipsis.circle") {
                    ImageMenu(image: image, workspace: workspace, busy: busy, openViewer: openViewer)
                }
                .labelStyle(.iconOnly)
                .font(.body)
            }
        }
        .padding(.vertical, 10)
        .contextMenu {
            ImageMenu(image: image, workspace: workspace, busy: busy, openViewer: openViewer)
        }
        .fullScreenCover(isPresented: $showingViewer) {
            StoryImageViewer(image: image, workspace: workspace)
        }
    }

    /// What the writer asked for when there was a brief; what was sent otherwise.
    private var caption: String {
        image.sourcePrompt ?? ImageStyles.split(image.prompt).scene
    }

    private func openViewer() {
        showingViewer = true
    }

    private func toggleCaption() {
        withAnimation(Theme.quickAnimation) { captionExpanded.toggle() }
    }

    private func step(_ offset: Int) {
        Task { await workspace.stepImage(image, by: offset) }
    }
}
