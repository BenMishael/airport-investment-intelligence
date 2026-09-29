"""Parse the FAA commercial-service enplanement workbook without extra dependencies."""

from __future__ import annotations

import csv
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

import httpx

FAA_CY2025_XLSX = (
    "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/"
    "arp-cy2025-commercial-service-enplanements.xlsx"
)
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _cell_value(cell: ET.Element, shared: list[str]) -> str:
    node = cell.find("m:v", NS)
    raw = node.text if node is not None and node.text is not None else ""
    if cell.get("t") == "s" and raw.isdigit():
        index = int(raw)
        return shared[index] if 0 <= index < len(shared) else ""
    return raw


def parse_enplanement_xlsx(raw: bytes) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with zipfile.ZipFile(BytesIO(raw)) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("m:si", NS):
                shared.append("".join(node.text or "" for node in item.iter() if node.text))
        sheet = next(name for name in archive.namelist() if name.startswith("xl/worksheets/sheet"))
        root = ET.fromstring(archive.read(sheet))
        for row in root.findall("m:sheetData/m:row", NS):
            values = [_cell_value(cell, shared) for cell in row.findall("m:c", NS)]
            if len(values) < 11 or str(values[0]).strip() == "Rank":
                continue
            code = str(values[3]).strip().upper()
            if len(code) != 3 or not code.isalpha():
                continue
            try:
                cy25 = float(values[8])
                cy24 = float(values[9])
            except (TypeError, ValueError):
                continue
            if cy24 <= 0:
                continue
            growth = round((cy25 - cy24) / cy24 * 100, 2)
            rows.append(
                {
                    "iata": code,
                    "enplanements": str(int(cy25)),
                    "enplanement_growth_pct": str(growth),
                    "cy24_enplanements": str(int(cy24)),
                }
            )
    return rows


def download_faa_enplanements(destination: Path, url: str = FAA_CY2025_XLSX) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    response = httpx.get(url, timeout=60.0, follow_redirects=True)
    response.raise_for_status()
    rows = parse_enplanement_xlsx(response.content)
    with destination.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["iata", "enplanements", "enplanement_growth_pct", "cy24_enplanements"]
        )
        writer.writeheader()
        writer.writerows(rows)
    return destination
