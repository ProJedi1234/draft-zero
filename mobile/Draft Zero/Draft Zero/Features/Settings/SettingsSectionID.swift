import Foundation

/// Stable ids for the form's sections, so a launch hook can scroll to one.
enum SettingsSectionID: String, CaseIterable {
    case server
    case openRouter
    case profiles
    case defaults
    case privacy
    case summarizer
    case atmosphere
    case images
    case about
}
