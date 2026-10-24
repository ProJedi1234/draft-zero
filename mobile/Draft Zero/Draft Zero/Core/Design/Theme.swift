import SwiftUI

/// Shared constants, so every screen reads as one app.
enum Theme {
    /// The manuscript's reading measure; wider lines tire the eye.
    static let readingWidth: Double = 680
    /// Corner radius for cards and image frames.
    static let cornerRadius: Double = 14
    static let smallCornerRadius: Double = 8

    /// Prose is set in a serif, like the web's Source Serif.
    static let proseFont: Font = .system(.body, design: .serif)
    static let proseTitleFont: Font = .system(.title2, design: .serif)
    /// Machine text addressed to a machine: developed prompts, context dumps.
    static let machineFont: Font = .system(.footnote, design: .monospaced)

    /// The manuscript's point size at the default text size. New York at
    /// body's 17pt reads small beside SF, so the reading column sets it larger.
    static let manuscriptPointSize: Double = 19

    /// Line spacing for prose; the web sets it at 1.75.
    static let proseLineSpacing: Double = 6
    static let paragraphSpacing: Double = 20
    /// Extra space above a passage that starts a new turn.
    static let turnBreak: Double = 26

    static let quickAnimation: Animation = .snappy(duration: 0.25)
}
