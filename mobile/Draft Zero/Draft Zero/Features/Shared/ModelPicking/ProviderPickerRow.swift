import SwiftUI

/// Which upstream endpoint serves the chosen model, with the price and window
/// of whatever will actually serve the request underneath. Loads the model's
/// endpoints itself; nil is Auto, OpenRouter's own ranking.
struct ProviderPickerRow: View {
    let modelId: String
    let models: [OpenRouterModel]
    /// The pinned endpoint tag, or nil for Auto.
    let selection: String?
    /// The policy the request is routed under, account enforcement included.
    let zdr: Bool
    let endpoints: ModelEndpointsLoader
    let onSelect: (String?) -> Void

    @Environment(AppModel.self) private var app
    @State private var isPresented = false

    var body: some View {
        let list = endpoints.endpoints(for: modelId)
        let loaded = endpoints.hasLoaded(modelId)
        let routed = EndpointRouting.routableEndpoint(list, tag: selection, zdr: zdr)

        Group {
            if loaded && list.isEmpty {
                PickerRowLabel(title: "Provider", value: "Auto", detail: pricing, showsChevron: false)
                    .accessibilityElement(children: .combine)
            } else {
                Button(action: present) {
                    PickerRowLabel(
                        title: "Provider",
                        value: routed.map { Self.label($0).text } ?? "Auto",
                        spokenValue: routed.map { Self.label($0).spoken },
                        detail: pricing,
                        isLoading: !loaded
                    )
                }
                .tint(.primary)
                .disabled(!loaded)
                .accessibilityHint("Opens the providers serving this model.")
            }
        }
        .sheet(isPresented: $isPresented) {
            ProviderPickerSheet(endpoints: list, selection: selection, zdr: zdr, onSelect: onSelect)
        }
        .task(id: modelId) {
            await endpoints.load(modelId, api: app.api)
        }
    }

    /// Priced against the routed endpoint when pinned, the model's own under Auto.
    private var pricing: String? {
        let model = models.first { $0.id == modelId }
        let routed = EndpointRouting.routableEndpoint(endpoints.endpoints(for: modelId), tag: selection, zdr: zdr)
        guard let prices = routed?.pricing ?? model?.pricing,
              let window = routed?.contextLength ?? model?.contextLength else { return nil }
        return SettingsSummary.pricing(prices, contextLength: window, maxCompletionTokens: model?.maxCompletionTokens)
    }

    /// "Google 🇪🇺", spoken "Google, Europe", so two pins on one provider read differently.
    nonisolated private static func label(_ endpoint: ModelEndpoint) -> (text: String, spoken: String) {
        guard let variant = Format.endpointVariant(endpoint.tag, quantization: endpoint.quantization) else {
            return (endpoint.providerName, endpoint.providerName)
        }
        return ("\(endpoint.providerName) \(variant.text)", "\(endpoint.providerName), \(variant.label)")
    }

    private func present() {
        isPresented = true
    }
}
