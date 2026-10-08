import SwiftUI

/// One story's pictures, on a card washed in the story's own hue.
struct GalleryStorySection: View {
    let section: GallerySection
    let width: Double
    let imageURL: (String) -> URL
    let namespace: Namespace.ID
    var onOpen: (GalleryImage) -> Void
    var onOpenStory: (String) -> Void

    @Environment(\.colorScheme) private var scheme

    private static let padding = 12.0

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            GalleryRows(
                images: section.images,
                width: width - Self.padding * 2,
                spacing: 4,
                cornerRadius: Theme.smallCornerRadius,
                imageURL: imageURL,
                namespace: namespace,
                onOpen: onOpen
            )
        }
        .padding(Self.padding)
        .background {
            RoundedRectangle(cornerRadius: Theme.cornerRadius)
                .fill(.fill.quaternary)
            RoundedRectangle(cornerRadius: Theme.cornerRadius)
                .fill(StoryPalette.cardWash(section.tint, scheme: scheme))
        }
    }

    private var header: some View {
        Button {
            onOpenStory(section.storyId)
        } label: {
            HStack(spacing: 8) {
                if section.tint.hue != nil {
                    Circle()
                        .fill(StoryPalette(tint: section.tint, scheme: scheme).swatch)
                        .frame(width: 10, height: 10)
                        .accessibilityHidden(true)
                }
                Text(section.title)
                    .font(.headline)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(section.images.count, format: .number)
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.bold())
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(section.title)
        .accessibilityValue("^[\(section.images.count) picture](inflect: true)")
        .accessibilityHint("Opens the story")
    }
}
