"""Regenerate route geometry: python3 scripts/extract-motion-data.py /path/to/google_transit.zip"""
import csv, io, json, math, pathlib, statistics, sys, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
with zipfile.ZipFile(sys.argv[1]) as archive:
    def rows(name):
        return csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig')))
    trip_rows = list(rows('trips.txt'))
    trips = {r['trip_id']: r['shape_id'] for r in trip_rows if r['shape_id']}
    trip_routes = {r['trip_id']: r['route_id'] for r in trip_rows}
    stop_routes = {}
    shape_routes = {}
    for row in trip_rows:
        shape = row['shape_id']
        if not shape:
            continue
        shape_routes.setdefault(shape, set()).add(row['route_id'])
    shapes = {}
    for row in rows('shapes.txt'):
        shapes.setdefault(row['shape_id'], []).append((int(row['shape_pt_sequence']), float(row['shape_pt_lat']), float(row['shape_pt_lon'])))
    ranges = {}
    def seconds(value):
        h, m, s = map(int, value.split(':'))
        return h * 3600 + m * 60 + s
    for row in rows('stop_times.txt'):
        route = trip_routes.get(row['trip_id'])
        if route:
            stop_routes.setdefault(row['stop_id'], set()).add(route)
        if row['arrival_time'] and row['departure_time']:
            start, end = seconds(row['arrival_time']), seconds(row['departure_time'])
            old = ranges.get(row['trip_id'], (start, end))
            ranges[row['trip_id']] = (min(start, old[0]), max(end, old[1]))
    durations = {}
    for trip, (start, end) in ranges.items():
        if trip in trips and end > start:
            durations.setdefault(trips[trip], []).append(end - start)
    paths = {}
    for shape, points in shapes.items():
        ordered = sorted(points)
        distance, result = 0, []
        for _, lat, lng in ordered:
            if result:
                a, b, _ = result[-1]
                distance += math.hypot((lat-a)*111320, (lng-b)*111320*math.cos(math.radians((lat+a)/2)))
            result.append([lat, lng, round(distance, 1)])
        paths[shape] = {'routeIds': sorted(shape_routes.get(shape, [])), 'points': result, 'speed': min(30, distance/statistics.median(durations[shape])) if shape in durations else 0}
    (root/'data/trip-shapes.json').write_text(json.dumps(trips, separators=(',', ':'))+'\n')
    (root/'public/paths.json').write_text(json.dumps(paths, separators=(',', ':'))+'\n')
    stops = [{'id': r['stop_id'], 'name': r['stop_name'], 'lat': float(r['stop_lat']), 'lng': float(r['stop_lon']), 'routeIds': sorted(stop_routes[r['stop_id']])}
             for r in rows('stops.txt') if r['stop_id'] in stop_routes and r['stop_lat'] and r['stop_lon']]
    (root/'public/stops.json').write_text(json.dumps(stops, separators=(',', ':'))+'\n')
    print(f'Extracted {len(stops)} stops')
    print(f'Extracted {len(paths)} shapes and {len(trips)} trip mappings')
