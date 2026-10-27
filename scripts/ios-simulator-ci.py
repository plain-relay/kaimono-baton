"""Unsigned Simulator build and synthetic UI verification on a standard macOS runner.

Raw XCUITest output/xcresult may contain synthetic links and is never uploaded.
Only this validated, bounded metadata report and the pristine Simulator app leave the job.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts/ios"
PRIVATE = ROOT / "ios/DerivedData/ci-private"
TESTS = (
    "testBundledHomeAndFixedRequestPersistence",
    "testDraftSurvivesRestart",
    "testNativeShareCancellationPreservesDraft",
)
STAGES = {"environment", "resolve", "build", "artifact", "simulator", "tests", "complete"}


def command(args, name, timeout=900):
    with (PRIVATE / (name + ".log")).open("w") as log:
        result = subprocess.run(args, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    return result.returncode


def output(args):
    return subprocess.check_output(args, cwd=ROOT, stderr=subprocess.DEVNULL, text=True).strip()


def test_statuses(log):
    statuses = {name: "not_run" for name in TESTS}
    for name in TESTS:
        matches = re.findall(r"Test Case '-\[[^\]\n]+ " + name + r"\]' (passed|failed|skipped)", log)
        if matches:
            statuses[name] = "passed" if all(x == "passed" for x in matches) else "failed"
    return statuses


def validate(report):
    assert set(report) == {
        "schemaVersion", "sourceSha", "runId", "runner", "xcodeVersion", "xcodeBuild",
        "swiftVersion", "simulatorSdk", "simulatorRuntime", "sourceTreeDirty", "syntheticOnly",
        "physicalDeviceVerified", "signingAllowed", "dependencies", "buildSucceeded", "tests",
        "artifactSha256", "artifactBytes", "stage",
    }
    assert report["schemaVersion"] == 1 and re.fullmatch(r"[0-9a-f]{40}", report["sourceSha"])
    assert re.fullmatch(r"[0-9]*", report["runId"])
    assert report["runner"] in {"arm64", "x86_64"}
    for key in ("xcodeVersion", "swiftVersion", "simulatorSdk", "simulatorRuntime"):
        assert re.fullmatch(r"[0-9.]*", report[key])
    assert re.fullmatch(r"[0-9A-Za-z]*", report["xcodeBuild"])
    assert type(report["sourceTreeDirty"]) is bool and report["syntheticOnly"] is True
    assert report["physicalDeviceVerified"] is False and report["signingAllowed"] is False
    assert type(report["buildSucceeded"]) is bool and report["stage"] in STAGES
    assert set(report["tests"]) == set(TESTS)
    assert all(x in {"passed", "failed", "not_run"} for x in report["tests"].values())
    assert report["artifactSha256"] is None or re.fullmatch(r"[0-9a-f]{64}", report["artifactSha256"])
    assert type(report["artifactBytes"]) is int and report["artifactBytes"] >= 0
    for dep in report["dependencies"]:
        assert set(dep) == {"identity", "version", "revision"}
        assert dep["identity"] in {"capacitor-swift-pm", "ion-ios-filesystem"}
        assert re.fullmatch(r"[0-9.]+", dep["version"])
        assert re.fullmatch(r"[0-9a-f]{40}", dep["revision"])


def main():
    os.chdir(ROOT)
    OUT.mkdir(parents=True, exist_ok=True)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    sha = output(["git", "rev-parse", "HEAD"])
    report = {
        "schemaVersion": 1, "sourceSha": sha, "runId": os.environ.get("GITHUB_RUN_ID", ""),
        "runner": platform.machine(), "xcodeVersion": "", "xcodeBuild": "", "swiftVersion": "",
        "simulatorSdk": "", "simulatorRuntime": "", "sourceTreeDirty": False,
        "syntheticOnly": True, "physicalDeviceVerified": False, "signingAllowed": False,
        "dependencies": [], "buildSucceeded": False, "tests": {name: "not_run" for name in TESTS},
        "artifactSha256": None, "artifactBytes": 0, "stage": "environment",
    }
    device = None
    success = False
    try:
        assert platform.system() == "Darwin"
        assert sha == os.environ["SOURCE_SHA"]
        report["sourceTreeDirty"] = bool(output(["git", "status", "--porcelain", "--untracked-files=normal"]))
        assert report["sourceTreeDirty"] is False
        meta = json.loads((ROOT / "ios/App/App/public/native-build.json").read_text())
        assert meta["sourceCommit"] == sha and meta["dirty"] is False and meta["optionalFeatures"] is False
        version = output(["xcodebuild", "-version"]).splitlines()
        report["xcodeVersion"] = version[0].removeprefix("Xcode ")
        report["xcodeBuild"] = version[1].removeprefix("Build version ")
        assert report["xcodeVersion"] == "26.3"
        swift = output(["xcrun", "swift", "--version"])
        report["swiftVersion"] = re.search(r"Swift version ([0-9.]+)", swift).group(1)
        report["simulatorSdk"] = output(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"])
        base = ["xcodebuild", "-project", "ios/App/App.xcodeproj", "-scheme", "App-CI",
                "-configuration", "Debug", "-sdk", "iphonesimulator",
                "-derivedDataPath", "ios/DerivedData/build", "CODE_SIGNING_ALLOWED=NO"]
        report["stage"] = "resolve"
        print("ios: resolve", flush=True)
        assert command(base + ["-resolvePackageDependencies"], "resolve") == 0
        resolved = ROOT / "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
        pins = json.loads(resolved.read_text())["pins"]
        report["dependencies"] = [{"identity": p["identity"], "version": p["state"]["version"],
                                    "revision": p["state"]["revision"]} for p in pins]
        assert any(p["identity"] == "capacitor-swift-pm" and p["version"] == "8.5.3" for p in report["dependencies"])
        report["stage"] = "build"
        print("ios: build", flush=True)
        assert command(base + ["-destination", "generic/platform=iOS Simulator", "build-for-testing"], "build") == 0
        report["buildSucceeded"] = True
        report["stage"] = "artifact"
        products = ROOT / "ios/DerivedData/build/Build/Products/Debug-iphonesimulator"
        app_meta = json.loads((products / "App.app/public/native-build.json").read_text())
        assert app_meta == meta
        archive = OUT / "App-simulator.tar.gz"
        assert command(["tar", "-czf", str(archive), "-C", str(products), "App.app"], "archive") == 0
        report["artifactSha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
        report["artifactBytes"] = archive.stat().st_size
        report["stage"] = "simulator"
        runtimes = json.loads(output(["xcrun", "simctl", "list", "runtimes", "--json"]))["runtimes"]
        eligible = [r for r in runtimes if r.get("isAvailable") and "SimRuntime.iOS-" in r["identifier"]]
        runtime = max(eligible, key=lambda r: tuple(int(n) for n in r["version"].split(".")))
        report["simulatorRuntime"] = runtime["version"]
        device = output(["xcrun", "simctl", "create", "Baton Synthetic CI", "com.apple.CoreSimulator.SimDeviceType.iPhone-16", runtime["identifier"]])
        assert re.fullmatch(r"[0-9A-Fa-f-]{36}", device)
        assert command(["xcrun", "simctl", "boot", device], "boot") == 0
        assert command(["xcrun", "simctl", "bootstatus", device, "-b"], "bootstatus", 300) == 0
        report["stage"] = "tests"
        print("ios: tests", flush=True)
        code = command(base + ["-destination", "platform=iOS Simulator,id=" + device,
                               "-parallel-testing-enabled", "NO", "-maximum-concurrent-test-simulator-destinations", "1",
                               "-resultBundlePath", str(PRIVATE / "results.xcresult"),
                               "test-without-building"], "tests", 1200)
        log = (PRIVATE / "tests.log").read_text()
        report["tests"] = test_statuses(log)
        assert code == 0 and all(x == "passed" for x in report["tests"].values())
        report["stage"] = "complete"
        success = True
    except (AssertionError, OSError, ValueError, KeyError, AttributeError, subprocess.SubprocessError):
        print("ios: failed at " + report["stage"], flush=True)
        # Compiler diagnostics only; never emit UI test traces, URLs, view hierarchy, or screenshots.
        if report["stage"] in {"resolve", "build"}:
            path = PRIVATE / (report["stage"] + ".log")
            if path.exists():
                for line in path.read_text().splitlines():
                    if re.search(r"(?:^xcodebuild: error:|:\d+:\d+: error:)", line):
                        print(line[:500])
    finally:
        if device:
            try:
                command(["xcrun", "simctl", "shutdown", device], "shutdown", 60)
                command(["xcrun", "simctl", "delete", device], "delete", 60)
            except (OSError, subprocess.SubprocessError):
                print("ios: cleanup incomplete; runner is disposable", flush=True)
        validate(report)
        (OUT / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, sort_keys=True))
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
