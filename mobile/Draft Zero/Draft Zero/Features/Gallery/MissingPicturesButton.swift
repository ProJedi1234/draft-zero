import SwiftUI

/// The gallery toolbar's alert for pictures whose files are gone. They are kept
/// off the wall, and this lists them: a popover on iPad, a sheet on iPhone.
struct MissingPicturesButton: View {
    let images: [GalleryImage]
    var onOpenStory: (String) -> Void

    @AppStorage("gallery.dismissedMissing") private var dismissed = ""
    @State private var isPresented = false

    var body: some View {
        if isPresented || MissingPicturesDismissal.shouldAlert(missing: images, dismissed: dismissed) {
            Button {
                isPresented = true
            } label: {
                Label {
                    title
                } icon: {
                    Image(systemName: "exclamationmark.triangle")
                }
            }
            .tint(.orange)
            .popover(isPresented: $isPresented) {
                list
                    .frame(minWidth: 400, minHeight: 360)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    private var title: Text {
        Text("^[\(images.count) picture](inflect: true) missing")
    }

    private var list: some View {
        NavigationStack {
            List(images) { image in
                Button {
                    isPresented = false
                    onOpenStory(image.storyId)
                } label: {
                    MissingPictureRow(image: image)
                }
                .buttonStyle(.plain)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Dismiss") {
                        dismissed = MissingPicturesDismissal.encode(images.map(\.id))
                        isPresented = false
                    }
                }
            }
        }
    }
}

private struct MissingPictureRow: View {
    let image: GalleryImage

    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .headline) private var swatchSize = 10.0

    var body: some View {
        // At accessibility sizes the date drops under the title, which would otherwise truncate to a word.
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(spacing: 8))

        VStack(alignment: .leading, spacing: 4) {
            layout {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if image.tint.hue != nil {
                        Circle()
                            .fill(StoryPalette(tint: image.tint, scheme: scheme).swatch)
                            .frame(width: swatchSize, height: swatchSize)
                            // Sits on the first line's baseline, so it stays beside the first word when the title wraps.
                            .alignmentGuide(.firstTextBaseline) { $0[.bottom] }
                            .accessibilityHidden(true)
                    }
                    Text(image.storyTitle)
                        .font(.headline)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                }
                if !dynamicTypeSize.isAccessibilitySize {
                    Spacer(minLength: 8)
                }
                Text(Format.relativeDate(image.createdAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(image.prompt)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the story")
    }
}
