"""Command line: python -m nisar_change --help"""

from __future__ import annotations

import argparse
import sys
from datetime import date

from . import events
from .config import DIRECTIONS, INPUT_UNITS, POLARISATIONS, RESAMPLING, AnalysisRequest, Thresholds
from .errors import NisarChangeError
from .pipeline import run_analysis, run_from_files


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m nisar_change",
        description="Compare two NISAR L2 GCOV observations of one area and write change tables.")
    p.add_argument("--bbox", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"),
                   help="area of interest in degrees")
    p.add_argument("--event", default="deforestation", help="event type (see --list-events)")
    p.add_argument("--before", type=date.fromisoformat, metavar="YYYY-MM-DD")
    p.add_argument("--after", type=date.fromisoformat, metavar="YYYY-MM-DD")
    p.add_argument("--pol", choices=POLARISATIONS, default="HV")
    p.add_argument("--out", default="out", help="output directory")
    p.add_argument("--cache", default=None, help="download cache (default: <out>/.cache)")
    p.add_argument("--threshold-db", type=float, default=3.0)
    p.add_argument("--direction", choices=DIRECTIONS, default="decrease")
    p.add_argument("--tolerance-days", type=int, default=6)
    p.add_argument("--min-coverage", type=float, default=0.95)
    p.add_argument("--input-units", choices=INPUT_UNITS, default="linear")
    p.add_argument("--resampling", choices=RESAMPLING, default="bilinear")
    p.add_argument("--pixel-csv", type=int, default=None, metavar="MAX_ROWS",
                   help="also write a per-pixel CSV (subsampled to at most this many rows)")
    p.add_argument("--before-file", help="use this float GeoTIFF instead of querying NASA")
    p.add_argument("--after-file", help="use this float GeoTIFF instead of querying NASA")
    p.add_argument("--list-events", action="store_true")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.list_events:
        for m in events.METHODS.values():
            status = "implemented" if m.supported else "NOT implemented"
            print(f"{m.name} [{status}]\n  {m.summary}\n  needs: {m.requirements}\n")
        return 0
    missing = [n for n, v in (("--bbox", args.bbox), ("--before", args.before),
                              ("--after", args.after)) if v is None]
    if missing:
        build_parser().error(f"required: {', '.join(missing)}")

    request = AnalysisRequest(
        bbox=tuple(args.bbox), event_type=args.event, before_date=args.before,
        after_date=args.after, polarisation=args.pol,
        thresholds=Thresholds(change_db=args.threshold_db, direction=args.direction),
        date_tolerance_days=args.tolerance_days, min_aoi_coverage=args.min_coverage,
        input_units=args.input_units, resampling=args.resampling)
    try:
        if bool(args.before_file) != bool(args.after_file):
            build_parser().error("--before-file and --after-file must be given together")
        if args.before_file:
            run = run_from_files(request, args.before_file, args.after_file, args.out,
                                 pixel_csv_max=args.pixel_csv)
        else:
            run = run_analysis(request, args.out, cache_dir=args.cache,
                               pixel_csv_max=args.pixel_csv)
    except NisarChangeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if run.selection:
        print("\n".join(run.selection.explanation[:7]))
    s = run.stats
    print(f"\nvalid pixels: {s['valid_pixels']}  mean change: {s['mean_difference_db']:.3f} dB")
    print(f"classified changed: {s['changed_pixels']} px, ~{s['changed_area_km2']:.3f} km2 "
          f"({s['changed_percent']:.2f}% of analysed area) [estimate, threshold-dependent]")
    for name, path in run.paths.items():
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
