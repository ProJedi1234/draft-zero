import SwiftUI

/// A category's heading in the list, with how many entries it holds.
struct LorebookSectionHeader: View {
    let category: LorebookCategory
    let count: Int

    var body: some View {
        HStack {
            Label(category.pluralLabel, systemImage: category.systemImage)
            Spacer()
            Text(count, format: .number)
                .monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(category.pluralLabel), \(count)")
        .accessibilityAddTraits(.isHeader)
    }
}
