import Foundation

/// One editable field of a lorebook entry: the unit of dirty tracking, remote
/// adoption and PATCH bodies, so a save only ever sends what the writer touched.
nonisolated enum LorebookField: String, CaseIterable, Sendable {
    case name, category, keys, content, enabled, alwaysActive, priority

    /// Typing waits for a pause; switches and pickers save at once.
    var saveDelay: Duration {
        switch self {
        case .name, .keys, .content: .milliseconds(600)
        case .priority: .milliseconds(400)
        case .category, .enabled, .alwaysActive: .zero
        }
    }

    /// A failed save rolls these back so the screen shows what the server holds.
    /// Typed text is kept instead, so a retry can still send it.
    var revertsOnFailure: Bool {
        switch self {
        case .category, .enabled, .alwaysActive, .priority: true
        case .name, .keys, .content: false
        }
    }

    func value(in draft: NewLorebookEntry) -> JSONValue {
        switch self {
        case .name: .string(draft.name.trimmingCharacters(in: .whitespacesAndNewlines))
        case .category: .string(draft.category.rawValue)
        case .keys: .array(draft.keys.map(JSONValue.string))
        case .content: .string(draft.content)
        case .enabled: .bool(draft.enabled)
        case .alwaysActive: .bool(draft.alwaysActive)
        case .priority: .number(Double(draft.priority))
        }
    }

    /// Copies this field's value from a server row into a draft.
    func copy(from entry: LorebookEntry, into draft: inout NewLorebookEntry) {
        switch self {
        case .name: draft.name = entry.name
        case .category: draft.category = entry.category
        case .keys: draft.keys = entry.keys
        case .content: draft.content = entry.content
        case .enabled: draft.enabled = entry.enabled
        case .alwaysActive: draft.alwaysActive = entry.alwaysActive
        case .priority: draft.priority = entry.priority
        }
    }

    /// The fields whose raw values differ; a trailing space counts, so typing is tracked exactly.
    static func changed(from old: NewLorebookEntry, to new: NewLorebookEntry) -> Set<LorebookField> {
        var fields: Set<LorebookField> = []
        if old.name != new.name { fields.insert(.name) }
        if old.category != new.category { fields.insert(.category) }
        if old.keys != new.keys { fields.insert(.keys) }
        if old.content != new.content { fields.insert(.content) }
        if old.enabled != new.enabled { fields.insert(.enabled) }
        if old.alwaysActive != new.alwaysActive { fields.insert(.alwaysActive) }
        if old.priority != new.priority { fields.insert(.priority) }
        return fields
    }

    /// The fields a newer server row moved relative to an older one.
    static func changed(from old: LorebookEntry, to new: LorebookEntry) -> Set<LorebookField> {
        changed(from: NewLorebookEntry(entry: old), to: NewLorebookEntry(entry: new))
    }

    /// A PATCH body carrying only these fields.
    static func patch(_ fields: Set<LorebookField>, from draft: NewLorebookEntry) -> JSONObject {
        var body: JSONObject = [:]
        for field in fields {
            body[field.rawValue] = field.value(in: draft)
        }
        return body
    }
}
