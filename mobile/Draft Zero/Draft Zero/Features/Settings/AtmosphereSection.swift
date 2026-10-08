import SwiftUI

/// What picks a story's tint after a turn. Two engines with different knobs:
/// a language model answers in prose and needs a model, temperature and cap; a
/// decision model answers with probabilities and needs only a threshold. The
/// language model's settings survive a visit to the other engine.
struct AtmosphereSection: View {
    @Bindable var editor: AutosavedValue<AppSettings.Atmosphere>
    let models: [OpenRouterModel]
    let requireZdr: Bool
    let policies: AccountZdrPolicies

    @State private var endpoints = ModelEndpointsLoader()

    var body: some View {
        Section {
            Picker("Engine", selection: $editor.value.engine) {
                ForEach(AppSettings.Atmosphere.Engine.allCases) { engine in
                    Text(engine.label).tag(engine)
                }
            }
            .pickerStyle(.segmented)
            .listRowSeparator(.hidden, edges: .bottom)

            switch editor.value.engine {
            case .llm:
                ModelChoiceRows(
                    models: models,
                    modelId: editor.value.modelId,
                    defaultOption: BuiltInModels.atmosphereOption,
                    providerTag: editor.value.providerTag,
                    thinking: $editor.value.thinking,
                    zdr: $editor.value.zdr,
                    requireZdr: requireZdr,
                    policies: policies,
                    endpoints: endpoints,
                    onModelChange: chooseModel,
                    onProviderChange: chooseProvider
                )
                SettingSlider(
                    "Temperature",
                    value: $editor.value.temperature,
                    in: GenerationLimits.temperatureRange,
                    step: 0.01,
                    hint: "Low is right: there are eight answers and a shrug, and warmth only makes the shrug rarer."
                )
                SettingSlider(
                    "Max tokens",
                    value: $editor.value.maxTokens,
                    in: 64...8192,
                    step: 64,
                    hint: "A ceiling, not a spend: the answer is one word, and the rest is room for a model that thinks first."
                )
            case .decision:
                Text("Answers with a probability instead of a sentence, in about a tenth of the time and for a fraction of the price. There is nothing to sample, so there is no model, temperature or output cap to set.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                SettingSlider(
                    "Confidence to repaint",
                    value: $editor.value.minConfidence,
                    in: 0.5...0.95,
                    step: 0.01,
                    readout: SliderReadout.fractionPercent,
                    hint: "How sure it must be before changing a colour you are reading in. A story with no colour yet is always given one."
                )
                ZdrToggle(
                    isOn: $editor.value.zdr,
                    lock: ZdrLock.resolve(
                        accountEnforced: policies.enforces(modelId: BuiltInModels.atmosphereDecision),
                        requireZdr: requireZdr
                    ),
                    hint: "The manuscript tail goes on the wire either way."
                )
            }

            SettingSlider(
                "Passages between checks",
                value: $editor.value.passagesBetweenChecks,
                in: 1...20,
                readout: { $0 == 1 ? "Every passage" : "Every \(Int($0.rounded()))" },
                hint: "How much has to happen before it looks again."
            )
        } header: {
            Text("Atmosphere")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text("After a turn, this reads the end of the manuscript and picks the colour the story is read in, or says the scene hasn't moved. Stories with a tint set by hand are left alone.")
                SaveErrorLabel(message: editor.error)
            }
        }
    }

    private func chooseModel(_ modelId: String?) {
        editor.value.chooseModel(modelId, in: models)
    }

    private func chooseProvider(_ tag: String?) {
        editor.value.providerTag = tag
    }
}
