import SwiftUI

/// A story's meta line; ticks once a second while its run is working so the
/// elapsed time stays true.
struct StoryMetaText: View {
    let story: StoryRecord
    let mark: LibraryStore.RunMark?
    let run: ActiveRun?
    var isContinue = false

    var body: some View {
        Group {
            if mark == .working {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(line(now: context.date))
                }
            } else {
                Text(line(now: .now))
            }
        }
        .font(.footnote)
        .foregroundStyle(mark == .failed ? AnyShapeStyle(Color.red) : AnyShapeStyle(HierarchicalShapeStyle.secondary))
        .monospacedDigit()
    }

    private func line(now: Date) -> String {
        isContinue
            ? StoryMeta.continueLine(for: story, mark: mark, runStartedAt: run?.startedAt, now: now)
            : StoryMeta.line(for: story, mark: mark, runStartedAt: run?.startedAt, now: now)
    }
}
