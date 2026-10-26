import SwiftUI

struct WorldMindField: View {
    @Bindable var field: AutosavingField<String>
    let isKeyboardUp: Bool
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("On their mind").font(.subheadline)
            TextField("On their mind", text: $field.value, prompt: Text("Nothing yet"), axis: .vertical)
                .lineLimit(2...5)
                .focused($isFocused)
                .accessibilityLabel("On their mind")
            if field.saveFailed { InspectorUnsavedRow(retry: retry, discard: field.discardEdit) }
            if field.value.utf16.count > 280 {
                Text("That thought is too long.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .onChange(of: isFocused || isKeyboardUp, reportFocus)
        .onChange(of: field.value) {
            if field.value.utf16.count > 280 { field.value = WorldText.limited(field.value, to: 280) }
        }
        .onAppear(perform: reportFocus)
        .onDisappear { field.setFocused(false) }
    }

    private func reportFocus() { field.setFocused(isFocused || isKeyboardUp) }
    private func retry() { Task { await field.flush() } }
}
