import SwiftUI

/// Full-width pages that snap into place. Scrolling stops while a picture is
/// zoomed, so a drag pans the picture instead of turning the page.
struct LightboxPager: View {
    let pages: [LightboxPage]
    @Binding var pageID: String?
    let imageURL: (String) -> URL
    let insets: EdgeInsets
    var onTap: () -> Void

    @State private var isZoomed = false

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(pages) { page in
                    LightboxPageView(
                        page: page,
                        url: imageURL(page.take.id),
                        insets: insets,
                        isActive: page.id == pageID,
                        isZoomed: $isZoomed,
                        onTap: onTap
                    )
                    .containerRelativeFrame(.horizontal)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $pageID)
        .scrollIndicators(.hidden)
        .scrollDisabled(isZoomed)
        .scrollEdgeEffectHidden()
    }
}
