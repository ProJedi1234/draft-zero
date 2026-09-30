import SwiftUI

/// Trigger keys as removable tokens, plus a field that adds one on Return or
/// comma. Keys match story text literally, so autocorrect and autocapitalise
/// stay off.
struct LorebookKeysEditor: View {
    @Binding var keys: [String]

    @State private var pending = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        if !keys.isEmpty {
            LorebookFlowLayout(spacing: 8) {
                ForEach(keys, id: \.self) { key in
                    LorebookKeyToken(key: key, remove: remove)
                }
            }
        }
        TextField("Add Key", text: $pending, prompt: Text("Add a key"))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.next)
            .focused($isFocused)
            .onSubmit(submit)
            .onChange(of: pending) { _, text in
                commitBeforeComma(text)
            }
            .onChange(of: isFocused) { _, focused in
                if !focused { commit() }
            }
    }

    private func submit() {
        let hadText = !pending.trimmingCharacters(in: .whitespaces).isEmpty
        commit()
        // Return adds a key and keeps typing; Return on an empty field is done.
        if hadText { isFocused = true }
    }

    private func commit() {
        guard !pending.isEmpty else { return }
        let next = LorebookKeys.adding(pending, to: keys)
        pending = ""
        if next != keys { keys = next }
    }

    private func commitBeforeComma(_ text: String) {
        guard let split = LorebookKeys.splitAtLastComma(text) else { return }
        let next = LorebookKeys.adding(split.committed, to: keys)
        pending = split.remainder.trimmingCharacters(in: .whitespaces)
        if next != keys { keys = next }
    }

    private func remove(_ key: String) {
        keys.removeAll { $0 == key }
    }
}
