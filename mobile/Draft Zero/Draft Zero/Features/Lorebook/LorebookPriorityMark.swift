import SwiftUI

/// An entry's priority: bars filled in proportion, and the number.
struct LorebookPriorityMark: View {
    let priority: Int

    var body: some View {
        Label {
            Text(priority, format: .number)
                .monospacedDigit()
        } icon: {
            Image(systemName: "cellularbars", variableValue: Double(priority) / 100)
        }
        .labelStyle(.titleAndIcon)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Priority \(priority)")
    }
}
