import Foundation

/// The context-window ladder as slider stops: the thumb moves over indices
/// while the stored value is the token count at that index.
nonisolated enum ContextLadder {
    /// The highest stop a model with this window can use; zero means unknown, so the whole ladder.
    static func maxIndex(contextLength: Int) -> Int {
        let ceiling = GenerationLimits.clampContextWindow(GenerationLimits.contextWindows.last ?? 0, contextLength: contextLength)
        return GenerationLimits.contextWindows.firstIndex(of: ceiling) ?? 0
    }

    /// The stop a value sits on; an off-ladder value reads as the default stop.
    static func index(of tokens: Int, contextLength: Int) -> Int {
        let windows = GenerationLimits.contextWindows
        let found = windows.firstIndex(of: tokens) ?? windows.firstIndex(of: GenerationLimits.defaultContextWindow) ?? 0
        return min(found, maxIndex(contextLength: contextLength))
    }

    static func tokens(atIndex index: Int) -> Int {
        let windows = GenerationLimits.contextWindows
        return windows[min(max(index, 0), windows.count - 1)]
    }

    /// True when the model's window cuts the ladder short.
    static func isLimited(contextLength: Int) -> Bool {
        maxIndex(contextLength: contextLength) < GenerationLimits.contextWindows.count - 1
    }
}
