import SwiftUI

/// A full-screen viewer for illustrations, meant to be the content of a
/// `fullScreenCover`.
///
/// Give it the slots to page through and the slot to open on. With one slot it
/// pages that slot's takes. `onUseTake` makes the previewed take the story's
/// own, and its button appears only when the callback is given. `onOpenStory`
/// works the same way. Both may throw; the lightbox reports failures itself,
/// because a cover hides the app's notice banner.
///
/// Pass the presenter's namespace as `zoomNamespace`, and mark the source
/// tiles with `matchedTransitionSource(id: slot.id, in:)`, to get the zoom
/// transition and its swipe-down dismissal.
struct ImageLightbox: View {
    let slots: [LightboxSlot]
    let imageURL: (String) -> URL
    var zoomNamespace: Namespace.ID?
    var onUseTake: ((LightboxSlot, ImageTake) async throws -> Void)?
    var onOpenStory: ((LightboxSlot) -> Void)?

    @State private var model: LightboxModel
    @State private var chromeVisible = true
    @State private var safeArea = EdgeInsets()
    @State private var bottomBarHeight = 0.0
    @State private var viewportHeight = 0.0
    @State private var isUsingTake = false
    @State private var usedCount = 0
    @State private var failureMessage = ""
    @State private var showsFailure = false

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled

    init(
        slots: [LightboxSlot],
        startingAt slotID: String?,
        imageURL: @escaping (String) -> URL,
        zoomNamespace: Namespace.ID? = nil,
        onUseTake: ((LightboxSlot, ImageTake) async throws -> Void)? = nil,
        onOpenStory: ((LightboxSlot) -> Void)? = nil
    ) {
        self.slots = slots
        self.imageURL = imageURL
        self.zoomNamespace = zoomNamespace
        self.onUseTake = onUseTake
        self.onOpenStory = onOpenStory
        _model = State(initialValue: LightboxModel(slots: slots, startingAt: slotID))
    }

    private var showsChrome: Bool { chromeVisible || voiceOverEnabled }

    private var pageInsets: EdgeInsets {
        guard showsChrome else { return EdgeInsets() }
        return EdgeInsets(top: safeArea.top + 8, leading: 0, bottom: bottomBarHeight + safeArea.bottom + 8, trailing: 0)
    }

    var body: some View {
        @Bindable var model = model
        let page = model.currentPage
        NavigationStack {
            ZStack(alignment: .bottom) {
                LightboxPager(
                    pages: model.pages,
                    pageID: $model.pageID,
                    imageURL: imageURL,
                    insets: pageInsets,
                    onTap: toggleChrome
                )
                .ignoresSafeArea()
                .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: pageInsets)
                .accessibilityAction(named: Text(model.pagesTakes ? "Next Take" : "Next Picture")) { model.step(1) }
                .accessibilityAction(named: Text(model.pagesTakes ? "Previous Take" : "Previous Picture")) { model.step(-1) }

                if showsChrome, let page {
                    LightboxBottomBar(
                        page: page,
                        imageURL: imageURL,
                        canUseTake: onUseTake != nil,
                        isUsingTake: isUsingTake,
                        onShow: showTake,
                        onUse: { useTake(page) },
                        onOpenStory: openStoryAction(for: page),
                        maxCaptionHeight: viewportHeight > 0 ? viewportHeight * 0.4 : .infinity
                    )
                    .onGeometryChange(for: Double.self, of: { $0.size.height }) { bottomBarHeight = $0 }
                    .transition(.opacity)
                }
            }
            .background { Color.black.ignoresSafeArea() }
            .onGeometryChange(for: EdgeInsets.self, of: \.safeAreaInsets) { safeArea = $0 }
            .onGeometryChange(for: Double.self, of: { $0.size.height }) { viewportHeight = $0 }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(role: .close) { dismiss() }
                }
                ToolbarItem(placement: .principal) {
                    LightboxTitle(position: model.position, pagesTakes: model.pagesTakes)
                }
                if let page {
                    ToolbarItem(placement: .topBarTrailing) {
                        LightboxShareButton(url: imageURL(page.take.id), title: page.take.prompt)
                    }
                }
            }
            .toolbarVisibility(showsChrome ? .automatic : .hidden, for: .navigationBar)
            .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(!showsChrome)
        .zoomTransition(from: zoomNamespace, sourceID: page?.slot.id)
        .onChange(of: slots) {
            model.update(slots: slots)
            if model.pages.isEmpty { dismiss() }
        }
        .sensoryFeedback(.success, trigger: usedCount)
        .alert("Couldn't Use This Take", isPresented: $showsFailure) {
        } message: {
            Text(failureMessage)
        }
    }

    private func showTake(_ take: ImageTake) {
        withAnimation(reduceMotion ? nil : .snappy) { model.show(take) }
    }

    private func toggleChrome() {
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.25)) { chromeVisible.toggle() }
    }

    private func openStoryAction(for page: LightboxPage) -> (() -> Void)? {
        guard let onOpenStory, page.slot.storyId != nil else { return nil }
        return {
            dismiss()
            onOpenStory(page.slot)
        }
    }

    private func useTake(_ page: LightboxPage) {
        guard let onUseTake, !isUsingTake else { return }
        isUsingTake = true
        Task {
            do {
                try await onUseTake(page.slot, page.take)
                usedCount += 1
            } catch is CancellationError {
            } catch {
                failureMessage = error.localizedDescription
                showsFailure = true
            }
            isUsingTake = false
        }
    }
}
