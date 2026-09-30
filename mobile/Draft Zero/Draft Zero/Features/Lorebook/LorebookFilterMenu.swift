import SwiftUI

/// Narrows the list to one category. The icon fills while a filter is on.
struct LorebookFilterMenu: View {
    @Bindable var model: LorebookModel

    var body: some View {
        Menu {
            Picker("Show", selection: $model.filter) {
                LorebookFilterOption(filter: .all, count: model.count(.all))
                    .tag(LorebookFilter.all)
                Divider()
                ForEach(LorebookCategory.allCases) { category in
                    LorebookFilterOption(filter: .category(category), count: model.count(.category(category)))
                        .tag(LorebookFilter.category(category))
                }
            }
            .pickerStyle(.inline)
        } label: {
            Label(
                "Filter",
                systemImage: model.filter == .all
                    ? "line.3.horizontal.decrease"
                    : "line.3.horizontal.decrease.circle.fill"
            )
        }
        .accessibilityValue(model.filter.title)
    }
}
