import Foundation

/// The sheets the Prompt segment opens.
enum InspectorPromptSheet: String, Identifiable {
    case summary
    case narrator

    var id: String { rawValue }
}
