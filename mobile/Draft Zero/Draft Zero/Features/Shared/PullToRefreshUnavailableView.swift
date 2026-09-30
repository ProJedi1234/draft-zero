import SwiftUI

/// A `ContentUnavailableView` that sits in a scroll view, so pull to refresh
/// still works on an empty or failed screen.
struct PullToRefreshUnavailableView<Label: View, Description: View, Actions: View>: View {
    @ViewBuilder var label: () -> Label
    @ViewBuilder var description: () -> Description
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        ScrollView {
            ContentUnavailableView(label: label, description: description, actions: actions)
                .containerRelativeFrame([.horizontal, .vertical])
        }
    }
}
