import SwiftUI

/// One zoomable picture in the pager.
struct LightboxPageView: View {
    let page: LightboxPage
    let url: URL
    let insets: EdgeInsets
    let isActive: Bool
    @Binding var isZoomed: Bool
    var onTap: () -> Void

    var body: some View {
        ZoomablePicture(
            aspectRatio: page.take.aspectRatio.value,
            insets: insets,
            isActive: isActive,
            isZoomed: $isZoomed,
            onSingleTap: onTap
        ) {
            ServerImage(
                url: url,
                aspectRatio: page.take.aspectRatio.value,
                contentMode: .fit,
                accessibilityLabel: page.take.prompt
            )
        }
        .id(page.take.id)
        .onChange(of: page.take.id) {
            if isActive { isZoomed = false }
        }
    }
}
