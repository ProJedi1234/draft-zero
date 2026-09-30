import SwiftUI

/// One story's content: title and run mark, the author's description, the
/// tail of its newest prose, and the meta line.
struct StoryRow: View {
    let story: StoryRecord
    let excerpt: String?
    let mark: LibraryStore.RunMark?
    let run: ActiveRun?
    var excerptLines = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(story.title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                Spacer(minLength: 0)
                StoryRunMarkView(mark: mark)
            }
            if !story.description.isEmpty {
                Text(LibraryExcerpt.snippet(story.description))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            if let excerpt, !excerpt.isEmpty {
                Text(LibraryExcerpt.snippet(excerpt))
                    .font(.system(.subheadline, design: .serif))
                    .foregroundStyle(.primary.opacity(0.8))
                    .lineLimit(excerptLines)
                    .padding(.top, 2)
            }
            StoryMetaText(story: story, mark: mark, run: run)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
