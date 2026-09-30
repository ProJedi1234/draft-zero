import SwiftUI

/// One choice in the filter menu, with how many entries it would show.
struct LorebookFilterOption: View {
    let filter: LorebookFilter
    let count: Int

    var body: some View {
        Label {
            Text(filter.title)
            Text(count == 1 ? "1 entry" : "\(count) entries")
        } icon: {
            Image(systemName: filter.systemImage)
        }
    }
}
