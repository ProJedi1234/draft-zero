import SwiftUI

/// One of a scenario's `${…}` blanks: its title, the author's note on it, and
/// the answer, which starts at the author's default.
struct PlaceholderFieldRow: View {
    @Binding var field: PlaceholderField

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(field.label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if !field.placeholder.description.isEmpty {
                Text(field.placeholder.description)
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
            }
            TextField(field.label, text: $field.value, prompt: Text(prompt))
                .font(.body)
        }
        .padding(.vertical, 2)
    }

    private var prompt: String {
        field.placeholder.defaultValue.isEmpty ? "No default" : field.placeholder.defaultValue
    }
}
