import UIKit
import WebKit

/// Draws SVG bytes into a bitmap. The offline mock provider paints its
/// pictures as SVG, which UIImage cannot decode, so they are rendered once in
/// an offscreen web view and cached like any other image.
final class SVGRasterizer: NSObject, WKNavigationDelegate {
    private var continuation: CheckedContinuation<Void, Error>?

    static func rasterize(_ data: Data, longEdge: Double = 1024) async throws -> UIImage {
        let size = intrinsicSize(of: data).map { size in
            let scale = longEdge / max(size.width, size.height)
            return CGSize(width: size.width * scale, height: size.height * scale)
        } ?? CGSize(width: longEdge, height: longEdge * 9 / 16)
        return try await SVGRasterizer().render(data, size: size)
    }

    private func render(_ data: Data, size: CGSize) async throws -> UIImage {
        let configuration = WKWebViewConfiguration()
        configuration.suppressesIncrementalRendering = true
        let webView = WKWebView(frame: CGRect(origin: .zero, size: size), configuration: configuration)
        webView.isOpaque = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = self

        let html = """
        <html><head><meta name="viewport" content="width=\(Int(size.width)),initial-scale=1">
        <style>html,body{margin:0;padding:0;background:transparent}img{display:block;width:100vw;height:100vh}</style>
        </head><body><img src="data:image/svg+xml;base64,\(data.base64EncodedString())"></body></html>
        """
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.continuation = continuation
            webView.loadHTMLString(html, baseURL: nil)
        }
        let snapshot = WKSnapshotConfiguration()
        snapshot.rect = CGRect(origin: .zero, size: size)
        snapshot.afterScreenUpdates = true
        return try await webView.takeSnapshot(configuration: snapshot)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        continuation?.resume()
        continuation = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    /// The width and height attributes of the root element, when present.
    private static func intrinsicSize(of data: Data) -> CGSize? {
        guard let text = String(data: data.prefix(2048), encoding: .utf8),
              let tag = text.range(of: "<svg")
        else { return nil }
        let head = text[tag.lowerBound...].prefix { $0 != ">" }
        func attribute(_ name: String) -> Double? {
            guard let range = head.range(of: "\(name)=\"") else { return nil }
            let value = head[range.upperBound...].prefix { $0 != "\"" }
            return Double(value)
        }
        guard let width = attribute(" width"), let height = attribute(" height"), width > 0, height > 0 else {
            return nil
        }
        return CGSize(width: width, height: height)
    }
}
