"""
What scripts/transit/osm-stations.mjs needs from an OpenStreetMap extract,
for when Overpass cannot be reached: the station entrances, the railway
routes, and the stops and platforms those routes list, as the elements
Overpass would answer with (JSON, `{"elements": [...]}`) on standard output.

Reads .osm.pbf files from https://download.openstreetmap.fr/extracts/ or
Geofabrik, a region at a time, in four passes over each, the filtering done
in libosmium:

    pip install osmium
    python3 scripts/transit/osm-extract.py kanto.osm.pbf > kanto.json
    node scripts/transit/osm-stations.mjs jp --from kanto.json kansai.json ...
"""
import json
import sys

import osmium

ROUTES = {'train', 'subway', 'light_rail', 'monorail', 'tram'}
ENTRANCES = ('subway_entrance', 'train_station_entrance')


def tags(obj):
    return {t.k: t.v for t in obj.tags}


def extract(path):
    out = []
    want_nodes, want_ways = set(), set()

    # Railway routes, with only the members a route stops at: its stops and platforms, in order.
    routes = osmium.FileProcessor(path, osmium.osm.RELATION).with_filter(osmium.filter.TagFilter(('type', 'route')))
    for rel in routes:
        if rel.tags.get('route') not in ROUTES:
            continue
        members = []
        for m in rel.members:
            if not (m.role.startswith('stop') or m.role.startswith('platform')) or m.type not in 'nw':
                continue
            members.append({'type': 'node' if m.type == 'n' else 'way', 'ref': m.ref, 'role': m.role})
            (want_nodes if m.type == 'n' else want_ways).add(m.ref)
        out.append({'type': 'relation', 'id': rel.id, 'tags': tags(rel), 'members': members})

    # The platform ways, and the nodes they are drawn with, for their middles.
    ways = {}
    for way in osmium.FileProcessor(path, osmium.osm.WAY).with_filter(osmium.filter.IdFilter(want_ways)):
        refs = [n.ref for n in way.nodes]
        ways[way.id] = (tags(way), refs)
        want_nodes.update(refs)

    # The stops, and every node a platform way needs.
    at = {}
    for node in osmium.FileProcessor(path, osmium.osm.NODE).with_filter(osmium.filter.IdFilter(want_nodes)):
        if not node.location.valid():
            continue
        at[node.id] = (node.location.lat, node.location.lon)
        if node.tags:
            out.append({'type': 'node', 'id': node.id, 'lat': node.location.lat, 'lon': node.location.lon, 'tags': tags(node)})
    for way_id, (way_tags, refs) in ways.items():
        points = [at[r] for r in refs if r in at]
        if not points:
            continue
        lats = [p[0] for p in points]
        lons = [p[1] for p in points]
        out.append({'type': 'way', 'id': way_id, 'tags': way_tags,
                    'center': {'lat': (min(lats) + max(lats)) / 2, 'lon': (min(lons) + max(lons)) / 2}})

    # Station entrances.
    entrances = osmium.FileProcessor(path, osmium.osm.NODE).with_filter(
        osmium.filter.TagFilter(*(('railway', kind) for kind in ENTRANCES)))
    for node in entrances:
        if node.location.valid():
            out.append({'type': 'node', 'id': node.id, 'lat': node.location.lat, 'lon': node.location.lon, 'tags': tags(node)})
    return out


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('Usage: python3 scripts/transit/osm-extract.py <region.osm.pbf>... > elements.json')
    elements = []
    for pbf in sys.argv[1:]:
        found = extract(pbf)
        print(f'{pbf}: {len(found)} elements', file=sys.stderr)
        elements.extend(found)
    json.dump({'elements': elements}, sys.stdout, ensure_ascii=False, separators=(',', ':'))
