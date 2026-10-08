import SwiftUI

/// The story you were last in, and the prose you were in the middle of: the
/// excerpt is the tail of the newest passage, so it ends where the writing does.
struct ContinueCard: View {
    let story: StoryRecord
    let excerpt: String?
    let mark: LibraryStore.RunMark?
    let run: ActiveRun?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(story.title)
                    .font(Theme.proseTitleFont)
                    .bold()
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                Spacer(minLength: 0)
                StoryRunMarkView(mark: mark)
            }
            Group {
                if let excerpt, !excerpt.isEmpty {
                    Text(excerpt)
                        .foregroundStyle(.primary.opacity(0.8))
                        .lineLimit(6)
                } else {
                    Text("Nothing written yet. Open it and start.")
                        .foregroundStyle(.secondary)
                }
            }
            .font(Theme.proseFont)
            .lineSpacing(3)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    StoryMetaText(story: story, mark: mark, run: run, isContinue: true)
                    Spacer(minLength: 12)
                    ContinuePill()
                }
                VStack(alignment: .leading, spacing: 10) {
                    StoryMetaText(story: story, mark: mark, run: run, isContinue: true)
                    ContinuePill()
                }
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
