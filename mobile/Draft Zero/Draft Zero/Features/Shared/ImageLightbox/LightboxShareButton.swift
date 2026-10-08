import SwiftUI

/// Shares the picture on screen. It waits for the bytes because the share
/// sheet needs them in hand; the loader has usually cached them already.
struct LightboxShareButton: View {
    let url: URL
    let title: String

    @State private var picture: UIImage?

    var body: some View {
        Group {
            if let picture {
                ShareLink(
                    item: Image(uiImage: picture),
                    preview: SharePreview(title, image: Image(uiImage: picture))
                ) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            } else {
                Button("Share", systemImage: "square.and.arrow.up") {}
                    .disabled(true)
            }
        }
        .task(id: url) {
            picture = ImageLoader.shared.cached(url)
            if picture == nil {
                picture = try? await ImageLoader.shared.image(at: url)
            }
        }
    }
}
