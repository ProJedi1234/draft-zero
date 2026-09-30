import SwiftUI

/// A library section's heading, with a count or a link on the trailing side.
struct LibrarySectionHeader<Trailing: View>: View {
    let title: LocalizedStringKey
    let trailing: Trailing

    init(_ title: LocalizedStringKey, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            trailing
        }
    }
}

extension LibrarySectionHeader where Trailing == EmptyView {
    init(_ title: LocalizedStringKey) {
        self.title = title
        trailing = EmptyView()
    }
}
