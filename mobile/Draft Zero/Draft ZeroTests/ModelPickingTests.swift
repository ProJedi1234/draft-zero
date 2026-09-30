import Foundation
import Testing
@testable import Draft_Zero

/// The shared picker rules: ZDR groups and routing, catalog grouping and
/// search, thinking coupling, the summary line, and slider arithmetic.
struct ModelPickingTests {
    private func catalog() throws -> [OpenRouterModel] {
        try FixtureLoader.decode(SettingsPayload.self, from: "settings.json").models
    }

    private func endpoint(_ tag: String, zdr: Bool, context: Int = 131_072, throughput: Double? = nil) -> ModelEndpoint {
        ModelEndpoint(
            tag: tag,
            providerName: tag.capitalized,
            contextLength: context,
            pricing: .init(prompt: "$1.00", completion: "$2.00"),
            throughput: throughput,
            uptime: 0.99,
            quantization: nil,
            zdr: zdr
        )
    }

    // MARK: - ZDR

    @Test(arguments: [
        ("~anthropic/claude-sonnet-latest", ZdrGroup.anthropic),
        ("openai/gpt-5", .openai),
        ("~google/gemini-pro-latest", .google),
        ("~x-ai/grok-latest", .xai),
        ("x-ai/grok-4", .xai),
        ("~moonshotai/kimi-latest", .other),
        ("typesafe/jev-1.13", .other),
        ("", .other),
    ])
    func zdrGroupFollowsTheAuthor(modelId: String, group: ZdrGroup) {
        #expect(ZdrGroup(modelId: modelId) == group)
    }

    @Test func accountPoliciesListEnforcedGroupsInOpenRoutersOrder() {
        #expect(AccountZdrPolicies.unknown.enforcedGroupList == "")
        #expect(!AccountZdrPolicies.unknown.enforcesAll)

        let one = AccountZdrPolicies(["openai": .enforced, "anthropic": .notEnforced])
        #expect(one.enforcedGroupList == "OpenAI")
        #expect(one.enforces(modelId: "~openai/gpt-latest"))
        #expect(!one.enforces(modelId: "~anthropic/claude-sonnet-latest"))

        let two = AccountZdrPolicies(["openai": .enforced, "anthropic": .enforced])
        #expect(two.enforcedGroupList == "Anthropic and OpenAI")

        let three = AccountZdrPolicies(["other": .enforced, "openai": .enforced, "anthropic": .enforced, "mystery": .enforced])
        #expect(three.enforcedGroupList == "Anthropic, OpenAI and other providers")
        #expect(!three.enforcesAll)

        let all = AccountZdrPolicies(Dictionary(uniqueKeysWithValues: ZdrGroup.allCases.map { ($0.rawValue, AccountZdrPolicy.enforced) }))
        #expect(all.enforcesAll)
    }

    @Test func zdrLockPrefersTheAccount() {
        #expect(ZdrLock.resolve(accountEnforced: true, requireZdr: true) == .account)
        #expect(ZdrLock.resolve(accountEnforced: false, requireZdr: true) == .app)
        #expect(ZdrLock.resolve(accountEnforced: false, requireZdr: false) == nil)
    }

    @Test func routingDropsPinsThatCannotBeHonoured() {
        let endpoints = [endpoint("groq", zdr: true, context: 65_536), endpoint("novita", zdr: false)]
        #expect(EndpointRouting.routableEndpoint(endpoints, tag: nil, zdr: false) == nil)
        #expect(EndpointRouting.routableEndpoint(endpoints, tag: "gone", zdr: false) == nil)
        #expect(EndpointRouting.routableEndpoint(endpoints, tag: "novita", zdr: false)?.tag == "novita")
        #expect(EndpointRouting.routableEndpoint(endpoints, tag: "novita", zdr: true) == nil)
        #expect(EndpointRouting.routableEndpoint(endpoints, tag: "groq", zdr: true)?.tag == "groq")

        let open = EndpointRouting.partition(endpoints, zdr: false)
        #expect(open.allowed.count == 2 && open.blocked.isEmpty)
        let strict = EndpointRouting.partition(endpoints, zdr: true)
        #expect(strict.allowed.map(\.tag) == ["groq"])
        #expect(strict.blocked.map(\.tag) == ["novita"])
    }

