import SwiftUI

/// The scrolling wall of pictures, flat or grouped by story.
struct GalleryWall: View {
    let images: [GalleryImage]
    let order: GalleryOrder
    let imageURL: (String) -> URL
    let namespace: Namespace.ID
    var onOpen: (GalleryImage) -> Void
    var onOpenStory: (String) -> Void

    @State private var width = 0.0

    private static let cardMargin = 16.0

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Color.clear
                    .frame(height: 0)
                    .onGeometryChange(for: Double.self, of: { $0.size.width }) { width = $0 }
                if width > 0 {
                    wall
                }
            }
        }
    }

    @ViewBuilder
    private var wall: some View {
        switch order {
        case .newest:
            GalleryRows(
                images: images,
                width: width,
                spacing: 2,
                cornerRadius: 0,
                imageURL: imageURL,
                namespace: namespace,
                onOpen: onOpen
            )
        case .byStory:
            LazyVStack(spacing: 16) {
                ForEach(GalleryGrouping.sections(images)) { section in
                    GalleryStorySection(
                        section: section,
                        width: width - Self.cardMargin * 2,
                        imageURL: imageURL,
                        namespace: namespace,
                        onOpen: onOpen,
                        onOpenStory: onOpenStory
                    )
                }
            }
            .padding(.horizontal, Self.cardMargin)
            .padding(.vertical, 8)
        }
    }
}
