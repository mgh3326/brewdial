"""Read xBloom brew records once and send recent records to BrewDial."""

from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from urllib.request import Request, urlopen
from unittest.mock import patch

from xbloom_ble.cloud import XBloomCloud, encrypt_form

API_PATH = "/api/agent/xbloom/brew-records"
DEFAULT_API_URL = "http://127.0.0.1:8021"
DEFAULT_SINCE_HOURS = 72.0
AUTH_ERROR_CODES = {20003}
AUTH_MESSAGE = "xBloom 인증이 만료되었거나 설정되지 않았습니다. `xbloom cloud login`을 실행하고 Infisical의 XBLOOM_MEMBER_ID와 XBLOOM_TOKEN을 갱신하세요."


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
    return isinstance(value, dict) and all(key in value for key in ("tableId", "brewTime", "lineChartData"))


def _flatten_records(value: Any) -> Iterable[Dict[str, Any]]:
    if _is_record(value):
        yield value
    elif isinstance(value, dict):
        for nested in value.values():
            yield from _flatten_records(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _flatten_records(nested)


def fetch_records(client: XBloomCloud) -> List[Dict[str, Any]]:
    """Make the single permitted read call and flatten its grouped response."""
    client._require_auth()
    form = client._base_form()
    response = client._post("tuBrewRecordList.thtml", encrypt_form(form), encrypted=True)
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
    with urlopen(request, timeout=30) as response:
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

    client = client_factory(member_id, token)
    records = fetch_records(client)
    current_time = time.time() if now is None else now
    cutoff_ms = (current_time - since_hours * 3600) * 1000
    recent = [record for record in records if _is_recent(record, cutoff_ms)]
    counts = {"fetched": len(records), "selected": len(recent), "inserted": 0, "duplicate": 0, "skipped": 0}
    api_url = values.get("BREWDIAL_API_URL", DEFAULT_API_URL)
    for start in range(0, len(recent), 200):
        result = post_batch(api_url, agent_token, recent[start : start + 200])
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
    print(
        "xBloom 수집 완료: 조회 {fetched}건, 전송 {selected}건, 신규 {inserted}건, 중복 {duplicate}건, 건너뜀 {skipped}건".format(**counts)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
