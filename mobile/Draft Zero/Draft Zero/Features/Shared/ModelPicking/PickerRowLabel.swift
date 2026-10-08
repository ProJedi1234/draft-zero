import SwiftUI

/// The face of a row that opens a picker: the title with the current choice
/// on the same line, and an optional detail beneath at full width. Stacks the
/// choice under the title at accessibility text sizes.
struct PickerRowLabel: View {
    let title: String
    let value: String
    /// What VoiceOver reads for `value` when the text alone would not say it, such as a flag.
    var spokenValue: String?
    var detail: String?
    var isLoading = false
    var showsChevron = true

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))

        VStack(alignment: .leading, spacing: 3) {
            layout {
                Text(title)
                    .foregroundStyle(.primary)
                if !dynamicTypeSize.isAccessibilitySize {
                    Spacer(minLength: 0)
                }
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if isLoading {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(value)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
                        .accessibilityLabel(spokenValue ?? value)
                    if showsChevron {
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.footnote)
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }
                }
            }
            if let detail {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
            }
        }
        // A Menu centres its label's text unless told otherwise.
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
    }
}
