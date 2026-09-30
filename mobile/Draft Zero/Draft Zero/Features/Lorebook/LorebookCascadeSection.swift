import SwiftUI

/// The entries this one pulls into the context with it, because its content
/// names their keys. Hidden when it names none.
struct LorebookCascadeSection: View {
    let entries: [LorebookEntry]

    var body: some View {
        if !entries.isEmpty {
            Section {
                ForEach(entries) { entry in
                    Label(entry.name, systemImage: entry.category.systemImage)
                }
            } header: {
                Text("Brings In")
            } footer: {
                Text("Their keys appear in this entry's content, so they join the context with it.")
            }
        }
    }
}
