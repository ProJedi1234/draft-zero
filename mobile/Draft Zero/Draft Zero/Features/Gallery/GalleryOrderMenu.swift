import SwiftUI

/// The toolbar control that switches between the flat wall and story groups.
struct GalleryOrderMenu: View {
    @Binding var order: GalleryOrder

    var body: some View {
        Menu {
            Picker("Arrange", selection: $order) {
                ForEach(GalleryOrder.allCases) { option in
                    Label(option.title, systemImage: option.systemImage)
                        .tag(option)
                }
            }
        } label: {
            Label("Arrange", systemImage: order.systemImage)
        }
        .accessibilityValue(order.title)
    }
}
