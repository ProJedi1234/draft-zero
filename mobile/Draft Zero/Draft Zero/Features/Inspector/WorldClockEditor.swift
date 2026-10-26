import SwiftUI

struct WorldClockEditor: View {
    private enum Field { case day, time }
    let minutes: Int
    @Bindable var controls: WorldClockControls
    let isKeyboardUp: Bool

    @FocusState private var focusedField: Field?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Clock").font(.subheadline)
            Text(WorldClock.label(minutes)).monospacedDigit()
            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading) {
                    Text("Day").font(.caption)
                    TextField("Day", value: $controls.dayValue, format: .number.grouping(.never))
                        .keyboardType(.numberPad)
                        .focused($focusedField, equals: .day)
                        .accessibilityLabel("Day")
                }
                VStack(alignment: .leading) {
                    Text("Time").font(.caption)
                    TextField("Time", text: $controls.timeValue, prompt: Text("HH:mm"))
                        .keyboardType(.numbersAndPunctuation)
                        .autocorrectionDisabled()
                        .focused($focusedField, equals: .time)
                        .accessibilityLabel("Time")
                }
            }
            .monospacedDigit()
            .disabled(controls.isSaving)
            Button("Set clock", action: save)
                .buttonStyle(.bordered)
                .disabled(controls.isSaving || controls.absoluteMinutes == nil)
        }
        .onChange(of: focusedField != nil || isKeyboardUp) {
            controls.setFocused(focusedField != nil || isKeyboardUp)
        }
        .onDisappear { controls.setFocused(false) }
    }

    private func save() {
        focusedField = nil
        Task { await controls.save() }
    }
}
