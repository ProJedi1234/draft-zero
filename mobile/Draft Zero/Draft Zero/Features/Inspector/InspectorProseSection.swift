import SwiftUI

/// A block of prose the writer keeps, saved after a pause and on leaving the
/// field. A save that fails keeps the words on screen with a way to retry.
struct InspectorProseSection: View {
    let title: String
    let placeholder: String
    let footer: String
    let lines: ClosedRange<Int>
    @Bindable var field: AutosavingField<String>
    /// The keyboard is up with this segment showing. Counted as focus because
    /// `@FocusState` never changes inside the inspector's iPhone sheet.
    let isKeyboardUp: Bool

    @FocusState private var isFocused: Bool

    var body: some View {
        Section {
            TextField(title, text: $field.value, prompt: Text(placeholder), axis: .vertical)
                .lineLimit(lines)
                .focused($isFocused)
            if field.saveFailed {
                InspectorUnsavedRow(retry: retry, discard: field.discardEdit)
            }
        } header: {
            Text(title)
        } footer: {
            Text(footer)
        }
        .onChange(of: isFocused || isKeyboardUp, reportFocus)
        // A segment switch tears the field down without a focus change, and a
        // row scrolled back into view has missed any change made while it was off.
        .onAppear(perform: reportFocus)
        .onDisappear(perform: release)
    }

    private func reportFocus() {
        field.setFocused(isFocused || isKeyboardUp)
    }

    private func retry() {
        Task { await field.flush() }
    }

    private func release() {
        field.setFocused(false)
    }
}
