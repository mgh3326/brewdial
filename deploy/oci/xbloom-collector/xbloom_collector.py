"""Read xBloom brew records once and send recent records to BrewDial."""

from __future__ import annotations

import json
import ipaddress
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from unittest.mock import patch

from xbloom_ble.cloud import XBloomCloud, encrypt_form

API_PATH = "/api/agent/xbloom/brew-records"
DEFAULT_API_URL = "http://127.0.0.1:8021"
DEFAULT_SINCE_HOURS = 72.0
AUTH_ERROR_CODES = {20003}
AUTH_MESSAGE = "xBloom 인증이 만료되었거나 설정되지 않았습니다. `xbloom cloud login`을 실행하고 Infisical의 XBLOOM_MEMBER_ID와 XBLOOM_TOKEN을 갱신하세요."
RECIPE_FIELDS = ("tableId", "dose", "grinderSize", "rpm", "cupType", "isEnableBypassWater", "bypassVolume", "bypassTemp", "pourList")
POUR_FIELDS = ("volume", "temperature", "flowRate", "pattern", "pausing", "isEnableVibrationBefore", "isEnableVibrationAfter")


class XBloomAuthenticationError(Exception):
    """The operator must refresh the manually provisioned xBloom token."""


def _required_env(env: Dict[str, str]) -> Tuple[int, str, str]:
    member_id = env.get("XBLOOM_MEMBER_ID", "").strip()
    token = env.get("XBLOOM_TOKEN", "").strip()
    agent_token = env.get("BREWDIAL_AGENT_TOKEN", "").strip()
    if not member_id or not token:
        raise XBloomAuthenticationError()
    if not member_id.isdecimal() or not agent_token:
        raise ValueError("collector configuration is incomplete")
    return int(member_id), token, agent_token


def _new_client(member_id: int, token: str) -> XBloomCloud:
    # The pinned client supports legacy login environment variables and token caches.
    # Hide inherited environment values while constructing it, and provide both
    # credentials so its cache loader and every login path remain unused.
    with patch.dict(os.environ, {}, clear=True):
        return XBloomCloud(member_id=member_id, token=token, auth_path=Path("/dev/null"))


def _is_record(value: Any) -> bool:
    record_fields = ("createTimeStamp", "brewTime", "recipeName", "recipeVo", "lineChartData")
    return isinstance(value, dict) and any(key in value for key in record_fields)


