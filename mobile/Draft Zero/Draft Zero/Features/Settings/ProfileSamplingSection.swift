import SwiftUI

/// The six sliders of a profile, each following the Generation defaults
/// until the writer moves it.
struct ProfileSamplingSection: View {
    @Binding var settings: ProfileSettings
    let defaults: GenerationDefaults
    /// The chosen route's window, which caps the context ladder.
    let contextLength: Int

    var body: some View {
        Section {
            SettingSlider(
                "Temperature",
                override: $settings.temperature,
                fallback: defaults.temperature,
                in: GenerationLimits.temperatureRange,
                step: 0.01
            )
            SettingSlider(
                "Top P",
                override: $settings.topP,
                fallback: defaults.topP,
                in: GenerationLimits.topPRange,
                step: 0.01
            )
            ContextWindowLadder(
                override: $settings.contextWindow,
                fallback: defaults.contextWindow,
                contextLength: contextLength
            )
            SettingSlider(
                "Lore budget",
                override: $settings.loreBudget,
                fallback: defaults.loreBudget,
                in: GenerationLimits.loreBudgetRange,
                step: GenerationLimits.loreBudgetStep,
                readout: SliderReadout.percent
            )
            SettingSlider(
                "Frequency penalty",
                override: $settings.frequencyPenalty,
                fallback: defaults.frequencyPenalty,
                in: GenerationLimits.penaltyRange,
                step: 0.1
            )
            SettingSlider(
                "Presence penalty",
                override: $settings.presencePenalty,
                fallback: defaults.presencePenalty,
                in: GenerationLimits.penaltyRange,
                step: 0.1
            )
        } header: {
            Text("Sampling")
        } footer: {
            Text("Values marked Default follow Generation defaults in Settings. Move one to give this profile its own; Reset hands it back.")
        }
    }
}
