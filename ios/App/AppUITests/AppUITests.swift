import XCTest

/// Only the disposable CI Simulator is used; no application test hooks or mocked plugins.
final class AppUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        #if targetEnvironment(simulator)
        XCTAssertEqual(ProcessInfo.processInfo.environment["BATON_SYNTHETIC_TESTS"], "true", "synthetic guard")
        #else
        throw XCTSkip("Simulator only")
        #endif
        app = XCUIApplication(bundleIdentifier: "dev.kaimonobaton.preview")
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.terminate()
        app.launch()
        XCTAssertTrue(home.waitForExistence(timeout: 30), "bundled home")
    }

    override func tearDown() {
        app?.terminate()
    }

    private var home: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "新しい買いものリストを作る")).firstMatch
    }

    private func reveal(_ element: XCUIElement, upwards: Bool = true) {
        for _ in 0..<12 {
            if element.exists && element.isHittable { return }
            if upwards { app.swipeUp() } else { app.swipeDown() }
        }
    }

    private func createDraft() {
        home.tap()
        let increase = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "増やす（現在")).firstMatch
        XCTAssertTrue(increase.waitForExistence(timeout: 20), "create form")
        reveal(increase)
        increase.tap()
        let review = app.buttons["確認へ"]
        reveal(review)
        XCTAssertTrue(review.isEnabled, "draft selected")
    }

    func testBundledHomeAndFixedRequestPersistence() throws {
        // The native-only form and WKWebView prove the bundled application rendered.
        XCTAssertTrue(app.webViews.firstMatch.exists, "WKWebView rendered")
        let disclosure = app.buttons["リンクを貼り付けて開く"]
        if disclosure.exists { disclosure.tap() }
        else { app.staticTexts["リンクを貼り付けて開く"].tap() }
        let input = app.textViews.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10), "native import form")
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "published-v3", withExtension: "txt"))
        let encoded = try String(contentsOf: fixture, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let link = "https://plain-relay.github.io/kaimono-baton/?openExternalBrowser=1#/l/" + encoded
        input.tap()
        input.typeText(link)
        let open = app.buttons["アプリで開く"]
        reveal(open)
        open.tap()
        let carts = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "かごに入れる"))
        XCTAssertTrue(carts.firstMatch.waitForExistence(timeout: 20), "fixed request opened")
        XCTAssertEqual(carts.count, 4, "published fixture item count")
        let cart = carts.element(boundBy: 3)
        reveal(cart)
        cart.tap()
        let reset = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "未購入に戻す")).firstMatch
        XCTAssertTrue(reset.waitForExistence(timeout: 10), "progress saved")
        app.terminate()
        app.launch()
        XCTAssertTrue(home.waitForExistence(timeout: 30), "relaunched bundled home")
        let resume = app.buttons["前回の買い物を再開"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "saved fixed route")
        resume.tap()
        XCTAssertTrue(reset.waitForExistence(timeout: 20), "progress survived process restart")
    }

    func testDraftSurvivesRestart() {
        createDraft()
        app.terminate()
        app.launch()
        XCTAssertTrue(home.waitForExistence(timeout: 30), "draft relaunch")
        home.tap()
        let review = app.buttons["確認へ"]
        XCTAssertTrue(review.waitForExistence(timeout: 20), "draft form restored")
        XCTAssertTrue(review.isEnabled, "selected draft survived process restart")
    }

    func testNativeShareCancellationPreservesDraft() {
        createDraft()
        app.buttons["確認へ"].tap()
        let share = app.buttons["LINEで送る"]
        XCTAssertTrue(share.waitForExistence(timeout: 20), "request review")
        reveal(share)
        share.tap()
        let close = app.buttons["Close"].firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 20), "native activity sheet")
        close.tap()
        let cancelled = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "共有をキャンセルしました")).firstMatch
        XCTAssertTrue(cancelled.waitForExistence(timeout: 20), "OS cancellation returned to application")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "依頼文をコピーしました")).firstMatch.exists, "no clipboard fallback")
        app.terminate()
        app.launch()
        XCTAssertTrue(home.waitForExistence(timeout: 30), "cancel relaunch")
        home.tap()
        let review = app.buttons["確認へ"]
        XCTAssertTrue(review.waitForExistence(timeout: 20), "cancelled draft restored")
        XCTAssertTrue(review.isEnabled, "cancel retained draft")
    }
}
