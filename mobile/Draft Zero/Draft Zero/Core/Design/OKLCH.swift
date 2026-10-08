import SwiftUI

/// OKLCH to sRGB, so the native palette uses the web's exact colour recipes
/// (app/globals.css) instead of an approximation.
nonisolated enum OKLCH {
    static func color(_ lightness: Double, _ chroma: Double, _ hue: Double, opacity: Double = 1) -> Color {
        let (r, g, b) = rgb(lightness, chroma, hue)
        return Color(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }

    static func rgb(_ lightness: Double, _ chroma: Double, _ hue: Double) -> (Double, Double, Double) {
        let radians = hue * .pi / 180
        let a = chroma * cos(radians)
        let b = chroma * sin(radians)

        let l = pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3)
        let m = pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3)
        let s = pow(lightness - 0.0894841775 * a - 1.2914855480 * b, 3)

        let red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
        let green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
        let blue = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

        return (gamma(red), gamma(green), gamma(blue))
    }

    private static func gamma(_ linear: Double) -> Double {
        let clamped = min(max(linear, 0), 1)
        return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * pow(clamped, 1 / 2.4) - 0.055
    }
}
