import SwiftUI

/// A form row that opens a sheet: the title, its state in a word, a chevron.
struct InspectorSheetRowLabel: View {
    let title: String
    let value: String

    var body: some View {
        LabeledContent {
            HStack(spacing: 6) {
                Text(value)
                Image(systemName: "chevron.forward")
                    .font(.footnote.bold())
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        } label: {
            Text(title)
                .foregroundStyle(.primary)
        }
        .contentShape(.rect)
    }
}
