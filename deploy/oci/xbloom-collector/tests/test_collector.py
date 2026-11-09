import os
from pathlib import Path
from unittest.mock import patch

import pytest

import xbloom_collector as collector
from xbloom_ble.cloud import XBloomCloud


BASE_ENV = {
    "XBLOOM_MEMBER_ID": "123456789",
    "XBLOOM_TOKEN": "fake-xbloom-token-value",
    "BREWDIAL_AGENT_TOKEN": "fake-brewdial-agent-token-value",
}
FIXTURE_ONLY = "synthetic-fixture-marker"


def raw_record(record_id, timestamp, *, device_marker=FIXTURE_ONLY):
    return {
        "tableId": str(record_id),
        "createTimeStamp": timestamp,
        "brewTime": 180,
        "recipeName": "Handmade synthetic fixture",
        "recipeVo": {
            "tableId": "9081726354", "dose": 18, "deviceId": device_marker,
            "pourList": [{"volume": 220, "temperature": 92, "flowRate": 3, "pattern": 2, "deviceId": device_marker}],
        },
        "lineChartData": "[[0,0],[220,120],[220,200]]",
        "deviceId": device_marker,
        "mac": device_marker,
        "memberId": device_marker,
    }


def fake_client(monkeypatch, response, calls):
    def post(self, endpoint, body, *, encrypted):
        calls.append((endpoint, body, encrypted))
        return response

    monkeypatch.setattr(XBloomCloud, "_post", post)
    monkeypatch.setattr(XBloomCloud, "_check", staticmethod(lambda response, _what: response))
    with patch.dict(os.environ, {}, clear=True):
        return XBloomCloud(member_id=123456789, token=BASE_ENV["XBLOOM_TOKEN"], auth_path=Path("/dev/null"))


def test_invariant_1_reads_only_tu_brew_record_list_once(monkeypatch):
    calls = []
    record = raw_record("9000000001", 1_800_000_000_000)
    client = fake_client(monkeypatch, {"result": "success", "gList": [{"records": [record]}]}, calls)

    result = collector.fetch_records(client)

    assert result == [record]
    assert len(calls) == 1
    assert calls[0][0] == "tuBrewRecordList.thtml"
    assert calls[0][2] is True


@pytest.mark.parametrize("missing", ["XBLOOM_MEMBER_ID", "XBLOOM_TOKEN"])
def test_invariant_2_missing_xbloom_credentials_exits_two_without_secrets(monkeypatch, capsys, missing):
    env = dict(BASE_ENV)
    env.pop(missing)
    monkeypatch.setattr(os, "environ", env)

    assert collector.main() == 2
    output = capsys.readouterr()
    assert "xbloom cloud login" in output.err
    assert "Infisical" in output.err
    assert BASE_ENV["XBLOOM_MEMBER_ID"] not in output.out + output.err
    assert BASE_ENV["XBLOOM_TOKEN"] not in output.out + output.err
    assert BASE_ENV["BREWDIAL_AGENT_TOKEN"] not in output.out + output.err
    assert output.out == ""
    assert len(output.err.splitlines()) == 1


def test_invariant_2_rejected_token_exits_two_without_exception_details(monkeypatch, capsys):
    calls = []
    client = fake_client(monkeypatch, {"result": "fail", "resultCode": 20003, "info": BASE_ENV["XBLOOM_TOKEN"]}, calls)
    monkeypatch.setattr(collector, "_new_client", lambda _member, _token: client)
    monkeypatch.setattr(collector, "_post_batch", lambda *_args: pytest.fail("must not post"))
    monkeypatch.setattr(os, "environ", dict(BASE_ENV))

    assert collector.main() == 2
    output = capsys.readouterr()
    assert output.out == ""
    assert "xbloom cloud login" in output.err
    assert BASE_ENV["XBLOOM_TOKEN"] not in output.out + output.err
    assert BASE_ENV["BREWDIAL_AGENT_TOKEN"] not in output.out + output.err
    assert BASE_ENV["XBLOOM_MEMBER_ID"] not in output.out + output.err
    assert len(output.err.splitlines()) == 1


def test_invariant_3_generic_failure_never_prints_any_injected_secret(monkeypatch, capsys):
    secrets = dict(BASE_ENV)
    monkeypatch.setattr(os, "environ", secrets)
    monkeypatch.setattr(collector, "collect", lambda: (_ for _ in ()).throw(RuntimeError(" ".join(secrets.values()))))

    assert collector.main() == 1
    output = capsys.readouterr()
    assert all(secret not in output.out + output.err for secret in secrets.values())
    assert output.out == ""
    assert len(output.err.splitlines()) == 1


