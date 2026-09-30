import SwiftUI

/// One picture on the wall, at the size its row gave it.
struct GalleryTile: View {
    let image: GalleryImage
    let url: URL
    let size: CGSize
    let cornerRadius: Double
    let namespace: Namespace.ID
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            ServerImage(url: url, aspectRatio: image.aspectRatio.value, contentMode: .fill)
                .frame(width: size.width, height: size.height)
                .overlay(alignment: .topTrailing) {
                    if image.takes.count > 1 {
                        TakeCountBadge(count: image.takes.count)
                    }
                }
                .clipShape(.rect(cornerRadius: cornerRadius))
        }
        .buttonStyle(.plain)
        .matchedTransitionSource(id: image.imageGroupId, in: namespace) { source in
            source.clipShape(.rect(cornerRadius: cornerRadius))
        }
        .accessibilityLabel(image.prompt)
        .accessibilityValue(image.takes.count > 1 ? "\(image.takes.count) takes" : "")
        .accessibilityHint("Opens the picture")
    }
}
