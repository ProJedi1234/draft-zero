import SwiftUI

/// A slot's takes as thumbnails. Tapping one previews it; nothing changes in
/// the story until the caller acts on the preview.
struct TakeFilmstrip: View {
    let takes: [ImageTake]
    let shownID: String
    let activeID: String
    let imageURL: (String) -> URL
    var onShow: (ImageTake) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            thumbnails
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    thumbnails
                }
                .scrollIndicators(.hidden)
                .onChange(of: shownID, initial: true) {
                    proxy.scrollTo(shownID, anchor: .center)
                }
            }
        }
    }

    private var thumbnails: some View {
        HStack(spacing: 6) {
            ForEach(Array(takes.enumerated()), id: \.element.id) { index, take in
                TakeThumbnail(
                    take: take,
                    number: index + 1,
                    count: takes.count,
                    url: imageURL(take.id),
                    isShown: take.id == shownID,
                    isActive: take.id == activeID
                ) {
                    onShow(take)
                }
            }
        }
        .padding(.horizontal, 8)
    }
}
