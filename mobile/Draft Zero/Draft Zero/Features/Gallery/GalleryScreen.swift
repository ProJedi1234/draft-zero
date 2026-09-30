import SwiftUI

/// Every picture in the library, newest first or grouped by story, with a
/// lightbox that a tap opens into.
struct GalleryScreen: View {
    @Environment(AppModel.self) private var app
    @State private var model = GalleryModel()
    @State private var launch: LightboxLaunch?
    @AppStorage("gallery.order") private var order: GalleryOrder = .newest
    @Namespace private var zoomNamespace

    var body: some View {
        content
            .navigationTitle("Gallery")
            .navigationSubtitle(subtitle)
            .toolbar {
                if !model.images.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        GalleryOrderMenu(order: $order)
                    }
                }
            }
            .refreshable { await model.reload() }
            .fullScreenCover(item: $launch) { launch in
                lightbox(startingAt: launch.slotID)
            }
            .task(id: app.serverURL) {
                model.attach(api: app.api)
                await model.reload()
            }
            .onAppear {
                model.start(sync: app.sync)
                if model.isLoaded { model.scheduleRefresh() }
            }
            .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var content: some View {
        if let api = app.api, !model.images.isEmpty {
            GalleryWall(
                images: model.images,
                order: order,
                imageURL: api.imageURL,
                namespace: zoomNamespace,
                onOpen: { launch = LightboxLaunch(slotID: $0.imageGroupId) },
                onOpenStory: app.openStory
            )
        } else if let error = model.loadError {
            PullToRefreshUnavailableView {
                Label("Can't Load the Gallery", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error.localizedDescription)
            } actions: {
                Button("Try Again") { Task { await model.reload() } }
                    .buttonStyle(.borderedProminent)
            }
        } else if model.isLoaded {
            PullToRefreshUnavailableView {
                Label("No Pictures Yet", systemImage: "photo.on.rectangle.angled")
            } description: {
                Text("Ask any story for a picture and it lands here too.")
            } actions: {}
        } else {
            ProgressView("Loading pictures")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var subtitle: Text {
        model.images.isEmpty ? Text("") : Text("^[\(model.images.count) picture](inflect: true)")
    }

    private func openStory(from slot: LightboxSlot) {
        if let storyId = slot.storyId { app.openStory(storyId) }
    }

    @ViewBuilder
    private func lightbox(startingAt slotID: String) -> some View {
        if let api = app.api {
            ImageLightbox(
                slots: GalleryGrouping.displayed(model.images, by: order).map(\.lightboxSlot),
                startingAt: slotID,
                imageURL: api.imageURL,
                zoomNamespace: zoomNamespace,
                onUseTake: { slot, take in try await model.useTake(take, in: slot) },
                onOpenStory: openStory
            )
        }
    }
}