def _flatten_records(value: Any) -> Iterable[Dict[str, Any]]:
    if _is_record(value):
        yield value
    elif isinstance(value, dict):
        for nested in value.values():
            yield from _flatten_records(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _flatten_records(nested)


def _valid_scalar(value: Any) -> bool:
    return not isinstance(value, bool) and (
        isinstance(value, (str, int)) or isinstance(value, float) and math.isfinite(value)
    )


def _allowlisted_record(record: Dict[str, Any]) -> Dict[str, Any]:
    result = {
        key: value
        for key in ("tableId", "createTimeStamp", "brewTime", "recipeName")
        if key in record and _valid_scalar(value := record[key])
        and (key != "recipeName" or isinstance(value, str))
    }
    curve = record.get("lineChartData")
    if isinstance(curve, str):
        try:
            curve = json.loads(curve, parse_constant=lambda token: (_ for _ in ()).throw(ValueError(token)))
        except (TypeError, ValueError):
            curve = None
    if isinstance(curve, list) and curve and all(
        isinstance(point, list)
        and len(point) == 2
        and all(
            isinstance(value, int) and not isinstance(value, bool)
            or isinstance(value, float) and math.isfinite(value)
            for value in point
        )
        for point in curve
    ):
        result["lineChartData"] = json.dumps(curve, separators=(",", ":"), allow_nan=False)
    recipe = record.get("recipeVo")
    if isinstance(recipe, dict):
        allowed_recipe = {
            key: recipe[key]
            for key in RECIPE_FIELDS
            if key in recipe and key != "pourList"
            and (_valid_scalar(recipe[key]) or key == "isEnableBypassWater" and isinstance(recipe[key], bool))
        }
        pours = recipe.get("pourList")
        if isinstance(pours, list):
            allowed_recipe["pourList"] = [
                {
                    key: pour[key]
                    for key in POUR_FIELDS
                    if key in pour
                    and (_valid_scalar(pour[key]) or key in ("isEnableVibrationBefore", "isEnableVibrationAfter") and isinstance(pour[key], bool))
                }
                if isinstance(pour, dict) else {}
                for pour in pours
            ]
        result["recipeVo"] = allowed_recipe
    return result


MAX_BATCH_BYTES = 900 * 1024


def _batches(records: List[Dict[str, Any]]) -> Iterable[List[Dict[str, Any]]]:
    batch: List[Dict[str, Any]] = []
    for record in records:
        candidate = batch + [record]
        size = len(json.dumps({"records": candidate}, ensure_ascii=False).encode("utf-8"))
        if batch and (len(candidate) > 200 or size > MAX_BATCH_BYTES):
            yield batch
            batch = [record]
            size = len(json.dumps({"records": batch}, ensure_ascii=False).encode("utf-8"))
        else:
            batch = candidate
        if size > MAX_BATCH_BYTES:
            batch = []
    if batch:
        yield batch


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _validated_api_url(value: str) -> str:
    parts = urlsplit(value)
    host = parts.hostname
    if not parts.netloc or host is None or parts.path not in ("", "/") or parts.username is not None or parts.password is not None or parts.query or parts.fragment:
        raise ValueError("BREWDIAL_API_URL must be an origin URL without credentials, query, or fragment")
    is_loopback = host.lower() == "localhost"
    try:
        is_loopback = is_loopback or ipaddress.ip_address(host).is_loopback
    except ValueError:
        pass
    if parts.scheme != "https" and not (parts.scheme == "http" and is_loopback):
        raise ValueError("BREWDIAL_API_URL must use HTTPS or a loopback HTTP address")
    return value.rstrip("/")


def fetch_records(client: XBloomCloud) -> List[Dict[str, Any]]:
    """Make the single permitted read call and flatten its grouped response."""
    client._require_auth()
    form = client._base_form()
    response = client._post("tuBrewRecordList.tuhtml", encrypt_form(form), encrypted=True)
    if str(response.get("resultCode")) in {str(code) for code in AUTH_ERROR_CODES}:
        raise XBloomAuthenticationError()
    client._check(response, "list_brew_records")
    return list(_flatten_records(response.get("gList", [])))


def _is_recent(record: Dict[str, Any], cutoff_ms: float) -> bool:
    timestamp = record.get("createTimeStamp")
    try:
        value = float(timestamp)
    except (TypeError, ValueError):
        return True  # let the API report malformed records
    return not math.isfinite(value) or value >= cutoff_ms


def _post_batch(api_url: str, agent_token: str, records: List[Dict[str, Any]]) -> Dict[str, Any]:
    payload = json.dumps({"records": records}, ensure_ascii=False).encode("utf-8")
    request = Request(
        api_url.rstrip("/") + API_PATH,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + agent_token},
        method="POST",
    )
    with build_opener(_NoRedirectHandler()).open(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def collect(
    env: Optional[Dict[str, str]] = None,
    *,
    client_factory: Callable[[int, str], XBloomCloud] = _new_client,
    post_batch: Callable[[str, str, List[Dict[str, Any]]], Dict[str, Any]] = _post_batch,
    now: Optional[float] = None,
) -> Dict[str, int]:
    values = os.environ if env is None else env
    member_id, token, agent_token = _required_env(dict(values))
    try:
        since_hours = float(values.get("XBLOOM_COLLECT_SINCE_HOURS", str(DEFAULT_SINCE_HOURS)))
    except (TypeError, ValueError):
        raise ValueError("XBLOOM_COLLECT_SINCE_HOURS must be a positive number") from None
    if not math.isfinite(since_hours) or since_hours <= 0:
        raise ValueError("XBLOOM_COLLECT_SINCE_HOURS must be a positive number")

    api_url = _validated_api_url(values.get("BREWDIAL_API_URL", DEFAULT_API_URL))
    client = client_factory(member_id, token)
    records = fetch_records(client)
    current_time = time.time() if now is None else now
    cutoff_ms = (current_time - since_hours * 3600) * 1000
    recent = [_allowlisted_record(record) for record in records if _is_recent(record, cutoff_ms)]
    outside_since = len(records) - len(recent)
    counts = {"fetched": len(records), "selected": len(recent), "outside_since": outside_since, "inserted": 0, "duplicate": 0, "skipped": 0}
    batches = list(_batches(recent))
    counts["selected"] = sum(len(batch) for batch in batches)
    counts["skipped"] += len(recent) - counts["selected"]
    for batch in batches:
        result = post_batch(api_url, agent_token, batch)
        counts["inserted"] += len(result.get("inserted", []))
        counts["duplicate"] += len(result.get("duplicate", []))
        counts["skipped"] += len(result.get("skipped", []))
    return counts


def main() -> int:
    try:
        counts = collect()
    except XBloomAuthenticationError:
        print(AUTH_MESSAGE, file=sys.stderr)
        return 2
    except Exception:
        # Never print exception text: HTTP/client exceptions can contain credentials.
        print("xBloom 수집에 실패했습니다. 설정과 서비스 상태를 확인하세요.", file=sys.stderr)
        return 1
    print("xBloom 수집 완료: 조회 {fetched}건, 전송 {selected}건, 기간 이전 {outside_since}건, 신규 {inserted}건, 중복 {duplicate}건, 건너뜀 {skipped}건".format(**counts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
