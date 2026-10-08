import SwiftUI

/// The "follow the default" row at the top of a picker list.
struct DefaultChoiceRow: View {
    let title: String
    let detail: String
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                SelectionCheckmark(isSelected: isSelected)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
