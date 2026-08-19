#!/usr/bin/env python3
"""Static acceptance checks for the ROB-1291 P2 Kurly manifest."""

import json
import re
import sys
from collections import Counter
from pathlib import Path


JOB = Path('/Users/mgh3326/work/herdr-inbox/jobs/rob1291-p2-manifest-20260819-1703')
DATASET = Path('/Users/mgh3326/work/herdr-inbox/jobs/rob1291-p1-crawl-20260819-1637/dataset.json')


FLAVOR_EVIDENCE_TERMS = {
    'fruity': r'과일|베리|시트러스|감귤|자몽|레몬|라임|오렌지|사과|자두|복숭아|딸기|체리|파인애플|망고|살구|포도|무화과|건포도|리치|핵과|대추야자|천도복숭아|블루베리|블랙베리|블랙커런트|레드커런트|크랜베리|fruit|berry|citrus',
    'floral': r'꽃|플로럴|자스민|쟈스민|jasmine|floral',
    'sweet': r'캐러멜|카라멜|꿀|허니|설탕|슈가|시럽|당밀|단맛|달콤|달고|토피|마시멜로|크림 ?브륄레|바닐라|브라운 ?슈가|흑설탕|황설탕|케인 슈가|사탕수수|조청|메이플|sweet|caramel|honey|sugar|syrup',
    'nutty_cocoa': r'초콜릿|초콜렛|카카오|코코아|견과|아몬드|호두|헤이즐넛|마카다미아|피칸|캐슈|토피넛|고소하|고소한|넛티|nut|cocoa|chocolate',
    'spices': r'향신료|스파이시|spice|spicy',
    'roasted': r'로스티|로스티드|스모키|smoky|roasty',
    'cereal': r'곡물|곡류|누룽지|곡물차|몰트|크래커|cereal',
    'sour_fermented': r'와이니|와인|발효|ferment|wine',
    'green': r'허브|그린|herb|green',
}


