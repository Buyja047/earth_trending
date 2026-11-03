"""NASA CMR discovery and authenticated LAADS Collection 6.1 downloads.

Only public metadata is requested without credentials. EARTHDATA_TOKEN is read
on the server and is never included in a URL, manifest, error or map payload.
"""
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

import requests

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
PRODUCTS = {"terra": ("MOD021KM", "MOD03", "MOD35_L2"),
            "aqua": ("MYD021KM", "MYD03", "MYD35_L2")}
FILENAME = re.compile(r"^(MOD|MYD)(021KM|03|35_L2)\.A(\d{7})\.(\d{4})\.061\.(\d{13})\.hdf$")
HDF4_MAGIC = b"\x0e\x03\x13\x01"


class ModisAccessError(RuntimeError):
    """Safe user-facing error; never wrap a requests exception with auth state."""


@dataclass(frozen=True)
class Granule:
    name: str
    size_mb: float = 0

    @property
    def product(self):
        return self.name.split(".")[0]

    @property
    def key(self):
        parts = self.name.split(".")
        return parts[0][:3], parts[1], parts[2]

    @property
    def acquired(self):
        return datetime.strptime(".".join(self.name.split(".")[1:3]), "A%Y%j.%H%M").replace(tzinfo=timezone.utc)

    @property
    def url(self):
        stamp = self.name.split(".")[1][1:]
        return ("https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/61/"
                f"{self.product}/{stamp[:4]}/{stamp[4:]}/{self.name}")


def validate_request(day, bbox, sensor="terra"):
    parsed = date.fromisoformat(day)
    if parsed < date(2000, 2, 24) or parsed > datetime.now(timezone.utc).date():
        raise ValueError("MODIS date is outside the observed record")
    if sensor not in ("terra", "aqua", "both"):
        raise ValueError("MODIS sensor must be terra, aqua or both")
    if len(bbox) != 4 or not all(math.isfinite(x) for x in bbox):
        raise ValueError("Invalid MODIS bounding box")
    w, s, e, n = bbox
    if not (-180 <= w < e <= 180 and -85 <= s < n <= 85):
        raise ValueError("Invalid MODIS bounding box")


def discover(day, bbox, sensor="terra", session=None, max_granules=32):
    """Pair every daytime L1B with the exact satellite/date/time GEO and mask.

    Missing companions fail the day rather than silently understating coverage.
    Use version=6.1 (CMR's version), distinct from filename token .061.
    """
    validate_request(day, bbox, sensor)
    session = session or requests.Session()
    sensors = ("terra", "aqua") if sensor == "both" else (sensor,)
    groups = []
    for platform in sensors:
        products = PRODUCTS[platform]
        by_product = {}
        for product in products:
            records = {}
            page = 1
            while True:
                # Short name/version/provider avoids relying on mutable concept IDs.
                params = {"short_name": product, "version": "6.1", "provider": "LAADS",
                          "temporal": f"{day}T00:00:00Z,{day}T23:59:59.999Z",
                          "bounding_box": ",".join(map(str, bbox)), "page_size": 200, "page_num": page}
                try:
                    response = session.get(CMR, params=params, timeout=(15, 60))
                    response.raise_for_status()
                    entries = response.json()["feed"]["entry"]
                except (requests.RequestException, ValueError, KeyError):
                    raise ModisAccessError("NASA CMR metadata search failed; retry later") from None
                for entry in entries:
                    name = entry.get("producer_granule_id", "")
                    if not FILENAME.fullmatch(name) or name.split(".")[0] != product:
                        continue
                    granule = Granule(name, float(entry.get("granule_size", 0)))
                    if granule.acquired.date().isoformat() != day:
                        continue
                    if product.endswith("021KM") and entry.get("day_night_flag", "").upper() == "NIGHT":
                        continue
                    old = records.get(granule.key)
                    if old is None or granule.name > old.name:
                        records[granule.key] = granule
                if len(entries) < 200:
                    break
                page += 1
                if page > 10:
                    raise ValueError("Too many MODIS metadata results; select a smaller region")
            by_product[product] = records
        for key, image in by_product[products[0]].items():
            if any(key not in by_product[p] for p in products[1:]):
                raise ModisAccessError("NASA has not published all matching MODIS geolocation/cloud files for this day; retry later")
            groups.append(tuple(by_product[p][key] for p in products))
    if not groups:
        raise ModisAccessError("No daytime MODIS Collection 6.1 granules are available for this date/region")
    if len(groups) > max_granules:
        raise ValueError("Too many MODIS granules; select a smaller region (no files were truncated)")
    return sorted(groups, key=lambda group: (group[0].acquired, group[0].name))


def _digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def download(granule, cache_dir, token=None, session=None):
    if not FILENAME.fullmatch(granule.name):
        raise ValueError("Invalid MODIS filename")
    folder = Path(cache_dir) / "raw"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / granule.name
    receipt = path.with_suffix(".receipt.json")
    if path.exists() and receipt.exists():
        try:
            meta = json.loads(receipt.read_text())
            if meta["bytes"] == path.stat().st_size and meta["sha256"] == _digest(path):
                return path
        except (ValueError, KeyError, OSError):
            pass
    token = token or os.environ.get("EARTHDATA_TOKEN")
    if not token:
        raise ModisAccessError("NASA Earthdata access is required: configure EARTHDATA_TOKEN on the server (never in the browser)")
    session = session or requests.Session()
    temp = path.with_suffix(".hdf.part")
    try:
        # requests removes Authorization on cross-host redirects. Never restore
        # it on a redirected URL, and never accept an OAuth HTML login as data.
        with session.get(granule.url, headers={"Authorization": "Bearer " + token},
                         stream=True, timeout=(15, 120)) as response:
            if response.status_code in (401, 403) or urlsplit(response.url).hostname == "urs.earthdata.nasa.gov":
                raise ModisAccessError("NASA Earthdata token is missing, expired or not authorized for LAADS downloads")
            if response.status_code != 200:
                raise ModisAccessError("NASA MODIS download is unavailable; retry later")
            if "text/" in response.headers.get("Content-Type", "").lower():
                raise ModisAccessError("NASA returned a login page instead of a MODIS file; check EARTHDATA_TOKEN")
            count = 0
            with temp.open("wb") as f:
                for block in response.iter_content(1024 * 1024):
                    if not block:
                        continue
                    if count == 0 and not block.startswith(HDF4_MAGIC):
                        raise ModisAccessError("NASA response is not a Collection 6.1 HDF4 file")
                    count += len(block)
                    if count > 800 * 1024 * 1024:
                        raise ModisAccessError("MODIS file exceeds the download limit")
                    f.write(block)
            expected = response.headers.get("Content-Length")
            if count < 4 or (expected and int(expected) != count):
                raise ModisAccessError("Incomplete MODIS download; retry later")
        digest = _digest(temp)
        temp.replace(path)
        receipt.write_text(json.dumps({**asdict(granule), "bytes": count, "sha256": digest}))
        return path
    except requests.RequestException:
        raise ModisAccessError("NASA MODIS download failed; check connectivity and Earthdata authorization") from None
    finally:
        temp.unlink(missing_ok=True)
