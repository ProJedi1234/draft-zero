import SwiftUI

/// Takes its content's height up to `maxHeight`, then scrolls. An invisible
/// copy of the content sets the size, since a scroll view claims all the
/// space it is offered.
struct CappedScrollView<Content: View>: View {
    let maxHeight: Double
    @ViewBuilder var content: () -> Content

    var body: some View {
        CappedHeightLayout(maxHeight: maxHeight) {
            content().hidden()
            ScrollView { content() }
                .scrollBounceBehavior(.basedOnSize)
        }
    }
}
