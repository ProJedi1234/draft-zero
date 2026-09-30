import SwiftUI

/// The filmstrip and caption laid over the bottom of the picture.
struct LightboxBottomBar: View {
    let page: LightboxPage
    let imageURL: (String) -> URL
    let canUseTake: Bool
    let isUsingTake: Bool
    var onShow: (ImageTake) -> Void
    var onUse: () -> Void
    var onOpenStory: (() -> Void)?
    var maxCaptionHeight = Double.infinity

    private var showsUseButton: Bool {
        canUseTake && page.take.id != page.slot.activeTake?.id
    }

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            VStack(spacing: 12) {
                if page.slot.takes.count > 1 {
                    filmstripRow
                }
                LightboxCaption(
                    take: page.take,
                    storyTitle: page.slot.storyTitle,
                    onOpenStory: onOpenStory,
                    maxHeight: maxCaptionHeight
                )
                    .glassEffect(.regular, in: .rect(cornerRadius: 26))
            }
        }
        .frame(maxWidth: 560)
        .padding(.horizontal)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
    }

    private var filmstripRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                filmstrip
                if showsUseButton { UseTakeButton(isWorking: isUsingTake, action: onUse) }
            }
            VStack(spacing: 10) {
                filmstrip
                if showsUseButton { UseTakeButton(isWorking: isUsingTake, action: onUse) }
            }
        }
    }

    private var filmstrip: some View {
        TakeFilmstrip(
            takes: page.slot.takes,
            shownID: page.take.id,
            activeID: page.slot.activeTake?.id ?? page.take.id,
            imageURL: imageURL,
            onShow: onShow
        )
        .glassEffect(.regular, in: .capsule)
    }
}
