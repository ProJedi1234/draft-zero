import SwiftUI

/// An entry's editable fields as form sections, shared by the editor and the
/// new-entry sheet.
struct LorebookEntryFields: View {
    @Binding var draft: NewLorebookEntry
    let nameError: String?
    var focusesName = false

    @FocusState private var isNameFocused: Bool

    var body: some View {
        Section {
            TextField("Name", text: $draft.name, prompt: Text("Name this entry"))
                .font(.headline)
                .textInputAutocapitalization(.words)
                .focused($isNameFocused)
            if let nameError {
                Label(nameError, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            Picker("Category", selection: $draft.category) {
                ForEach(LorebookCategory.allCases) { category in
                    Label(category.label, systemImage: category.systemImage)
                        .tag(category)
                }
            }
        }

        Section {
            LorebookKeysEditor(keys: $draft.keys)
        } header: {
            Text("Trigger Keys")
        } footer: {
            Text("The entry joins the context when a key appears in recent story text. Case doesn't matter, and a key also matches inside longer words.")
        }

        Section {
            TextField("Content", text: $draft.content, prompt: Text("What should the model know?"), axis: .vertical)
                .lineLimit(6...)
        } header: {
            Text("Content")
        } footer: {
            Text("Sent to the model while the entry is active.")
        }

        Section {
            Toggle(isOn: $draft.enabled) {
                Text("Enabled")
                Text("Disabled entries never enter the context.")
            }
            Toggle(isOn: $draft.alwaysActive) {
                Text("Always Active")
                Text("Stays in the context without a key match.")
            }
            LorebookPriorityControl(priority: $draft.priority)
        } header: {
            Text("Activation")
        } footer: {
            Text("Higher priority survives context trimming longer.")
        }
        .onAppear(perform: focusNameIfAsked)
    }

    private func focusNameIfAsked() {
        if focusesName { isNameFocused = true }
    }
}
