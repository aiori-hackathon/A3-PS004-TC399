"""Run the offline Python and Node.js regression suites."""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    python_result = subprocess.run(
        [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            "tests",
            "-v",
        ],
        cwd=ROOT,
        check=False,
    )

    node = shutil.which("node")
    if node is None:
        print("Node.js is required to run tests/test_dashboard.js.", file=sys.stderr)
        return 1

    node_result = subprocess.run(
        [node, "--test", "tests/test_dashboard.js"],
        cwd=ROOT,
        check=False,
    )
    return int(python_result.returncode != 0 or node_result.returncode != 0)


if __name__ == "__main__":
    raise SystemExit(main())
