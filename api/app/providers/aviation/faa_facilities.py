from __future__ import annotations

from typing import Any

from app.providers.base import ProviderResult, ResilientHTTPProvider

FACILITY_FIELDS = (
    "ARPT_ID,ICAO_ID,ARPT_NAME,CITY,STATE_CODE,COUNTY_NAME,OWNERSHIP_TYPE_CODE,FACILITY_USE_CODE,"
    "ARPT_STATUS,FAR_139_TYPE_CODE,FAR_139_CARRIER_SER_CODE,TWR_TYPE_CODE,ELEV,ACREAGE,FUEL_TYPES,"
    "LNDG_FEE_FLAG,USER_FEE_FLAG,JOINT_USE_FLAG,CUST_FLAG,MIL_LNDG_FLAG,ACTIVATION_DATE,"
    "ARFF_CERT_TYPE_DATE,TRNS_STRG_HGR_FLAG,TRNS_STRG_TIE_FLAG,EFF_DATE,LAST_INSPECTION,"
    "LAT_DECIMAL,LONG_DECIMAL"
)
RUNWAY_FIELDS = "ARPT_ID,RWY_ID,RWY_LEN,RWY_WIDTH,SURFACE_TYPE_CODE,COND,TREATMENT_CODE"


class FAAFacilitiesProvider(ResilientHTTPProvider):
    provider_name = "faa_facilities"
    cache_ttl_seconds = 24 * 3600
    endpoint = "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Aviation_Facilities/FeatureServer/0/query"
    runways_endpoint = (
        "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/Runways_View/FeatureServer/0/query"
    )

    def _runways(self, code: str) -> list[dict[str, Any]]:
        def transform(payload: dict[str, Any]) -> ProviderResult:
            rows = []
            for feature in payload.get("features") or []:
                attrs = feature.get("attributes") or {}
                rows.append(
                    {
                        "id": attrs.get("RWY_ID"),
                        "length_ft": attrs.get("RWY_LEN"),
                        "width_ft": attrs.get("RWY_WIDTH"),
                        "surface": attrs.get("SURFACE_TYPE_CODE"),
                        "condition": attrs.get("COND"),
                        "treatment": attrs.get("TREATMENT_CODE"),
                    }
                )
            rows.sort(key=lambda item: item.get("length_ft") or 0, reverse=True)
            return ProviderResult(self.provider_name, True, rows)

        result = self.request_json(
            f"{code}-runways",
            "GET",
            self.runways_endpoint,
            params={
                "f": "json",
                "where": f"ARPT_ID='{code}'",
                "outFields": RUNWAY_FIELDS,
                "returnGeometry": "false",
                "resultRecordCount": 20,
                "orderByFields": "RWY_LEN DESC",
            },
            transform=transform,
        )
        return list(result.data) if result.available and isinstance(result.data, list) else []

    def facility(self, code: str) -> ProviderResult:
        def transform(payload: dict[str, Any]) -> ProviderResult:
            features = payload.get("features", [])
            if not features:
                return ProviderResult(self.provider_name, False, None, reason="facility not found")
            attributes = features[0].get("attributes", {})
            runways = self._runways(code)
            longest = max((row.get("length_ft") or 0) for row in runways) if runways else None
            normalized = {
                "iata_code": attributes.get("ARPT_ID"),
                "icao_code": attributes.get("ICAO_ID"),
                "name": attributes.get("ARPT_NAME"),
                "city": attributes.get("CITY"),
                "state": attributes.get("STATE_CODE"),
                "county": attributes.get("COUNTY_NAME"),
                "ownership_type": attributes.get("OWNERSHIP_TYPE_CODE"),
                "facility_use": attributes.get("FACILITY_USE_CODE"),
                "status": attributes.get("ARPT_STATUS"),
                "far_139_class": attributes.get("FAR_139_TYPE_CODE"),
                "far_139_carrier_service": attributes.get("FAR_139_CARRIER_SER_CODE"),
                "tower_type": attributes.get("TWR_TYPE_CODE"),
                "elevation_ft": attributes.get("ELEV"),
                "acreage": attributes.get("ACREAGE"),
                "fuel_types": attributes.get("FUEL_TYPES"),
                "landing_fee": attributes.get("LNDG_FEE_FLAG"),
                "user_fee": attributes.get("USER_FEE_FLAG"),
                "joint_use": attributes.get("JOINT_USE_FLAG"),
                "customs": attributes.get("CUST_FLAG"),
                "military_landing": attributes.get("MIL_LNDG_FLAG"),
                "activation_date": attributes.get("ACTIVATION_DATE"),
                "arff_cert_date": attributes.get("ARFF_CERT_TYPE_DATE"),
                "hangar_storage": attributes.get("TRNS_STRG_HGR_FLAG"),
                "tie_down_storage": attributes.get("TRNS_STRG_TIE_FLAG"),
                "effective_date": attributes.get("EFF_DATE"),
                "last_inspection": attributes.get("LAST_INSPECTION"),
                "longest_runway_ft": longest or None,
                "runway_count": len(runways),
                "runways": runways,
                "location": {
                    "latitude": attributes.get("LAT_DECIMAL"),
                    "longitude": attributes.get("LONG_DECIMAL"),
                },
            }
            return ProviderResult(self.provider_name, True, normalized)

        return self.request_json(
            code,
            "GET",
            self.endpoint,
            params={
                "f": "json",
                "where": f"ARPT_ID='{code}'",
                "outFields": FACILITY_FIELDS,
                "returnGeometry": "false",
                "resultRecordCount": 1,
            },
            transform=transform,
        )
