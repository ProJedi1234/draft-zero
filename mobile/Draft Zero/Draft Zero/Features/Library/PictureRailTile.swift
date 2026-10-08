import SwiftUI

/// One recent picture; tapping it opens the full-screen viewer.
struct PictureRailTile: View {
    let image: GalleryImage
    let url: URL
    let size: Double
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            ServerImage(url: url, aspectRatio: 1)
                .frame(width: size, height: size)
                .clipShape(.rect(cornerRadius: Theme.smallCornerRadius))
                .contentShape(.rect(cornerRadius: Theme.smallCornerRadius))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Picture from \(image.storyTitle)")
        .accessibilityValue(image.prompt)
        .accessibilityHint("Opens the picture")
    }
}