    @Test func contextLengthPrefersThePinnedEndpoint() throws {
        let model = try #require(try catalog().first { $0.id == "~moonshotai/kimi-latest" })
        let endpoints = [endpoint("groq", zdr: true, context: 65_536)]
        #expect(EndpointRouting.contextLength(endpoints: endpoints, tag: "groq", zdr: false, model: model) == 65_536)
        #expect(EndpointRouting.contextLength(endpoints: endpoints, tag: nil, zdr: false, model: model) == 1_048_576)
        #expect(EndpointRouting.contextLength(endpoints: [], tag: nil, zdr: false, model: nil) == 0)
    }

    @Test func fastestThroughputIgnoresUnmeasuredEndpoints() {
        let endpoints = [endpoint("a", zdr: true, throughput: 97), endpoint("b", zdr: true), endpoint("c", zdr: true, throughput: 812)]
        #expect(EndpointRouting.fastestThroughput(endpoints) == 812)
        #expect(EndpointRouting.fastestThroughput([endpoint("d", zdr: true)]) == nil)
    }

    // MARK: - Catalog

    @Test func groupingKeepsTheCatalogOrder() throws {
        let groups = ModelCatalog.groupByProvider(try catalog())
        #expect(groups.map(\.provider) == ["Anthropic", "OpenAI", "Google", "xAI", "MoonshotAI", "DeepSeek"])
        #expect(groups[0].entries.map(\.name) == ["Claude Sonnet Latest", "Claude Opus Latest", "Claude Haiku Latest"])
    }

    @Test func zdrPartitionKeepsBlockedModels() throws {
        let models = try catalog()
        let split = ModelCatalog.partition(models, zdr: true)
        #expect(split.blocked.map(\.id) == ["~moonshotai/kimi-latest", "~deepseek/deepseek-v4-flash-latest"])
        #expect(split.allowed.count + split.blocked.count == models.count)
        #expect(ModelCatalog.partition(models, zdr: false).blocked.isEmpty)
    }

    @Test func searchMatchesNamesLabsAndAliasTargets() throws {
        let models = try catalog()
        #expect(ModelCatalog.filter(models, query: "sonnet").map(\.id) == ["~anthropic/claude-sonnet-latest"])
        #expect(ModelCatalog.filter(models, query: "claude-sonnet-5").map(\.id) == ["~anthropic/claude-sonnet-latest"])
        #expect(ModelCatalog.filter(models, query: "GOOGLE").count == 2)
        #expect(ModelCatalog.filter(models, query: "  ").count == models.count)
        #expect(ModelCatalog.filter(models, query: "nothing-like-this").isEmpty)
    }

    @Test func modelChangeKeepsOnlyOfferedThinkingLevels() throws {
        let models = try catalog()
        let haiku = models.first { $0.id == "~anthropic/claude-haiku-latest" }?.reasoning
        let sonnet = models.first { $0.id == "~anthropic/claude-sonnet-latest" }?.reasoning
        #expect(ModelCatalog.levelForModel(haiku, current: .minimal) == .minimal)
        #expect(ModelCatalog.levelForModel(sonnet, current: .minimal) == .off)
        #expect(ModelCatalog.levelForModel(sonnet, current: .high) == .high)
        #expect(ModelCatalog.levelForModel(nil, current: .high) == .off)
    }

    @Test func thinkingOptionsOfferOffPlusTheModelsEfforts() throws {
        let gemini = try #require(try catalog().first { $0.id == "~google/gemini-pro-latest" }?.reasoning)
        #expect(ModelCatalog.thinkingOptions(gemini, current: .off) == [.off, .low, .medium, .high])
        #expect(ModelCatalog.thinkingOptions(gemini, current: .max) == [.off, .low, .medium, .high, .max])
        #expect(ModelCatalog.thinkingOptions(nil, current: .off) == [.off])
    }

    @Test func imageFallbackResolvesUnderThePolicy() throws {
        let images = try FixtureLoader.decode(SettingsPayload.self, from: "settings.json").imageModels
        #expect(ImageModelFallback.catalog.resolve(in: images, zdr: false) == "black-forest-labs/flux-1.1-pro")
        #expect(ImageModelFallback.catalog.resolve(in: images, zdr: true) == "bytedance-seed/seedream-4.5")
        #expect(ImageModelFallback.appDefault("openai/gpt-image-1").resolve(in: images, zdr: true) == "openai/gpt-image-1")
        #expect(ImageModelFallback.appDefault(nil).resolve(in: images, zdr: true) == "bytedance-seed/seedream-4.5")
        #expect(ImageModelFallback.catalog.resolve(in: [], zdr: false) == nil)
    }

