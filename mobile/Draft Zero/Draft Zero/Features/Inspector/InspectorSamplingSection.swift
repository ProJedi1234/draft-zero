import SwiftUI

/// The six sliders of a Custom story, each saved on its own once it settles.
struct InspectorSamplingSection: View {
    let settings: StoryModelSettings

    var body: some View {
        Section {
            SettingSlider(
                "Temperature",
                value: Bindable(settings.temperature).value,
                in: GenerationLimits.temperatureRange,
                step: 0.01
            )
            SettingSlider(
                "Top P",
                value: Bindable(settings.topP).value,
                in: GenerationLimits.topPRange,
                step: 0.01
            )
            ContextWindowLadder(
                value: Bindable(settings.contextWindow).value,
                contextLength: settings.contextLength
            )
            SettingSlider(
                "Lore budget",
                value: Bindable(settings.loreBudget).value,
                in: GenerationLimits.loreBudgetRange,
                step: GenerationLimits.loreBudgetStep,
                readout: SliderReadout.percent,
                hint: "How much of the free context the lorebook may claim."
            )
            SettingSlider(
                "Frequency penalty",
                value: Bindable(settings.frequencyPenalty).value,
                in: GenerationLimits.penaltyRange,
                step: 0.1
            )
            SettingSlider(
                "Presence penalty",
                value: Bindable(settings.presencePenalty).value,
                in: GenerationLimits.penaltyRange,
                step: 0.1
            )
        } header: {
            Text("Generation")
        }
    }
}
