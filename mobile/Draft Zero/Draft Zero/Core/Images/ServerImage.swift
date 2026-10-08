import SwiftUI

/// An illustration from the server, in a frame reserved at its aspect ratio so
/// nothing moves when the pixels land.
struct ServerImage: View {
    let url: URL
    let aspectRatio: Double
    var contentMode: ContentMode = .fill
    var accessibilityLabel: String?

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Color.clear
            .aspectRatio(aspectRatio, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .accessibilityLabel(accessibilityLabel ?? "Illustration")
                        .transition(.opacity)
                } else if failed {
                    Image(systemName: "photo.badge.exclamationmark")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.fill.tertiary)
                        .accessibilityLabel("Picture unavailable")
                } else {
                    Rectangle()
                        .fill(.fill.tertiary)
                        .overlay { ProgressView() }
                        .accessibilityLabel("Loading picture")
                }
            }
            .clipped()
            .animation(.easeOut(duration: 0.2), value: image != nil)
            .task(id: url) { await load() }
    }

    private func load() async {
        if let cached = ImageLoader.shared.cached(url) {
            image = cached
            return
        }
        failed = false
        do {
            image = try await ImageLoader.shared.image(at: url)
        } catch is CancellationError {
            return
        } catch {
            failed = true
        }
    }
}
