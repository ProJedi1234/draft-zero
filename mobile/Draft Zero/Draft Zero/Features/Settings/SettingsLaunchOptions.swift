import Foundation

/// Simulator hooks, like AppModel's: `-settingsScrollTo summarizer` scrolls the
/// form to a section once it loads, and `-settingsEditProfile <id>` (or `new`)
/// opens the profile editor, so a command-line run can reach any part of it.
enum SettingsLaunchOptions {
    static var scrollTarget: SettingsSectionID? {
        #if DEBUG
        UserDefaults.standard.string(forKey: "settingsScrollTo").flatMap(SettingsSectionID.init(rawValue:))
        #else
        nil
        #endif
    }

    static var editProfile: String? {
        #if DEBUG
        UserDefaults.standard.string(forKey: "settingsEditProfile")
        #else
        nil
        #endif
    }
}
