import SwiftUI

/// A labelled slider with its value read out beside the name, and optionally
/// a "follows the default" state that dragging takes over.
///
/// Presentation only: it reports every movement and leaves persistence to the
/// caller, which may hold a draft or debounce saves.
struct SettingSlider: View {
    let title: String
    let value: Double
    let range: ClosedRange<Double>
    let step: Double
    let readout: (Double) -> String
    let inheritance: SettingInheritance?
    let hint: String?
    let onChange: (Double) -> Void

    /// The thumb, held locally so a value off the step grid is shown as it is
    /// and only rewritten when the writer moves it.
    @State private var position: Double

    /// A plain slider over a Double.
    init(
        _ title: String,
        value: Binding<Double>,
        in range: ClosedRange<Double>,
        step: Double,
        readout: ((Double) -> String)? = nil,
        hint: String? = nil
    ) {
        self.init(
            title: title,
            value: value.wrappedValue,
            range: range,
            step: step,
            readout: readout,
            inheritance: nil,
            hint: hint,
            onChange: { value.wrappedValue = $0 }
        )
    }

    /// A plain slider over a whole number.
    init(
        _ title: String,
        value: Binding<Int>,
        in range: ClosedRange<Int>,
        step: Int = 1,
        readout: ((Double) -> String)? = nil,
        hint: String? = nil
    ) {
        self.init(
            title: title,
            value: Double(value.wrappedValue),
            range: Double(range.lowerBound)...Double(range.upperBound),
            step: Double(step),
            readout: readout,
            inheritance: nil,
            hint: hint,
            onChange: { value.wrappedValue = Int($0.rounded()) }
        )
    }

    /// A slider whose nil follows `fallback`. Moving it stores a value; the
    /// reset button stores nil again, or runs `onRevert` when given.
    init(
        _ title: String,
        override: Binding<Double?>,
        fallback: Double,
        in range: ClosedRange<Double>,
        step: Double,
        readout: ((Double) -> String)? = nil,
        inheritedLabel: String = "Default",
        hint: String? = nil,
        onRevert: (() -> Void)? = nil
    ) {
        let inheritance: SettingInheritance = if override.wrappedValue == nil {
            .following(label: inheritedLabel)
        } else {
            .overridden(revert: onRevert ?? { override.wrappedValue = nil })
        }
        self.init(
            title: title,
            value: override.wrappedValue ?? fallback,
            range: range,
            step: step,
            readout: readout,
            inheritance: inheritance,
            hint: hint,
            onChange: { override.wrappedValue = $0 }
        )
    }

    private init(
        title: String,
        value: Double,
        range: ClosedRange<Double>,
        step: Double,
        readout: ((Double) -> String)?,
        inheritance: SettingInheritance?,
        hint: String?,
        onChange: @escaping (Double) -> Void
    ) {
        self.title = title
        self.value = value
        self.range = range
        self.step = step
        self.readout = readout ?? { SliderReadout.number($0, step: step) }
        self.inheritance = inheritance
        self.hint = hint
        self.onChange = onChange
        _position = State(initialValue: value)
    }

    var body: some View {
        let following = inheritance?.isFollowing == true

        VStack(alignment: .leading, spacing: 6) {
            LabeledContent {
                Text(readout(position))
                    .monospacedDigit()
            } label: {
                SettingTitle(title: title, inheritance: inheritance)
            }
            Group {
                // The system draws a tick per step; past a short ladder they blur
                // into a second track, so fine steps snap in code instead.
                if (range.upperBound - range.lowerBound) / step <= 20 {
                    Slider(value: $position, in: range, step: step) {
                        Text(title)
                    }
                } else {
                    Slider(value: $position, in: range) {
                        Text(title)
                    }
                }
            }
            .tint(following ? Color.secondary : nil)
            .accessibilityValue(readout(position))
            .accessibilityHint(following ? "Following the default. Adjust to set a value of its own." : "")
            if let hint {
                Text(hint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .onChange(of: value) { _, newValue in
            if position != newValue { position = newValue }
        }
        .onChange(of: position) { _, newPosition in
            guard newPosition != value else { return }
            let snapped = SliderReadout.snap(newPosition, step: step, in: range)
            if snapped != value { onChange(snapped) }
        }
    }
}
