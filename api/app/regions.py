"""Region, coast, country, and continent matching for catalog ranking."""

from __future__ import annotations

from typing import Any

from .catalog import AIRPORTS

EAST_COAST_STATES = {
    "ME",
    "NH",
    "MA",
    "RI",
    "CT",
    "NY",
    "NJ",
    "DE",
    "MD",
    "DC",
    "VA",
    "NC",
    "SC",
    "GA",
    "FL",
}

NEW_ENGLAND_STATES = {"ME", "NH", "VT", "MA", "RI", "CT"}
WEST_STATES = {"CA", "OR", "WA", "NV", "HI"}
ALASKA_STATES = {"AK"}

US_REGION_BY_STATE = {
    **{state: "New England" for state in NEW_ENGLAND_STATES},
    **{state: "West" for state in WEST_STATES},
    **{state: "Alaska" for state in ALASKA_STATES},
    "NY": "Mid-Atlantic",
    "NJ": "Mid-Atlantic",
    "PA": "Mid-Atlantic",
    "DE": "South Atlantic",
    "MD": "South Atlantic",
    "DC": "South Atlantic",
    "VA": "South Atlantic",
    "WV": "South Atlantic",
    "NC": "South Atlantic",
    "SC": "South Atlantic",
    "GA": "South Atlantic",
    "FL": "South Atlantic",
    "AL": "East South Central",
    "KY": "East South Central",
    "MS": "East South Central",
    "TN": "East South Central",
    "AR": "West South Central",
    "LA": "West South Central",
    "OK": "West South Central",
    "TX": "West South Central",
    "IL": "East North Central",
    "IN": "East North Central",
    "MI": "East North Central",
    "OH": "East North Central",
    "WI": "East North Central",
    "IA": "West North Central",
    "KS": "West North Central",
    "MN": "West North Central",
    "MO": "West North Central",
    "NE": "West North Central",
    "ND": "West North Central",
    "SD": "West North Central",
    "AZ": "Mountain",
    "CO": "Mountain",
    "ID": "Mountain",
    "MT": "Mountain",
    "NM": "Mountain",
    "UT": "Mountain",
    "WY": "Mountain",
    "PR": "Caribbean",
}

CONTINENT_LABELS = {
    "AF": "Africa",
    "AN": "Antarctica",
    "AS": "Asia",
    "EU": "Europe",
    "NA": "North America",
    "OC": "Oceania",
    "SA": "South America",
}

REGION_ALIASES = {
    "new england": "New England",
    "northeast": "New England",
    "east coast": "East Coast",
    "east-coast": "East Coast",
    "eastern united states": "East Coast",
    "eastern us": "East Coast",
    "atlantic": "East Coast",
    "west": "West",
    "west coast": "West",
    "pacific": "West",
    "alaska": "Alaska",
    "mid-atlantic": "Mid-Atlantic",
    "mid atlantic": "Mid-Atlantic",
    "south atlantic": "South Atlantic",
    "europe": "Europe",
    "asia": "Asia",
    "africa": "Africa",
    "oceania": "Oceania",
    "australia": "Australia",
    "north america": "North America",
    "south america": "South America",
    "united states": "United States",
    "usa": "United States",
    "u.s.": "United States",
    "u.s.a.": "United States",
    "america": "United States",
    "uk": "United Kingdom",
    "u.k.": "United Kingdom",
    "great britain": "United Kingdom",
    "britain": "United Kingdom",
    "england": "United Kingdom",
}

COUNTRY_ALIASES = {
    "uk": "United Kingdom",
    "u.k.": "United Kingdom",
    "great britain": "United Kingdom",
    "britain": "United Kingdom",
    "usa": "United States",
    "us": "United States",
    "u.s.": "United States",
    "u.s.a.": "United States",
}

TYPE_RANK = {
    "large_airport": 0,
    "medium_airport": 1,
    "small_airport": 2,
    "seaplane_base": 3,
}


def us_region_for_state(state: str | None) -> str:
    if not state:
        return "United States"
    return US_REGION_BY_STATE.get(state.upper(), "United States")


def _catalog_countries() -> dict[str, str]:
    names: dict[str, str] = {}
    for airport in AIRPORTS.values():
        country = str(airport.get("country") or "").strip()
        iso = str(airport.get("country_iso") or "").strip().upper()
        if country:
            names[country.lower()] = country
        if iso:
            names[iso.lower()] = country or iso
    return names


def resolve_region(value: str | None) -> str:
    if not value:
        return "New England"
    lowered = value.strip().lower()
    if lowered in REGION_ALIASES:
        return REGION_ALIASES[lowered]
    for alias, region in sorted(REGION_ALIASES.items(), key=lambda item: -len(item[0])):
        if alias in lowered:
            return region
    countries = _catalog_countries()
    if lowered in COUNTRY_ALIASES:
        mapped = COUNTRY_ALIASES[lowered]
        return countries.get(mapped.lower(), mapped)
    if lowered in countries:
        return countries[lowered]
    for name, canonical in sorted(countries.items(), key=lambda item: -len(item[0])):
        if len(name) < 4:
            continue
        if name in lowered:
            return canonical
    for region in {str(airport.get("region") or "") for airport in AIRPORTS.values()}:
        if region and region.lower() == lowered:
            return region
    return value.strip()


def airport_in_scope(airport: dict[str, Any], resolved: str) -> bool:
    lowered = resolved.lower()
    if resolved == "East Coast":
        return str(airport.get("country_iso") or "") == "US" and str(airport.get("state") or "") in EAST_COAST_STATES
    if str(airport.get("region") or "").lower() == lowered:
        return True
    if str(airport.get("country") or "").lower() == lowered:
        return True
    continent = CONTINENT_LABELS.get(str(airport.get("continent") or "").upper(), "")
    return continent.lower() == lowered


def scoped_airports(resolved: str) -> list[tuple[str, dict[str, Any]]]:
    return [(code, airport) for code, airport in AIRPORTS.items() if airport_in_scope(airport, resolved)]


def identity_sort_key(item: tuple[str, dict[str, Any]]) -> tuple[int, str, str]:
    code, airport = item
    kind = TYPE_RANK.get(str(airport.get("airport_type") or ""), 9)
    return (kind, str(airport.get("name") or ""), code)
