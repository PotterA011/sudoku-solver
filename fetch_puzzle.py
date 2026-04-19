import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/91.0.4472.124 Safari/537.36"
    )
}
BUNDLE_PATH = Path(__file__).with_name("puzpatcher.bundle.js")
DATA_DIR = Path(__file__).with_name("data")
DECODED_DIR = DATA_DIR / "decoded"


def build_url(api_key: str) -> str:
    return f"https://sudokupad.app/api/puzzle/{api_key}"


def decode_with_sudokupad_bundle(raw_payload: str) -> dict[str, Any]:
    js = """
const fs = require('fs');

const rawPayload = fs.readFileSync(0, 'utf8').trim();
const bundle = fs.readFileSync(process.argv[1], 'utf8');
eval(bundle + `
const stripped = rawPayload.replace(/^(scl|ctc)/, '');
const fixed = loadFPuzzle.fixFPuzzleSlashes(
  loadFPuzzle.saveDecodeURIComponent(stripped)
) || stripped;
const decompressed = loadFPuzzle.saveDecompress(fixed);
const parsed = PuzzleZipper.saveJsonUnzip(decompressed);
process.stdout.write(JSON.stringify(parsed));
`);
"""
    proc = subprocess.run(
        ["node", "-e", js, str(BUNDLE_PATH)],
        input=raw_payload,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "Unknown Node decode error")
    return json.loads(proc.stdout)


def find_corresponding_file(api_key: str, data_dir: Path) -> Path | None:
    direct = data_dir / api_key
    if direct.exists():
        return direct
    for candidate in data_dir.glob(f"{api_key}.*"):
        if candidate.is_file():
            return candidate
    return None


def fetch_raw_payload(api_key: str) -> tuple[str, int]:
    url = build_url(api_key)
    response = requests.get(url, headers=HEADERS, timeout=20)
    response.raise_for_status()
    return response.text.strip(), response.status_code


def parse_cage_metadata(cages: list[Any]) -> dict[str, str]:
    meta: dict[str, str] = {}
    for cage in cages:
        if not isinstance(cage, dict):
            continue
        value = cage.get("value")
        if not isinstance(value, str):
            continue
        if ": " not in value:
            continue
        key, val = value.split(": ", 1)
        key = key.strip().lower()
        if key in {"title", "author", "rules", "solution"} and val.strip():
            meta[key] = val.strip()
    return meta


def extract_values_from_cells(cells: list[Any]) -> dict[str, list[dict[str, Any]]]:
    givens: list[dict[str, Any]] = []
    values: list[dict[str, Any]] = []
    for r_idx, row in enumerate(cells):
        if not isinstance(row, list):
            continue
        for c_idx, cell in enumerate(row):
            if not isinstance(cell, dict):
                continue
            value = cell.get("value")
            if value in (None, "", 0):
                continue
            entry = {"row": r_idx, "col": c_idx, "value": value}
            if cell.get("given") is True:
                givens.append(entry)
            else:
                values.append(entry)
    return {"givens": givens, "values": values}


