import SwiftUI

/// The rows every bundle of generation settings shares: the model, the
/// endpoint serving it, how hard it thinks, and whether it may retain anything.
/// Rows only, so a caller puts them in whichever `Section` it owns.
///
/// The bundle's own retention flag governs the model list; the account's
/// enforcement for the chosen model's group also governs the provider list,
/// because it is per group and does not travel with the bundle.
struct ModelChoiceRows: View {
    let models: [OpenRouterModel]
    /// The chosen model, or nil to follow `defaultOption`.
    let modelId: String?
    var defaultOption: ModelDefaultOption?
    let providerTag: String?
    @Binding var thinking: ThinkingLevel
    /// The bundle's own flag; the toggle writes it.
    @Binding var zdr: Bool
    /// The app-wide floor, which the bundle can add to but not lower.
    let requireZdr: Bool
    let policies: AccountZdrPolicies
    let endpoints: ModelEndpointsLoader
    var zdrHint = "Only providers that keep nothing."
    let onModelChange: (String?) -> Void
    let onProviderChange: (String?) -> Void

    private var resolvedId: String {
        modelId ?? defaultOption?.modelId ?? ""
    }

    var body: some View {
        let accountEnforced = policies.enforces(modelId: resolvedId)
        let bundleZdr = zdr || requireZdr
        let model = models.first { $0.id == resolvedId }

        if let defaultOption {
            ModelPickerRow(
                models: models,
                selection: modelId,
                defaultOption: defaultOption,
                zdr: bundleZdr,
                onSelect: onModelChange
            )
        } else {
            ModelPickerRow(models: models, selection: resolvedId, zdr: bundleZdr) { onModelChange($0) }
        }
        ProviderPickerRow(
            modelId: resolvedId,
            models: models,
            selection: providerTag,
            zdr: bundleZdr || accountEnforced,
            endpoints: endpoints,
            onSelect: onProviderChange
        )
        ThinkingPicker(reasoning: model?.reasoning, selection: $thinking)
        ZdrToggle(
            isOn: $zdr,
            lock: ZdrLock.resolve(accountEnforced: accountEnforced, requireZdr: requireZdr),
            hint: zdrHint
        )
    }
}
