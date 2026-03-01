"""
Hugging Face Dataset Loader (fallback for script-based datasets)

This script uses datasets<3.0 (which supports trust_remote_code=True) to fetch
rows from HF datasets that the modern datasets-server API rejects.

It automatically creates/reuses an isolated venv with the correct version.
"""
import sys
import os
import json
import traceback
import subprocess

VENV_DIR_NAME = ".hf_venv"

def get_venv_python():
    venv_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), VENV_DIR_NAME)
    exe = "python.exe" if os.name == "nt" else "python"
    return os.path.join(venv_dir, "Scripts" if os.name == "nt" else "bin", exe)

def ensure_venv():
    """Create the isolated venv with datasets<3.0 if it doesn't exist."""
    python_exe = get_venv_python()
    if os.path.exists(python_exe):
        return python_exe

    venv_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), VENV_DIR_NAME)
    sys.stderr.write("Creating isolated virtual environment for datasets<3.0...\n")
    subprocess.run([sys.executable, "-m", "venv", venv_dir], check=True)
    subprocess.run(
        [python_exe, "-m", "pip", "install", "--quiet", "datasets<3.0.0", "pyarrow", "pandas"],
        check=True,
    )
    return python_exe

def do_load(dataset_id, config_name, split_name, limit):
    """Actually load the dataset (runs inside the venv)."""
    from datasets import load_dataset

    kwargs = dict(split=split_name, streaming=True, trust_remote_code=True)

    if not config_name or config_name.lower() == "default":
        ds = load_dataset(dataset_id, **kwargs)
    else:
        ds = load_dataset(dataset_id, config_name, **kwargs)

    rows = []
    for i, row in enumerate(ds):
        if i >= limit:
            break
        clean_row = {}
        for k, v in row.items():
            if isinstance(v, (str, int, float, bool, type(None))):
                clean_row[k] = v
            elif isinstance(v, dict) and "array" in v and "sampling_rate" in v:
                clean_row[k] = f"<Audio: {v.get('sampling_rate')}Hz>"
            elif isinstance(v, list):
                clean_row[k] = json.dumps(v, ensure_ascii=False, default=str)[:500]
            else:
                clean_row[k] = str(v)[:500]
        rows.append(clean_row)

    return rows

def main():
    # ── Called with __VENV_RUN__: we are inside the venv, do the real work ──
    if len(sys.argv) > 1 and sys.argv[1] == "__VENV_RUN__":
        if len(sys.argv) < 6:
            print(json.dumps({"ok": False, "error": "Usage: ... __VENV_RUN__ <id> <config> <split> <limit>"}))
            sys.exit(1)
        dataset_id = sys.argv[2]
        config_name = sys.argv[3]
        split_name = sys.argv[4]
        limit = int(sys.argv[5]) if sys.argv[5].isdigit() else 100
        try:
            rows = do_load(dataset_id, config_name, split_name, limit)
            print(json.dumps({"ok": True, "rows": rows}))
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e), "traceback": traceback.format_exc()}))
            sys.exit(1)
        return

    # ── Normal entry point: ensure venv exists, then re-invoke ourselves inside it ──
    if len(sys.argv) < 5:
        print(json.dumps({"ok": False, "error": "Usage: python hf_dataset_loader.py <id> <config> <split> <limit>"}))
        sys.exit(1)

    try:
        venv_python = ensure_venv()
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Failed to setup venv: {e}"}))
        sys.exit(1)

    # Re-run this same script inside the venv
    result = subprocess.run(
        [venv_python, __file__, "__VENV_RUN__"] + sys.argv[1:],
        capture_output=True,
        text=True,
        timeout=300,
    )

    # Forward stdout (the JSON result) and stderr (progress bars etc.)
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        sys.stderr.write(result.stderr)

    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
