import Foundation

/// Display formatting shared with the web client (lib/format.ts), so a cost or
/// a token count reads the same on both.
nonisolated enum Format {
    /// USD with precision that scales with magnitude; nil is "—", never "$0.00".
    static func usd(_ value: String?) -> String {
        guard let value, let number = Double(value) else { return "—" }
        return usd(number)
    }

    static func usd(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        let magnitude = abs(value)
        let sign = value < 0 ? "-" : ""
        if magnitude == 0 { return "$0" }
        if magnitude < 0.0001 { return "\(sign)<$0.0001" }
        if magnitude < 0.01 { return "\(sign)$\(magnitude.formatted(fixed: 4))" }
        if magnitude < 1 { return "\(sign)$\(magnitude.formatted(fixed: 3))" }
        if magnitude < 100 { return "\(sign)$\(magnitude.formatted(fixed: 2))" }
        return "\(sign)$\(Int(magnitude.rounded()).formatted(.number.grouping(.automatic)))"
    }

    /// A total that is a floor when some calls went unpriced: "$0.42+".
    static func usdFloor(_ value: String?, unpriced: Int) -> String {
        let formatted = usd(value)
        return unpriced > 0 && formatted != "—" ? "\(formatted)+" : formatted
    }

    static func tokens(_ count: Int?) -> String {
        guard let count else { return "—" }
        let magnitude = abs(count)
        if magnitude >= 1_000_000 { return "\((Double(count) / 1_000_000).formatted(fixed: 1))M" }
        if magnitude >= 1_000 { return "\((Double(count) / 1_000).formatted(fixed: 1))k" }
        return "\(count)"
    }

    /// A model catalog window, e.g. "131K" or "1M".
    static func contextLength(_ tokens: Int) -> String {
        if tokens >= 1_000_000 {
            let millions = Double(tokens) / 1_000_000
            return millions == millions.rounded() ? "\(Int(millions))M" : "\(millions.formatted(fixed: 1))M"
        }
        if tokens >= 1_000 { return "\(Int((Double(tokens) / 1_000).rounded()))K" }
        return "\(tokens)"
    }

    static func throughput(_ tokensPerSecond: Double?) -> String {
        guard let tokensPerSecond, tokensPerSecond.isFinite else { return "—" }
        if tokensPerSecond >= 1_000 { return "\((tokensPerSecond / 1_000).formatted(fixed: 1))k tps" }
        return "\(Int(tokensPerSecond.rounded())) tps"
    }

    static func uptime(_ fraction: Double?) -> String {
        guard let fraction, fraction.isFinite else { return "—" }
        return "\(Int((fraction * 100).rounded(.down)))%"
    }

    /// What an endpoint tag adds after the provider, with regions as flags:
    /// "amazon-bedrock/us-east-1" -> "🇺🇸 east-1"; "anthropic" -> nil. A segment
    /// repeating `quantization` is dropped, since the row prints that already.
    /// `label` spells the flags out for VoiceOver.
    static func endpointVariant(_ tag: String, quantization: String? = nil) -> (text: String, label: String)? {
        let segments = tag.split(separator: "/").dropFirst()
            .map(String.init)
            .filter { $0 != quantization }
            .map(variantSegment)
        guard !segments.isEmpty else { return nil }
        return (segments.map(\.text).joined(separator: " "), segments.map(\.label).joined(separator: ", "))
    }

    private static let endpointRegions: [String: (flag: String, name: String)] = [
        "global": ("🌐", "Global"),
        "us": ("🇺🇸", "United States"),
        "eu": ("🇪🇺", "Europe"),
        "europe": ("🇪🇺", "Europe"),
        "swedencentral": ("🇸🇪", "Sweden"),
    ]

    private static func variantSegment(_ segment: String) -> (text: String, label: String) {
        if let region = endpointRegions[segment] { return (region.flag, region.name) }
        // A datacenter code keeps its remainder, or two Bedrock US rows read alike.
        if let dash = segment.firstIndex(of: "-"), let region = endpointRegions[String(segment[..<dash])] {
            let rest = segment[segment.index(after: dash)...]
            return ("\(region.flag) \(rest)", "\(region.name) \(rest)")
        }
        return (segment, segment)
    }

    static func wordCount(_ count: Int) -> String {
        "\(count.formatted()) \(count == 1 ? "word" : "words")"
    }

    /// The part of a model id after its author: "claude-sonnet-5".
    static func shortModelId(_ modelId: String) -> String {
        guard let slash = modelId.lastIndex(of: "/") else { return modelId }
        return String(modelId[modelId.index(after: slash)...])
    }

    /// "today", "yesterday", "3d ago", "2w ago", "5mo ago", "1y ago".
    static func relativeDate(_ iso: String, now: Date = .now) -> String {
        guard let date = ISODate.parse(iso) else { return "" }
        let calendar = Calendar.current
        let days = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: date),
            to: calendar.startOfDay(for: now)
        ).day ?? 0
        if days <= 0 { return "today" }
        if days == 1 { return "yesterday" }
        if days < 7 { return "\(days)d ago" }
        if days < 30 { return "\(days / 7)w ago" }
        if days < 365 { return "\(days / 30)mo ago" }
        return "\(days / 365)y ago"
    }

    /// "42s", "3m 07s", "1h 12m" since an ISO instant.
    static func elapsed(since iso: String, now: Date = .now) -> String {
        guard let start = ISODate.parse(iso) else { return "" }
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 {
            return "\(minutes)m \((seconds % 60).formatted(.number.precision(.integerLength(2))))s"
        }
        return "\(minutes / 60)h \(minutes % 60)m"
    }
}

extension Double {
    /// Fixed fraction digits, like JavaScript's toFixed, without grouping.
    nonisolated func formatted(fixed digits: Int) -> String {
        formatted(.number.precision(.fractionLength(digits)).grouping(.never))
    }
}