def main() -> int:
    manifest = json.loads((JOB / 'manifest.json').read_text(encoding='utf-8'))
    db = json.loads((JOB / 'beans_db.json').read_text(encoding='utf-8'))
    crawl = json.loads(DATASET.read_text(encoding='utf-8'))
    entries = manifest['entries']
    products = {p['kurly_no']: p for p in crawl['products']}

    db_ids = [b['id'] for b in db]
    mentioned = [e['existing_bean_id'] for e in entries if e['action'] == 'link_existing']
    mentioned += manifest['no_kurly_presence']
    counts = Counter(mentioned)
    missing = sorted(set(db_ids) - set(counts))
    dup = sorted(bean_id for bean_id, count in counts.items() if count != 1)
    print(f"missing: {len(missing)}, dup: {len(dup)}")
    if missing:
        print('  missing_ids:', ','.join(missing))
    if dup:
        print('  duplicate_ids:', ','.join(dup))

    create = [e for e in entries if e['action'] == 'create_new']
    pairs = [(e['bean']['name'].lower(), e['bean']['roaster'].lower()) for e in create]
    pair_counts = Counter(pairs)
    create_dups = sorted(pair for pair, count in pair_counts.items() if count > 1)
    db_pairs = {(b['name'].lower(), b['roaster'].lower()) for b in db}
    db_collisions = sorted(set(pairs) & db_pairs)
    print(f"create_duplicate_pairs: {len(create_dups)}, db_collisions: {len(db_collisions)}")

    evidence_violations = []
    for entry in create:
        attrs = entry.get('attrs') or {}
        evidence = entry.get('attr_evidence') or {}
        source_url = attrs.get('source_url') or ''
        try:
            source_no = int(source_url.rstrip('/').split('/')[-1])
            source_text = products[source_no].get('detail_text') or ''
        except (ValueError, KeyError, IndexError):
            evidence_violations.append((entry['bean']['name'], 'source_url'))
            continue
        for axis in ('acidity', 'body', 'roast_level_ord', 'flavor_categories'):
            value = attrs.get(axis)
            if value is None or value == []:
                continue
            ev = evidence.get(axis)
            if not isinstance(ev, str) or not ev or ev not in source_text:
                evidence_violations.append((entry['bean']['name'], axis))
    print(f"violations: {len(evidence_violations)}")
    if evidence_violations:
        print('  evidence:', ', '.join(f'{name}:{axis}' for name, axis in evidence_violations))

    flavor_evidence_violations = []
    for entry in create:
        categories = (entry.get('attrs') or {}).get('flavor_categories') or []
        quote = (entry.get('attr_evidence') or {}).get('flavor_categories') or ''
        evidence_categories = {
            category for category, pattern in FLAVOR_EVIDENCE_TERMS.items()
            if re.search(pattern, quote, flags=re.IGNORECASE)
        }
        for category in sorted(set(categories) - evidence_categories):
            pattern = FLAVOR_EVIDENCE_TERMS.get(category)
            if pattern:
                flavor_evidence_violations.append((entry['bean']['name'], 'assigned_not_in_quote:' + category, quote))
        for category in sorted(evidence_categories - set(categories)):
            flavor_evidence_violations.append((entry['bean']['name'], 'quote_not_assigned:' + category, quote))
    print(f"flavor_evidence_violations: {len(flavor_evidence_violations)}")
    if flavor_evidence_violations:
        print('  flavor_evidence:', ', '.join(f'{name}:{category}' for name, category, _ in flavor_evidence_violations))

    name_violations = [
        e['bean']['name'] for e in create
        if re.search(r'\[|\]|[0-9]+ ?g|[0-9]+ ?kg|택1|X ?[0-9]+개', e['bean']['name'])
    ]
    print(f"name_regex_violations: {len(name_violations)}")
    if name_violations:
        print('  names:', ', '.join(name_violations))

    allowed = {'fruity', 'floral', 'sweet', 'nutty_cocoa', 'spices', 'roasted', 'cereal', 'sour_fermented', 'green'}
    attr_violations = []
    for entry in create:
        attrs = entry.get('attrs') or {}
        for axis in ('roast_level_ord', 'acidity', 'body'):
            value = attrs.get(axis)
            if value is not None and (not isinstance(value, int) or not 1 <= value <= 5):
                attr_violations.append((entry['bean']['name'], axis, value))
        invalid = sorted(set(attrs.get('flavor_categories') or []) - allowed)
        if invalid:
            attr_violations.append((entry['bean']['name'], 'flavor_categories', invalid))
    print(f"attribute_range_violations: {len(attr_violations)}")

    all_skus = [sku['no'] for p in crawl['products'] for sku in p.get('deal_products', [])]
    linked_skus = [link['sku_no'] for e in entries for link in e.get('purchase_links', [])]
    sku_counts = Counter(linked_skus)
    missing_skus = sorted(set(all_skus) - set(sku_counts))
    duplicate_skus = sorted(sku_no for sku_no, count in sku_counts.items() if count != 1)
    print(f"sku_coverage: expected={len(all_skus)}, linked={len(linked_skus)}, missing={len(missing_skus)}, dup={len(duplicate_skus)}")
    if missing_skus:
        print('  missing_skus:', ','.join(map(str, missing_skus)))
    if duplicate_skus:
        print('  duplicate_skus:', ','.join(map(str, duplicate_skus)))

    link_shape_violations = []
    for entry in entries:
        if entry['action'] == 'link_existing' and (entry.get('bean') is not None or entry.get('attrs') is not None):
            link_shape_violations.append(entry.get('existing_bean_id'))
    print(f"link_existing_shape_violations: {len(link_shape_violations)}")

    failures = bool(missing or dup or create_dups or db_collisions or evidence_violations or flavor_evidence_violations or name_violations or attr_violations or missing_skus or duplicate_skus or link_shape_violations)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
