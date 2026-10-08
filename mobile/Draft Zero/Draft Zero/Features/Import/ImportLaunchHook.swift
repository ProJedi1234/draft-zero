#if DEBUG
import Foundation

/// Test hooks, since a simulator run can't drive the file picker:
/// `-importFile <path>` reads that file through the import path once the
/// library appears, and `-importCommit YES` presses Import for you.
enum ImportLaunchHook {
    private static var fileTaken = false

    static func takeFile() -> URL? {
        guard !fileTaken, let path = UserDefaults.standard.string(forKey: "importFile") else { return nil }
        fileTaken = true
        return URL(filePath: path)
    }

    static var commitsAutomatically: Bool {
        UserDefaults.standard.bool(forKey: "importCommit")
    }
}
#endif