    // MARK: - Summary line

    @Test func summaryMatchesTheWebLine() throws {
        let models = try catalog()
        #expect(
            SettingsSummary.line(modelId: "~anthropic/claude-sonnet-latest", providerTag: nil, thinking: .off, models: models)
                == "Claude Sonnet Latest · Auto · off"
        )
        #expect(
            SettingsSummary.line(modelId: "~anthropic/claude-opus-latest", providerTag: "anthropic", thinking: .xhigh, models: models)
                == "Claude Opus Latest · anthropic · think extra high"
        )
        #expect(
            SettingsSummary.lineWithPrice(modelId: "~anthropic/claude-sonnet-latest", providerTag: nil, thinking: .medium, models: models)
                == "Claude Sonnet Latest · Auto · think medium · $2.00/$10.00"
        )
    }

    @Test func summaryOfAnUnknownModelFallsBackToItsId() {
        #expect(
            SettingsSummary.lineWithPrice(modelId: "retired/model", providerTag: nil, thinking: .low, models: [])
                == "retired/model · Auto · think low"
        )
    }

    @Test func pricingLineNamesWindowAndOutputCeiling() {
        let prices = OpenRouterModel.Pricing(prompt: "$2.00", completion: "$10.00")
        #expect(
            SettingsSummary.pricing(prices, contextLength: 1_000_000, maxCompletionTokens: 65_536)
                == "In $2.00 · Out $10.00 per 1M · 1M context · up to 66K out"
        )
        #expect(SettingsSummary.pricing(prices, contextLength: 131_072, maxCompletionTokens: nil) == "In $2.00 · Out $10.00 per 1M · 131K context")
    }

    // MARK: - Sliders

    @Test func snappingLandsOnTheGridWithoutNoise() {
        #expect(SliderReadout.snap(0.9000000000000001, step: 0.01, in: 0...2) == 0.9)
        #expect(SliderReadout.snap(0.17, step: 0.1, in: -2...2) == 0.2)
        #expect(SliderReadout.snap(0.12, step: 0.1, in: -2...2) == 0.1)
        #expect(SliderReadout.snap(-1.9000000000000001, step: 0.1, in: -2...2) == -1.9)
        #expect(SliderReadout.snap(27, step: 5, in: 0...50) == 25)
        #expect(SliderReadout.snap(99, step: 5, in: 0...50) == 50)
        #expect(SliderReadout.snap(130, step: 64, in: 64...8192) == 128)
        #expect(SliderReadout.snap(0.613, step: 0.01, in: 0.5...0.95) == 0.61)
    }

    @Test func readoutsMatchTheWeb() {
        #expect(SliderReadout.number(0.9, step: 0.01) == "0.90")
        #expect(SliderReadout.number(-0.1, step: 0.1) == "-0.10")
        #expect(SliderReadout.number(2048, step: 64) == "2,048")
        #expect(SliderReadout.percent(25) == "25%")
        #expect(SliderReadout.fractionPercent(0.6) == "60%")
    }

    @Test func ladderStopsAtTheModelsWindow() {
        #expect(ContextLadder.maxIndex(contextLength: 0) == 9)
        #expect(ContextLadder.maxIndex(contextLength: 1_000_000) == 9)
        #expect(ContextLadder.maxIndex(contextLength: 8192) == 3)
        #expect(ContextLadder.maxIndex(contextLength: 5000) == 1)
        #expect(ContextLadder.maxIndex(contextLength: 1000) == 0)
        #expect(ContextLadder.index(of: 32_768, contextLength: 0) == 7)
        #expect(ContextLadder.index(of: 32_768, contextLength: 8192) == 3)
        #expect(ContextLadder.index(of: 5000, contextLength: 0) == 3)
        #expect(ContextLadder.tokens(atIndex: 9) == 131_072)
        #expect(ContextLadder.tokens(atIndex: 42) == 131_072)
        #expect(ContextLadder.isLimited(contextLength: 65_536))
        #expect(!ContextLadder.isLimited(contextLength: 0))
    }
}
