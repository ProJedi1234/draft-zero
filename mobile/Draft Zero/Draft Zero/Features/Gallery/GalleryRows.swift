import SwiftUI

/// A set of pictures packed into rows for a given width.
struct GalleryRows: View {
    let images: [GalleryImage]
    let width: Double
    let spacing: Double
    let cornerRadius: Double
    let imageURL: (String) -> URL
    let namespace: Namespace.ID
    var onOpen: (GalleryImage) -> Void

    private var rows: [JustifiedRow] {
        JustifiedLayout.rows(
            aspectRatios: images.map(\.aspectRatio.value),
            width: width,
            targetHeight: min(max(width * 0.38, 130), 240),
            spacing: spacing
        )
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: spacing) {
            ForEach(rows) { row in
                HStack(spacing: spacing) {
                    ForEach(row.items, id: \.index) { item in
                        let image = images[item.index]
                        GalleryTile(
                            image: image,
                            url: imageURL(image.id),
                            size: CGSize(width: item.width, height: row.height),
                            cornerRadius: cornerRadius,
                            namespace: namespace
                        ) {
                            onOpen(image)
                        }
                    }
                }
            }
        }
    }
}
