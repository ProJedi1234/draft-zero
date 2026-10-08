import SwiftUI

/// The manuscript, read like a book: passages and pictures in order, then the
/// live edge where the next beat is being written or drawn.
///
/// Stays pinned to the bottom while the writer is there, so streamed prose
/// scrolls into view; once they scroll up to read, it leaves them alone.
struct ManuscriptView: View {
    let workspace: StoryWorkspace

    @State private var position = ScrollPosition()
    @State private var pinned = true

    var body: some View {
        let items = workspace.manuscript
        let busy = workspace.generation.busy
        let lastEntryId = workspace.lastEntryId
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if workspace.hasMoreOlder {
                    LoadEarlierRow(isLoading: workspace.isLoadingOlder, load: loadEarlier)
                } else if let story = workspace.story {
                    StoryTitleHeader(story: story)
                }

                if items.isEmpty && workspace.generation.echo == nil
                    && workspace.generation.status == .idle && workspace.illustration.job == nil {
                    StoryEmptyState(title: workspace.story?.title ?? "", suggest: suggest)
                }

                ForEach(items) { item in
                    switch item {
                    case .entry(let entry):
                        EntryBlockView(
                            entry: entry,
                            isLast: entry.id == lastEntryId,
                            busy: busy,
                            workspace: workspace
                        )
                    case .image(let image):
                        ImageBlockView(image: image, busy: busy, workspace: workspace)
                    }
                }

                LiveEdgeView(workspace: workspace, onGrowth: followLiveEdge)
                    .id(Self.liveEdgeID)
            }
            .scrollTargetLayout()
            .frame(maxWidth: Theme.readingWidth)
            .frame(maxWidth: .infinity)
        }
        .contentMargins(.horizontal, 20, for: .scrollContent)
        .contentMargins(.top, 12, for: .scrollContent)
        .contentMargins(.bottom, 24, for: .scrollContent)
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            let bottom = geometry.contentOffset.y + geometry.containerSize.height - geometry.contentInsets.bottom
            return geometry.contentSize.height - bottom < 160
        } action: { _, nearBottom in
            pinned = nearBottom
        }
        // Rotating with the status bar hidden (focus mode) leaves the lazy stack
        // sized from stale estimates, so a pinned reader lands in blank space.
        .onScrollGeometryChange(for: CGSize.self, of: \.containerSize) { _, _ in
            followLiveEdge()
        }
        .onChange(of: items.last?.id) {
            followLiveEdge()
        }
        .onChange(of: workspace.generation.echo) { _, echo in
            // The writer just sent a move: bring them to where it lands.
            if echo != nil {
                pinned = true
                followLiveEdge()
            }
        }
    }

    private static let liveEdgeID = "live-edge"

    private func followLiveEdge() {
        guard pinned else { return }
        // Not scrollTo(edge:): that also sets x, ignoring the horizontal content
        // margin and shifting the column sideways.
        position.scrollTo(id: Self.liveEdgeID, anchor: .bottom)
    }

    private func loadEarlier() {
        let anchor = workspace.manuscript.first?.id
        Task {
            await workspace.loadOlder()
            if let anchor { position.scrollTo(id: anchor, anchor: .top) }
        }
    }

    /// Empty-state openings are Do-shaped, so they arm Do.
    private func suggest(_ text: String) {
        workspace.composer.mode = .do
        workspace.composer.text = text
        workspace.composer.requestFocus()
    }
}
