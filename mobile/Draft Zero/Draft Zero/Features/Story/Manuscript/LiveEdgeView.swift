import SwiftUI

/// Everything shown ahead of the server at the end of the manuscript: the
/// writer's echoed move, the picture being drawn, and the passage being
/// written. Its own view so streamed text re-renders only this.
struct LiveEdgeView: View {
    let workspace: StoryWorkspace
    let onGrowth: () -> Void

    var body: some View {
        let generation = workspace.generation
        VStack(alignment: .leading, spacing: 6) {
            if let echo = generation.optimisticUserText {
                EchoBlockView(text: echo, pending: generation.optimisticUserPending, tint: workspace.tint)
                    .padding(.top, workspace.manuscript.isEmpty ? 0 : Theme.turnBreak)
            }
            if let job = workspace.illustration.job {
                IllustrationJobView(job: job, stop: workspace.illustration.stop)
            }
            if generation.showsTail {
                StreamingPassageView(text: generation.visibleStreamingText, status: generation.status)
                    .padding(.top, continuesUnprompted ? Theme.turnBreak : 0)
            } else {
                RestingMark()
            }
        }
        .onChange(of: generation.visibleStreamingText) { onGrowth() }
        .onChange(of: workspace.illustration.job?.runId) { onGrowth() }
    }

    /// Matches ManuscriptItem.startsTurn, so the persisted row lands where the stream was.
    private var continuesUnprompted: Bool {
        guard workspace.generation.optimisticUserText == nil, let last = workspace.manuscript.last else { return false }
        if case .entry(let entry) = last, entry.source == .user { return false }
        return true
    }
}
