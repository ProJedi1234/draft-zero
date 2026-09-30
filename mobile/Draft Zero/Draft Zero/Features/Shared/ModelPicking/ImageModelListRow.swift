import SwiftUI

/// One image model in the catalog list.
struct ImageModelListRow: View {
    let model: OpenRouterImageModel
    let isSelected: Bool
    let isBlocked: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(model.name)
                    Text(model.id)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                SelectionCheckmark(isSelected: isSelected)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .disabled(isBlocked)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
