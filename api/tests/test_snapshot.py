from io import StringIO
from pathlib import Path

from app.catalog import EXAM_AIRPORTS
from app.ingestion.bts_ontime import aggregate_ontime_csv, finalize, merge_month
from app.ingestion.snapshot import build_catalog_snapshot, parse_ourairports_csv

FIXTURE = Path(__file__).parent / "fixtures" / "ourairports_sample.csv"
FAA = Path(__file__).parent / "fixtures" / "faa_sample.csv"


def test_ourairports_parser_keeps_commercial_and_iata_hubs() -> None:
    airports = parse_ourairports_csv(FIXTURE)
    assert "BOS" in airports
    assert "LHR" in airports
    assert "CDG" in airports
    assert "ZZZ" not in airports
    assert airports["LHR"]["kpi_tier"] == "identity"
    assert airports["LHR"]["country_iso"] == "GB"
    assert airports["BOS"]["region"] == "New England"


def test_snapshot_overlay_keeps_exam_scores(tmp_path: Path) -> None:
    output = tmp_path / "catalog.json"
    counts = build_catalog_snapshot(FIXTURE, faa_csv=FAA, output=output)
    assert counts["airports"] >= 3
    assert counts["exam_overlay"] == len(EXAM_AIRPORTS)
    payload = output.read_text(encoding="utf-8")
    assert '"BOS"' in payload
    assert '"JFK"' in payload
    assert '"LHR"' in payload
    assert '"ZZZ"' not in payload
    assert '"kpi_tier":"bts_scored"' in payload


def test_bts_ontime_aggregate_counts_delay_and_cancel() -> None:
    raw = StringIO(
        "ORIGIN,CANCELLED,DEP_DEL15,DEP_DELAY,TAXI_OUT\nBOS,0.00,1.00,22,18\nBOS,1.00,0.00,,\nBOS,0.00,0.00,4,12\n"
    )
    month = aggregate_ontime_csv(raw)
    totals: dict = {}
    merge_month(totals, month)
    rows = {row["iata"]: row for row in finalize(totals)}
    assert rows["BOS"]["departures"] == 3
    assert rows["BOS"]["cancelled_departures"] == 1
    assert rows["BOS"]["delayed_departures"] == 1
    assert rows["BOS"]["avg_taxi_out_minutes"] == 15.0
