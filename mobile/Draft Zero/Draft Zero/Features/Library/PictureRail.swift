import SwiftUI

/// The newest illustrations in the library, one row wide; a tile fading out
/// at the trailing edge says there is more.
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
            // A hard cut at the edge reads as a clipping bug, and in the phone
            // list the cell's rounded corner bites a D-shape out of the tile.
            .mask {
                HStack(spacing: 0) {
                    Color.black
                    LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: tileSize * 0.75)
                }
            }
        }
    }
}
