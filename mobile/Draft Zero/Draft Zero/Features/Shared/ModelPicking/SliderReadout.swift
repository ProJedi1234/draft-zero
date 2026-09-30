import Foundation

/// Readouts and snapping for setting sliders, matching the web's formatting.
nonisolated enum SliderReadout {
    /// Two decimals for fractional steps, whole numbers otherwise: "0.90", "2,048".
    static func number(_ value: Double, step: Double) -> String {
        step < 1 ? value.formatted(fixed: 2) : Int(value.rounded()).formatted()
    }

    /// A value already in percent: 25 → "25%".
    static func percent(_ value: Double) -> String {
        "\(Int(value.rounded()))%"
    }

    /// A fraction shown as a percent: 0.6 → "60%".
    static func fractionPercent(_ value: Double) -> String {
        "\(Int((value * 100).rounded()))%"
    }

    /// Clamps to the range and lands on the step grid without binary noise,
    /// so 0.9 is sent as 0.9 and not 0.9000000000000001.
    static func snap(_ value: Double, step: Double, in range: ClosedRange<Double>) -> Double {
        guard value.isFinite, step > 0 else { return min(max(value, range.lowerBound), range.upperBound) }
        let clamped = min(max(value, range.lowerBound), range.upperBound)
        let steps = ((clamped - range.lowerBound) / step).rounded()
        let snapped = range.lowerBound + steps * step
        let decimals = max(0, Int(-log10(step).rounded(.up)))
        let scale = pow(10, Double(decimals))
        return min(max((snapped * scale).rounded() / scale, range.lowerBound), range.upperBound)
    }
}
