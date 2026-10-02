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
        ScrollViewReader { proxy in
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
            // The zoom transition grows the pager from tile width frame by frame,
            // and each resize can leave it a page short of `pageID`.
            .onScrollGeometryChange(for: CGFloat.self, of: \.containerSize.width) { _, _ in
                if let pageID { proxy.scrollTo(pageID) }
            }
        }
    }
}
