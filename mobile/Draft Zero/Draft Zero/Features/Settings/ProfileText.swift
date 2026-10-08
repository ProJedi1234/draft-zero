import Foundation

/// The sentences the profile screens say about followers.
nonisolated enum ProfileText {
    /// "3 stories", "1 story", "No stories".
    static func followers(_ count: Int) -> String {
        switch count {
        case 0: "No stories"
        case 1: "1 story"
        default: "\(count) stories"
        }
    }

    /// The delete confirmation's second sentence.
    static func deleteConsequence(followers count: Int) -> String {
        switch count {
        case 0: "No stories follow it."
        case 1: "1 story goes Custom, keeping these settings."
        default: "\(count) stories go Custom, keeping these settings."
        }
    }

    /// The editor's warning that saving moves every follower.
    static func editConsequence(followers count: Int) -> String? {
        switch count {
        case 0: nil
        case 1: "Followed by 1 story. It updates when you save."
        default: "Followed by \(count) stories. They update when you save."
        }
    }
}
