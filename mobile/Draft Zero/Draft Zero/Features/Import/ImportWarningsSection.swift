import SwiftUI

/// Everything a reader dropped or coerced, each in its own words.
struct ImportWarningsSection: View {
    let title: LocalizedStringKey
    let warnings: [String]

    var body: some View {
        if !warnings.isEmpty {
            Section(title) {
                ForEach(warnings.enumerated(), id: \.offset) { _, warning in
                    Label {
                        Text(warning)
                            .font(.subheadline)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                }
            }
        }
    }
}
