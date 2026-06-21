#!/usr/bin/env python3
"""Monthly refresh of RSC BLE camera vendor lookup from Nordic Semiconductor DB"""
import json, urllib.request, os, sys, datetime

NORDIC_COMPANY_URL = 'https://raw.githubusercontent.com/NordicSemiconductor/bluetooth-numbers-database/master/v1/company_identifiers.json'
OUT_PATH = '/opt/rsc-api/data/ble-lookup.json'

def main():
    print(f'[{datetime.datetime.now()}] Starting BLE lookup refresh...')
    try:
        with urllib.request.urlopen(NORDIC_COMPANY_URL, timeout=30) as r:
            nordic_raw = json.loads(r.read())
    except Exception as e:
        print(f'ERROR fetching Nordic DB: {e}'); sys.exit(1)

    # Nordic format: list of {value: int, name: str}
    # Convert to our hex-keyed dict, filter to known camera/IoT vendors
    CAMERA_KEYWORDS = ['hikvision','dahua','axis','reolink','hanwha','bosch','pelco','flir',
        'avigilon','genetec','verkada','march','uniview','acti','geovision','mobotix',
        'vivotek','arecont','lorex','swann','annke','ezviz','foscam','wyze','eufy','anker',
        'ring','nest','arlo','blink','tapo','zmodo','amcrest','zosi','milesight','tvt',
        'tiandy','alarm.com','skybell','speco','lts','montavue','alibi','digital watchdog',
        'provision','sunell','zkteco','idis','lilin','vicon','cohu','cp plus','indigovision']

    with open(OUT_PATH, 'r') as f:
        current = json.load(f)

    updated_companies = dict(current.get('company_ids', {}))
    added = 0
    for entry in nordic_raw:
        name_lower = entry.get('name','').lower()
        if any(kw in name_lower for kw in CAMERA_KEYWORDS):
            hex_id = '0x' + format(entry['value'], '04X')
            if hex_id not in updated_companies:
                updated_companies[hex_id] = entry['name']
                added += 1

    current['company_ids'] = updated_companies
    current['_updated'] = str(datetime.date.today())
    current['_version'] = '1.0.' + str(added)

    with open(OUT_PATH, 'w') as f:
        json.dump(current, f, indent=2)

    print(f'Refresh complete. Added {added} new entries. Total: {len(updated_companies)} companies.')

main()
