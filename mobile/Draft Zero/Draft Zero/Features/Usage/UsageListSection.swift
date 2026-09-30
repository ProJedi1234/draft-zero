import SwiftUI

/// A titled list of spend rows that shows the biggest few and offers the rest.
struct UsageListSection<Element, Row: View>: View {
    let title: LocalizedStringKey
    let elements: [Element]
    let emptyText: LocalizedStringKey
    var cap = 8
    @ViewBuilder var row: (Element) -> Row

    @State private var isExpanded = false

    private var visible: [Element] {
        isExpanded ? elements : Array(elements.prefix(cap))
    }

    var body: some View {
        Section(title) {
            if elements.isEmpty {
                Text(emptyText)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(visible.enumerated()), id: \.offset) { _, element in
                row(element)
            }
            if elements.count > cap {
                Button(isExpanded ? "Show Fewer" : "Show All \(elements.count)", action: toggle)
            }
        }
    }

    private func toggle() {
        withAnimation(Theme.quickAnimation) { isExpanded.toggle() }
    }
}