def normalize_puzzle(
    api_key: str,
    source_file: Path | None,
    raw_payload: str,
    decoded: dict[str, Any],
    fetched_url: str,
    http_status: int,
) -> dict[str, Any]:
    cages = decoded.get("cages", [])
    cage_meta = parse_cage_metadata(cages if isinstance(cages, list) else [])

    top_title = decoded.get("title")
    top_author = decoded.get("author")
    top_rules = decoded.get("rules")
    metadata = {
        "title": cage_meta.get("title") or top_title,
        "author": cage_meta.get("author") or top_author,
        "rules": cage_meta.get("rules") or top_rules,
        "solution": cage_meta.get("solution"),
    }

    cells = decoded.get("cells", [])
    rows = len(cells) if isinstance(cells, list) else 0
    cols = len(cells[0]) if rows > 0 and isinstance(cells[0], list) else 0
    extracted = extract_values_from_cells(cells if isinstance(cells, list) else [])

    lines = decoded.get("lines") if isinstance(decoded.get("lines"), list) else []
    features = {
        "lines": lines,
        "arrows": [line for line in lines if isinstance(line, dict) and "wayPoints" in line],
        "cages": cages if isinstance(cages, list) else [],
        "underlays": decoded.get("underlays") if isinstance(decoded.get("underlays"), list) else [],
        "overlays": decoded.get("overlays") if isinstance(decoded.get("overlays"), list) else [],
        "regions": decoded.get("regions") if isinstance(decoded.get("regions"), list) else [],
        "givens": extracted["givens"],
        "values": extracted["values"],
    }

    return {
        "api_key": api_key,
        "source": {
            "local_file": str(source_file) if source_file else None,
            "fetched_url": fetched_url,
            "fetched_ok": http_status == 200,
            "http_status": http_status,
            "raw_prefix": raw_payload[:3],
            "raw_length": len(raw_payload),
            "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
        },
        "metadata": metadata,
        "grid": {
            "rows": rows,
            "cols": cols,
            "cell_size": decoded.get("cellSize"),
            "cells": cells if isinstance(cells, list) else [],
        },
        "features": features,
        "stats": {
            "line_count": len(features["lines"]),
            "arrow_count": len(features["arrows"]),
            "cage_count": len(features["cages"]),
            "underlay_count": len(features["underlays"]),
            "overlay_count": len(features["overlays"]),
            "region_count": len(features["regions"]),
            "given_count": len(features["givens"]),
            "value_count": len(features["values"]),
        },
        "decoded_raw": decoded,
    }


def save_normalized_json(api_key: str, normalized: dict[str, Any]) -> Path:
    DECODED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = DECODED_DIR / f"{api_key}.json"
    out_path.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
    return out_path


def print_summary(normalized: dict[str, Any], out_path: Path) -> None:
    source = normalized["source"]
    metadata = normalized["metadata"]
    stats = normalized["stats"]
    print(f"API key: {normalized['api_key']}")
    print(f"Local source file: {source['local_file']}")
    print(f"Fetched URL: {source['fetched_url']}")
    print(f"HTTP status: {source['http_status']}")
    print(f"Raw prefix: {source['raw_prefix']} (len={source['raw_length']})")
    print(f"Title: {metadata.get('title') or 'Unknown'}")
    print(f"Author: {metadata.get('author') or 'Unknown'}")
    rules = metadata.get("rules")
    one_line_rules = re.sub(r"\s+", " ", rules).strip() if isinstance(rules, str) else None
    if one_line_rules:
        print(f"Rules preview: {one_line_rules[:180]}{'...' if len(one_line_rules) > 180 else ''}")
    else:
        print("Rules preview: None")
    print(
        "Counts: "
        f"rows={normalized['grid']['rows']}, "
        f"cols={normalized['grid']['cols']}, "
        f"lines={stats['line_count']}, "
        f"arrows={stats['arrow_count']}, "
        f"cages={stats['cage_count']}, "
        f"underlays={stats['underlay_count']}, "
        f"givens={stats['given_count']}, "
        f"values={stats['value_count']}"
    )
    print(f"Saved JSON: {out_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Resolve a SudokuPad API key, decode puzzle content, and save normalized JSON "
            "with rules, numbers, arrows, lines, and grid features."
        )
    )
    parser.add_argument("api_key", nargs="?", default="ypf71xbp99")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    api_key = args.api_key
    try:
        source_file = find_corresponding_file(api_key, DATA_DIR)
        raw_payload, http_status = fetch_raw_payload(api_key)
        decoded = decode_with_sudokupad_bundle(raw_payload)
        if not isinstance(decoded, dict):
            raise RuntimeError("Decoded puzzle is not a JSON object")

        normalized = normalize_puzzle(
            api_key=api_key,
            source_file=source_file,
            raw_payload=raw_payload,
            decoded=decoded,
            fetched_url=build_url(api_key),
            http_status=http_status,
        )
        out_path = save_normalized_json(api_key, normalized)
        print_summary(normalized, out_path)
    except requests.exceptions.RequestException as err:
        print(f"Error fetching puzzle: {err}")
    except Exception as err:
        print(f"Error decoding/normalizing puzzle: {err}")


if __name__ == "__main__":
    main()
