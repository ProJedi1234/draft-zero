import SwiftUI

/// Auto plus every endpoint serving the model, with the numbers the choice
/// turns on. Under zero data retention the endpoints that retain prompts stay
/// listed at the bottom, greyed, so a missing provider explains itself.
struct ProviderPickerSheet: View {
    let endpoints: [ModelEndpoint]
    let selection: String?
    let zdr: Bool
    let onSelect: (String?) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let split = EndpointRouting.partition(endpoints, zdr: zdr)

        NavigationStack {
            List {
                Section {
                    AutoProviderRow(
                        allowed: split.allowed,
                        isSelected: EndpointRouting.routableEndpoint(endpoints, tag: selection, zdr: zdr) == nil,
                        onSelect: { choose(nil) }
                    )
                } footer: {
                    Text("OpenRouter's own ranking, weighing price, speed and uptime. A pinned provider is used alone, with no fallback.")
                }
                if split.allowed.isEmpty {
                    Section {
                        Text("No provider serving this model keeps nothing. Pick another model, or turn off zero data retention.")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section("Providers") {
                        ForEach(split.allowed) { endpoint in
                            EndpointListRow(endpoint: endpoint, isSelected: endpoint.tag == selection, isBlocked: false) {
                                choose(endpoint.tag)
                            }
                        }
                    }
                }
                if !split.blocked.isEmpty {
                    Section("Retains prompts") {
                        ForEach(split.blocked) { endpoint in
                            EndpointListRow(endpoint: endpoint, isSelected: false, isBlocked: true) {}
                        }
                    }
                }
            }
            .navigationTitle("Provider")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel, action: close)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func choose(_ tag: String?) {
        if tag != selection { onSelect(tag) }
        dismiss()
    }

    private func close() {
        dismiss()
    }
}
