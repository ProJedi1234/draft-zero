import Testing
@testable import Draft_Zero

struct ManuscriptItemTests {
    private func entry(_ source: StoryEntry.Source, _ index: Int) -> ManuscriptItem {
        .entry(StoryEntry(
            id: "e\(index)", position: index, source: source, text: "", actionKind: nil, inputText: nil,
            variantGroupId: "g\(index)", variantIndex: 0, variantCount: 1, variantProfilesMixed: false,
            generation: nil, costUsd: nil, reasoningTokens: nil, callStatus: nil, createdAt: ""
        ))
    }

    @Test func aMoveOpensATurnAndItsReplyStaysWithIt() {
        #expect(entry(.user, 2).startsTurn(after: entry(.generated, 0)))
        #expect(!entry(.generated, 4).startsTurn(after: entry(.user, 2)))
    }

    @Test func anUnpromptedPassageOpensATurn() {
        #expect(entry(.generated, 2).startsTurn(after: entry(.generated, 0)))
    }

    @Test func theFirstPassageNeedsNoBreak() {
        #expect(!entry(.user, 0).startsTurn(after: nil))
        #expect(!entry(.generated, 0).startsTurn(after: nil))
    }
}