def test_since_filter_batches_at_200_and_posts_counts_only(monkeypatch, capsys):
    now = 1_800_000_000
    records = [raw_record("9000000000", int((now - 3600) * 1000))]
    records.extend(raw_record(str(9000000001 + i), int((now - 3600) * 1000)) for i in range(200))
    records.append(raw_record("9000000999", int((now - 200 * 3600) * 1000)))
    calls = []
    client = fake_client(monkeypatch, {"result": "success", "gList": records}, calls)
    monkeypatch.setattr(collector, "_new_client", lambda _member, _token: client)
    batches = []

    def post(api_url, agent_token, batch):
        batches.append((api_url, agent_token, batch))
        return {"inserted": [str(i) for i in range(len(batch))], "duplicate": [], "skipped": []}

    counts = collector.collect(dict(BASE_ENV), post_batch=post, now=now)

    assert [len(batch[2]) for batch in batches] == [200, 1]
    assert all(batch[0] == collector.DEFAULT_API_URL for batch in batches)
    assert all(batch[1] == BASE_ENV["BREWDIAL_AGENT_TOKEN"] for batch in batches)
    assert counts == {"fetched": 202, "selected": 201, "outside_since": 1, "inserted": 201, "duplicate": 0, "skipped": 0}
    assert all("deviceId" not in record and "mac" not in record and "memberId" not in record for batch in batches for record in batch[2])
    assert all("deviceId" not in record["recipeVo"] for batch in batches for record in batch[2])
    assert all("deviceId" not in pour for batch in batches for record in batch[2] for pour in record["recipeVo"]["pourList"])
    monkeypatch.setattr(collector, "collect", lambda: counts)
    assert collector.main() == 0
    output = capsys.readouterr()
    assert output.err == ""
    assert "조회 202건" in output.out
    assert "전송 201건" in output.out
    assert "기간 이전 1건" in output.out
    assert FIXTURE_ONLY not in output.out
    assert BASE_ENV["XBLOOM_TOKEN"] not in output.out
    assert BASE_ENV["BREWDIAL_AGENT_TOKEN"] not in output.out
    assert BASE_ENV["XBLOOM_MEMBER_ID"] not in output.out


def test_since_window_is_overridable():
    now = 1_800_000_000
    client = type("Client", (), {"_require_auth": lambda _self: None, "_base_form": lambda _self: {}, "_post": lambda *_args, **_kwargs: None})()
    client._post = lambda *_args, **_kwargs: {"result": "success", "gList": [raw_record("1", int((now - 5 * 3600) * 1000))]}
    client._check = lambda response, _what: response
    batches = []

    counts = collector.collect(dict(BASE_ENV, XBLOOM_COLLECT_SINCE_HOURS="6"), client_factory=lambda *_: client, post_batch=lambda _url, _token, batch: batches.append(batch) or {"inserted": [], "duplicate": [], "skipped": []}, now=now)

    assert counts["selected"] == 1
    assert counts["outside_since"] == 0
    assert len(batches) == 1


def test_no_records_produce_no_empty_post(monkeypatch):
    calls = []
    client = fake_client(monkeypatch, {"result": "success", "gList": []}, calls)
    monkeypatch.setattr(collector, "_new_client", lambda *_args: client)
    monkeypatch.setattr(collector, "_post_batch", lambda *_args: pytest.fail("must not post"))

    assert collector.collect(dict(BASE_ENV), now=1_800_000_000)["selected"] == 0


def test_record_missing_curve_is_forwarded_and_counted_as_skipped(monkeypatch):
    malformed = raw_record("9000000009", 1_800_000_000_000)
    del malformed["lineChartData"]
    calls = []
    client = fake_client(monkeypatch, {"result": "success", "gList": [malformed]}, calls)
    monkeypatch.setattr(collector, "_new_client", lambda *_args: client)
    batches = []

    counts = collector.collect(dict(BASE_ENV), post_batch=lambda _url, _token, batch: batches.append(batch) or {"inserted": [], "duplicate": [], "skipped": [{"index": 0, "reason": "broken_run"}]}, now=1_800_000_000)

    assert counts == {"fetched": 1, "selected": 1, "outside_since": 0, "inserted": 0, "duplicate": 0, "skipped": 1}
    sent = batches[0][0]
    assert "lineChartData" not in sent
    assert "deviceId" not in sent["recipeVo"]
    assert all("deviceId" not in pour for pour in sent["recipeVo"]["pourList"])


@pytest.mark.parametrize("url", ["http://collector.invalid", "http://user:secret@localhost:8021", "https://localhost:8021/path?token=secret"])
def test_api_url_must_be_tls_or_loopback_and_cannot_embed_credentials(monkeypatch, url):
    monkeypatch.setattr(collector, "_new_client", lambda *_args: pytest.fail("validate URL before xBloom fetch"))

    with pytest.raises(ValueError):
        collector.collect(dict(BASE_ENV, BREWDIAL_API_URL=url), now=1_800_000_000)


def test_public_https_api_url_is_allowed():
    assert collector._validated_api_url("https://api.example.test/") == "https://api.example.test"
