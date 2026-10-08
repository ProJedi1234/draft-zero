import SwiftUI

/// What a picture was asked for and where it came from, with a way into its story.
struct LightboxCaption: View {
    let take: ImageTake
    var storyTitle: String?
    var onOpenStory: (() -> Void)?
    /// Beyond this the caption scrolls, so huge type never crowds the picture out.
    var maxHeight = Double.infinity

    @State private var isExpanded = false

    private static let collapsedLimit = 110

    private var details: String {
        var parts = [Format.shortModelId(take.modelId), take.aspectRatio.rawValue]
        if let date = ISODate.parse(take.createdAt) {
            parts.append(date.formatted(date: .abbreviated, time: .shortened))
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        CappedScrollView(maxHeight: maxHeight) { content }
            .padding(16)
            .onChange(of: take.id) { isExpanded = false }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 10) {
            LightboxPromptText(prompt: take.prompt, isExpanded: isExpanded)
            if take.prompt.count > Self.collapsedLimit {
                Button(isExpanded ? "Show Less" : "Show More", action: toggleExpanded)
                    .font(.footnote.bold())
            }
            Text(details)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if storyTitle != nil || onOpenStory != nil {
                storyRow
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var storyRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                storyLabel
                Spacer(minLength: 0)
                openStoryButton
            }
            VStack(alignment: .leading, spacing: 8) {
                storyLabel
                openStoryButton
            }
        }
    }

    @ViewBuilder
    private var storyLabel: some View {
        if let storyTitle {
            Label(storyTitle, systemImage: "book.closed")
                .font(.subheadline)
                .lineLimit(2)
        }
    }

    @ViewBuilder
    private var openStoryButton: some View {
        if let onOpenStory {
            Button("Open Story", systemImage: "arrow.up.right", action: onOpenStory)
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
        }
    }

    private func toggleExpanded() {
        withAnimation(Theme.quickAnimation) { isExpanded.toggle() }
    }
}
