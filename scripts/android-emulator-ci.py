"""Run the existing four native checks only on the disposable CI emulator."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts/android-ci"
CASES = (
    "createOpenAndPersistFixedRequestOffline",
    "resumeAfterProcessRestartOffline",
    "nativeShareUsesPublicUrlAndCancellationPreservesDraft",
    "catalogJsonExportUsesPrivateCacheAndRequiresConfirmation",
)
FAILURE_STAGES = {
    "stored purchase progress did not complete": "stored_progress",
    "resume button did not complete": "resume_button",
    "restored progress did not complete": "restored_progress",
    "Android back to home did not complete": "android_back_home",
    "progress retained after back did not complete": "retained_progress",
    "bundled home did not complete": "bundled_home",
    "native bridge": "native_bridge",
    "offline test environment": "offline_environment",
    "WebView evaluation timeout": "evaluation_timeout",
}


def failure_stage(log):
    # Only a known test-owned assertion name is exported, never the surrounding stack/DOM.
    for marker, stage in FAILURE_STAGES.items():
        if "AssertionError: " + marker in log or "ComparisonFailure: " + marker in log:
            return stage
    return "instrumentation"


def adb(args):
    result = subprocess.run(["adb"] + args, cwd=ROOT, capture_output=True, text=True, timeout=360)
    return result.returncode, result.stdout + result.stderr


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    assert sha == os.environ["SOURCE_SHA"] and re.fullmatch(r"[0-9a-f]{40}", sha)
    code, hardware = adb(["shell", "getprop", "ro.hardware"])
    assert code == 0 and hardware.strip() in {"ranchu", "goldfish"}
    app = ROOT / "android/app/build/outputs/apk/debug/app-debug.apk"
    tests = ROOT / "android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
    with zipfile.ZipFile(app) as archive:
        meta = json.loads(archive.read("assets/public/native-build.json"))
    assert meta["sourceCommit"] == sha and meta["dirty"] is False and meta["optionalFeatures"] is False
    report = {"schemaVersion": 1, "sourceSha": sha, "syntheticOnly": True,
              "physicalDeviceVerified": False, "installed": False,
              "failureStage": None,
              "apkSha256": hashlib.sha256(app.read_bytes()).hexdigest(),
              "tests": {name: "not_run" for name in CASES}}
    shutil.copy2(app, OUT / "app-debug.apk")
    success = False
    try:
        for path in (app, tests):
            code, log = adb(["install", "-r", str(path)])
            assert code == 0 and "Success" in log
        report["installed"] = True
        for service in ("wifi", "data"):
            assert adb(["shell", "svc", service, "disable"])[0] == 0
        for name in CASES:
            if name == "resumeAfterProcessRestartOffline":
                assert adb(["shell", "am", "force-stop", "dev.kaimonobaton.preview"])[0] == 0
            code, log = adb(["shell", "am", "instrument", "-w", "-r", "-e", "syntheticDevice", "true",
                             "-e", "class", "dev.kaimonobaton.preview.BundledCoreTest#" + name,
                             "dev.kaimonobaton.preview.test/androidx.test.runner.AndroidJUnitRunner"])
            passed = code == 0 and "OK (1 test)" in log and "INSTRUMENTATION_STATUS_CODE: 0" in log
            passed = passed and not any(x in log for x in ("INSTRUMENTATION_STATUS_CODE: -3", "INSTRUMENTATION_STATUS_CODE: -4"))
            report["tests"][name] = "passed" if passed else "failed"
            if not passed:
                report["failureStage"] = failure_stage(log)
            print("android: " + name + " " + report["tests"][name], flush=True)
            assert passed
        success = True
    except (AssertionError, OSError, subprocess.SubprocessError):
        print("android: verification failed", flush=True)
    finally:
        # The output is constructed from fixed fields/statuses; no raw log, payload or URL is exported.
        assert set(report["tests"]) == set(CASES)
        assert all(x in {"passed", "failed", "not_run"} for x in report["tests"].values())
        assert re.fullmatch(r"[0-9a-f]{64}", report["apkSha256"])
        assert report["failureStage"] is None or report["failureStage"] in set(FAILURE_STAGES.values()) | {"instrumentation"}
        (OUT / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, sort_keys=True))
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
