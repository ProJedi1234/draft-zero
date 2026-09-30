import SwiftUI

/// "See All" beside the recent pictures: the Gallery tab has every one.
struct GalleryLinkButton: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Button("See All", action: showGallery)
            .font(.subheadline)
            .textCase(nil)
            .accessibilityHint("Shows the Gallery")
    }

    private func showGallery() {
        app.selectedTab = .gallery
    }
}
