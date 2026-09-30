import Foundation

/// One placeholder's form field: what the scenario declared, and what the
/// writer has typed so far. Starts at the declared default, as the web does.
struct PlaceholderField: Identifiable, Hashable {
    var placeholder: ScenarioPlaceholder
    var value: String

    var id: String { placeholder.id }

    /// The field's label: its declared title, or its id when it has none.
    var label: String {
        placeholder.title.isEmpty ? placeholder.id : placeholder.title
    }

    init(_ placeholder: ScenarioPlaceholder) {
        self.placeholder = placeholder
        value = placeholder.defaultValue
    }
}
