import Foundation

/// Packs pictures into rows that are as tall as `targetHeight` allows and as
/// wide as the container, without cropping any of them.
///
/// Order is preserved, so a newest-first list still reads left to right and top
/// to bottom. Only the last row may fall short of the width; it keeps the
/// target height rather than stretching a straggler across the screen.
nonisolated enum JustifiedLayout {
    static func rows(
        aspectRatios: [Double],
        width: Double,
        targetHeight: Double,
        spacing: Double
    ) -> [JustifiedRow] {
        guard width > 0, targetHeight > 0 else { return [] }
        let ratios = aspectRatios.map { max($0, 0.1) }
        var rows: [JustifiedRow] = []
        var current: [Int] = []
        var ratioSum = 0.0

        func fittedHeight(count: Int, ratioSum: Double) -> Double {
            (width - spacing * Double(count - 1)) / ratioSum
        }

        func close(_ indices: [Int], sum: Double) {
            let height = fittedHeight(count: indices.count, ratioSum: sum)
            rows.append(JustifiedRow(items: indices.map { JustifiedRow.Item(index: $0, width: ratios[$0] * height) }, height: height))
        }

        for index in ratios.indices {
            let ratio = ratios[index]
            current.append(index)
            ratioSum += ratio
            let height = fittedHeight(count: current.count, ratioSum: ratioSum)
            guard height <= targetHeight else { continue }

            // Past the target: keep the newcomer only if that lands nearer it.
            if current.count > 1 {
                let without = fittedHeight(count: current.count - 1, ratioSum: ratioSum - ratio)
                if abs(without - targetHeight) < abs(height - targetHeight) {
                    close(Array(current.dropLast()), sum: ratioSum - ratio)
                    current = [index]
                    ratioSum = ratio
                    continue
                }
            }
            close(current, sum: ratioSum)
            current = []
            ratioSum = 0
        }

        if !current.isEmpty {
            rows.append(JustifiedRow(
                items: current.map { JustifiedRow.Item(index: $0, width: ratios[$0] * targetHeight) },
                height: targetHeight
            ))
        }
        return rows
    }
}
