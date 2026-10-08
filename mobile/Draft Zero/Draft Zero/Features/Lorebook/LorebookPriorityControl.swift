import SwiftUI

/// Priority from 0 to 100 in steps of five, as the web's slider moves, with the value shown.
struct LorebookPriorityControl: View {
    @Binding var priority: Int

    @State private var value: Double

    init(priority: Binding<Int>) {
        _priority = priority
        _value = State(initialValue: Double(priority.wrappedValue))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent("Priority") {
                Text(priority, format: .number)
                    .monospacedDigit()
                    .contentTransition(.numericText(value: Double(priority)))
            }
            Slider(value: $value, in: 0...100, step: 5) {
                Text("Priority")
            } minimumValueLabel: {
                Text("0")
            } maximumValueLabel: {
                Text("100")
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .accessibilityValue(Text(priority, format: .number))
        }
        .onChange(of: value) { _, newValue in
            let rounded = Int(newValue.rounded())
            if rounded != priority { priority = rounded }
        }
        .onChange(of: priority) { _, newValue in
            if Int(value.rounded()) != newValue { value = Double(newValue) }
        }
    }
}
