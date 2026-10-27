import XCTest

/// Only the disposable CI Simulator is used; no application test hooks or mocked plugins.
final class AppUITests: XCTestCase {
    private var app: XCUIApplication!
    private enum Stage: String {
        case home, create, draft_selected, import_form, fixed_open, progress
        case relaunch, resume, draft_restore, review, share_sheet, share_cancel, cancelled_restore
        case share_plugin_failure, share_close_missing
    }
    private func stage(_ value: Stage) {
        // This fixed enum is the only UI trace exported by the CI result producer.
        print("BATON_STAGE=" + value.rawValue)
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        #if targetEnvironment(simulator)
        XCTAssertEqual(ProcessInfo.processInfo.environment["BATON_SYNTHETIC_TESTS"], "true", "synthetic guard")
        #else
        throw XCTSkip("Simulator only")
        #endif
        app = XCUIApplication(bundleIdentifier: "dev.kaimonobaton.preview")
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        stage(.home)
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
        stage(.create)
        home.tap()
        let increase = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "増やす（現在")).firstMatch
        XCTAssertTrue(increase.waitForExistence(timeout: 20), "create form")
        reveal(increase)
        increase.tap()
        stage(.draft_selected)
        let review = app.buttons["確認へ"]
        reveal(review)
        XCTAssertTrue(review.isEnabled, "draft selected")
    }

    func testBundledHomeAndFixedRequestPersistence() throws {
        // The native-only form and WKWebView prove the bundled application rendered.
        XCTAssertTrue(app.webViews.firstMatch.exists, "WKWebView rendered")
        stage(.import_form)
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
        stage(.fixed_open)
        let open = app.buttons["アプリで開く"]
        reveal(open)
        open.tap()
        let carts = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "かごに入れる"))
        XCTAssertTrue(carts.firstMatch.waitForExistence(timeout: 20), "fixed request opened")
        XCTAssertEqual(carts.count, 4, "published fixture item count")
        let cart = carts.element(boundBy: 3)
        reveal(cart)
        stage(.progress)
        cart.tap()
        // Purchased, condition-free cards intentionally collapse their action buttons.
        // Assert the visible purchased summary, not a hidden reset control in the DOM.
        let purchased = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "購入済みの詳細を")).firstMatch
        XCTAssertTrue(purchased.waitForExistence(timeout: 10), "progress saved")
        stage(.relaunch)
        app.terminate()
        app.launch()
        XCTAssertTrue(home.waitForExistence(timeout: 30), "relaunched bundled home")
        let resume = app.buttons["前回の買い物を再開"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "saved fixed route")
        stage(.resume)
        resume.tap()
        XCTAssertTrue(purchased.waitForExistence(timeout: 20), "progress survived process restart")
    }

    func testDraftSurvivesRestart() {
        createDraft()
        stage(.relaunch)
        app.terminate()
        app.launch()
        XCTAssertTrue(home.waitForExistence(timeout: 30), "draft relaunch")
        stage(.draft_restore)
        home.tap()
        let review = app.buttons["確認へ"]
        XCTAssertTrue(review.waitForExistence(timeout: 20), "draft form restored")
        XCTAssertTrue(review.isEnabled, "selected draft survived process restart")
    }

    func testNativeShareCancellationPreservesDraft() {
        createDraft()
        stage(.review)
        app.buttons["確認へ"].tap()
        let share = app.buttons["LINEで送る"]
        XCTAssertTrue(share.waitForExistence(timeout: 20), "request review")
        reveal(share)
        stage(.share_sheet)
        share.tap()
        let closeQuery = NSPredicate(format: "label CONTAINS[c] 'close' OR label IN %@ OR identifier IN %@",
            ["Cancel", "Dismiss", "閉じる", "キャンセル"], ["Close", "Cancel", "CloseButton"])
        let close = app.descendants(matching: .any).matching(closeQuery).firstMatch
        let systemClose = XCUIApplication(bundleIdentifier: "com.apple.springboard").descendants(matching: .any).matching(closeQuery).firstMatch
        let rejected = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "共有またはコピーができませんでした")).firstMatch
        let sheetReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            close.exists || systemClose.exists || rejected.exists
        }, object: nil)
        _ = XCTWaiter.wait(for: [sheetReady], timeout: 15)
        if rejected.exists {
            stage(.share_plugin_failure)
            XCTFail("native share rejected")
            return
        }
        stage(.share_cancel)
        let cancelled = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "共有をキャンセルしました")).firstMatch
        if close.exists && close.isHittable { close.tap() }
        else if systemClose.exists && systemClose.isHittable { systemClose.tap() }
        else {
            // System share UI does not consistently expose its Close control to XCUITest.
            // Use actual interactive dismissal; never call a mocked completion handler.
            app.swipeDown()
            if !cancelled.waitForExistence(timeout: 5) {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
            }
        }
        XCTAssertTrue(cancelled.waitForExistence(timeout: 20), "OS cancellation returned to application")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "依頼文をコピーしました")).firstMatch.exists, "no clipboard fallback")
        stage(.cancelled_restore)
        app.terminate()
        app.launch()
        XCTAssertTrue(home.waitForExistence(timeout: 30), "cancel relaunch")
        home.tap()
        let review = app.buttons["確認へ"]
        XCTAssertTrue(review.waitForExistence(timeout: 20), "cancelled draft restored")
        XCTAssertTrue(review.isEnabled, "cancel retained draft")
    }
}
