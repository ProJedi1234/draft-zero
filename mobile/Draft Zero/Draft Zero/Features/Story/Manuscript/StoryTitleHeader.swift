import SwiftUI

/// The top of the book: title, genre and pitch, above the first passage.
struct StoryTitleHeader: View {
    let story: Story

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(story.title)
                .font(.system(.largeTitle, design: .serif))
                .bold()
                .accessibilityAddTraits(.isHeader)
            if !story.genre.isEmpty {
                Text(story.genre.uppercased())
                    .font(.caption)
                    .tracking(1.2)
                    .foregroundStyle(.secondary)
            }
            if !story.description.isEmpty {
                Text(story.description)
                    .font(.system(.callout, design: .serif))
                    .italic()
                    .foregroundStyle(.secondary)
            }
            Divider()
                .padding(.top, 8)
        }
        .padding(.bottom, 12)
    }
}
