import SwiftUI

/// The newest illustrations in the library, one row wide; a half tile at the
/// edge says there is more.
struct PictureRail: View {
    let images: [GalleryImage]
    var inset: Double = 0
    let onOpenStory: (String) -> Void

    @Environment(AppModel.self) private var app
    @ScaledMetric(relativeTo: .body) private var tileSize = 92.0

    var body: some View {
        if let api = app.api {
            ScrollView(.horizontal) {
                LazyHStack(spacing: 8) {
                    ForEach(images) { image in
                        PictureRailTile(image: image, url: api.imageURL(image.id), size: tileSize) {
                            onOpenStory(image.storyId)
                        }
                    }
                }
                .scrollTargetLayout()
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned)
            .contentMargins(.horizontal, inset, for: .scrollContent)
            .frame(height: tileSize)
        }
    }
}
