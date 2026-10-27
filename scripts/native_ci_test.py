"""Check the reporting boundary: missing, skipped, or retried failures cannot become PASS."""
import importlib.util
from pathlib import Path
import unittest
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("ios_ci", Path(__file__).with_name("ios-simulator-ci.py"))
ios = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ios)


class NativeReportTest(unittest.TestCase):
    def test_requires_explicit_pass_for_each_known_case(self):
        self.assertTrue(all(x == "not_run" for x in ios.test_statuses("").values()))
        log = "\n".join("Test Case '-[AppUITests.AppUITests " + name + "]' passed (1.0 seconds)." for name in ios.TESTS)
        self.assertTrue(all(x == "passed" for x in ios.test_statuses(log).values()))

    def test_skip_failure_and_retry_do_not_pass(self):
        name = ios.TESTS[0]
        for state in ("failed", "skipped"):
            log = "Test Case '-[AppUITests.AppUITests " + name + "]' " + state + " (1.0 seconds).\n"
            log += "Test Case '-[AppUITests.AppUITests " + name + "]' passed (1.0 seconds)."
            self.assertEqual(ios.test_statuses(log)[name], "failed")

    def test_ignores_untrusted_or_partial_case_lines(self):
        log = "Test Case '-[Other arbitrary]' passed\n" + ios.TESTS[0] + " passed"
        self.assertTrue(all(x == "not_run" for x in ios.test_statuses(log).values()))

    def test_only_known_failure_stage_is_exported(self):
        name = ios.TESTS[0]
        log = "Test Case '-[AppUITests.AppUITests " + name + "]' started.\nBATON_STAGE=import_form\n"
        log += "BATON_STAGE=arbitrary_untrusted_text\nTest Case '-[AppUITests.AppUITests " + name + "]' failed."
        self.assertEqual(ios.test_failure_stages(log), {name: "import_form"})

    def test_android_failure_stage_drops_surrounding_trace(self):
        spec = importlib.util.spec_from_file_location("android_ci", Path(__file__).with_name("android-emulator-ci.py"))
        android = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(android)
        self.assertEqual(android.failure_stage("java.lang.AssertionError: restored progress did not complete\nother trace"), "restored_progress")
        self.assertEqual(android.failure_stage("unclassified trace"), "instrumentation")


if __name__ == "__main__":
    unittest.main()
