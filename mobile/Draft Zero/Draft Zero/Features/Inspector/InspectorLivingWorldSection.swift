import SwiftUI

struct InspectorLivingWorldSection: View {
    @Bindable var controls: LivingWorldControls
    let isKeyboardUp: Bool

    var body: some View {
        Section {
            Toggle("Living world", isOn: $controls.isEnabled)
                .disabled(controls.enabled.inFlight > 0 || controls.pacing.isSaving)
        }
        if controls.isEnabled {
            InspectorProseSection(
                title: "Pacing rules", placeholder: "How time passes in this story…",
                footer: "", lines: 3...10, field: controls.pacing, isKeyboardUp: isKeyboardUp
            )
            .onChange(of: controls.pacing.value) {
                if controls.pacing.value.utf16.count > 2000 {
                    controls.pacing.value = WorldText.limited(controls.pacing.value, to: 2000)
                }
            }
        }
    }
}
