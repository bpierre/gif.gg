#!/usr/bin/env python3
"""Profile GIF files from a streaming tar archive without extracting them."""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import tarfile
from collections import Counter
from typing import BinaryIO, Iterable


MAX_PROFILE_BYTES = 256 * 1024 * 1024
PERCENTILES = (0.5, 0.9, 0.95, 0.99, 0.999)


class GifParseError(ValueError):
    pass


def require(data: bytes, offset: int, length: int, context: str) -> None:
    if offset + length > len(data):
        raise GifParseError(f"truncated_{context}")


def skip_color_table(data: bytes, offset: int, packed: int, context: str) -> int:
    if packed & 0x80:
        table_size = 3 * (1 << ((packed & 0x07) + 1))
        require(data, offset, table_size, context)
        return offset + table_size
    return offset


def skip_sub_blocks(data: bytes, offset: int, context: str) -> int:
    while True:
        require(data, offset, 1, context)
        block_size = data[offset]
        offset += 1
        if block_size == 0:
            return offset
        require(data, offset, block_size, context)
        offset += block_size


def parse_gif(data: bytes) -> dict[str, object]:
    require(data, 0, 13, "header")
    version_bytes = data[:6]
    if version_bytes not in (b"GIF87a", b"GIF89a"):
        raise GifParseError("invalid_signature")

    version = version_bytes.decode("ascii")
    width, height = struct.unpack_from("<HH", data, 6)
    if width == 0 or height == 0:
        raise GifParseError("zero_canvas_dimension")

    offset = skip_color_table(data, 13, data[10], "global_color_table")
    frames = 0
    duration_cs = 0
    pending_delay_cs = 0
    out_of_bounds_frames = 0
    trailer_found = False

    while offset < len(data):
        marker = data[offset]
        offset += 1

        if marker == 0x3B:
            trailer_found = True
            break

        if marker == 0x21:
            require(data, offset, 1, "extension_label")
            label = data[offset]
            offset += 1

            if label == 0xF9:
                require(data, offset, 1, "graphic_control_size")
                block_size = data[offset]
                offset += 1
                if block_size != 4:
                    raise GifParseError("invalid_graphic_control_size")
                require(data, offset, 5, "graphic_control")
                pending_delay_cs = struct.unpack_from("<H", data, offset + 1)[0]
                offset += 4
                if data[offset] != 0:
                    raise GifParseError("invalid_graphic_control_terminator")
                offset += 1
            else:
                offset = skip_sub_blocks(data, offset, "extension_data")
            continue

        if marker == 0x2C:
            require(data, offset, 9, "image_descriptor")
            left, top, frame_width, frame_height = struct.unpack_from("<HHHH", data, offset)
            packed = data[offset + 8]
            offset += 9
            if frame_width == 0 or frame_height == 0:
                raise GifParseError("zero_frame_dimension")
            if left + frame_width > width or top + frame_height > height:
                out_of_bounds_frames += 1
            offset = skip_color_table(data, offset, packed, "local_color_table")
            require(data, offset, 1, "lzw_code_size")
            offset += 1
            offset = skip_sub_blocks(data, offset, "image_data")
            frames += 1
            duration_cs += pending_delay_cs
            pending_delay_cs = 0
            continue

        raise GifParseError(f"unexpected_block_0x{marker:02x}")

    if not trailer_found:
        raise GifParseError("missing_trailer")
    if frames == 0:
        raise GifParseError("no_frames")

    return {
        "valid": True,
        "version": version,
        "width": width,
        "height": height,
        "frames": frames,
        "duration_cs": duration_cs,
        "out_of_bounds_frames": out_of_bounds_frames,
        "trailing_bytes": len(data) - offset,
    }


def scan_tar(stream: BinaryIO) -> None:
    with tarfile.open(fileobj=stream, mode="r|") as archive:
        for member in archive:
            if not member.isfile() or not member.name.lower().endswith(".gif"):
                continue

            record: dict[str, object] = {
                "path": member.name,
                "size": member.size,
            }
            if member.size > MAX_PROFILE_BYTES:
                record.update(
                    valid=False,
                    error="profile_memory_limit",
                    profile_limit=MAX_PROFILE_BYTES,
                )
                print(json.dumps(record, separators=(",", ":")), flush=True)
                continue

            extracted = archive.extractfile(member)
            if extracted is None:
                record.update(valid=False, error="unreadable_tar_member")
            else:
                try:
                    data = extracted.read(MAX_PROFILE_BYTES + 1)
                    if len(data) != member.size:
                        raise GifParseError("tar_member_size_mismatch")
                    record.update(parse_gif(data))
                except (GifParseError, OSError) as error:
                    record.update(valid=False, error=str(error))

            print(json.dumps(record, separators=(",", ":")), flush=True)


def nearest_rank(values: list[int], percentile: float) -> int | None:
    if not values:
        return None
    index = max(0, math.ceil(percentile * len(values)) - 1)
    return sorted(values)[index]


def distribution(values: list[int]) -> dict[str, int | None]:
    if not values:
        return {"count": 0, "min": None, "max": None}
    result: dict[str, int | None] = {
        "count": len(values),
        "min": min(values),
        "max": max(values),
    }
    for percentile in PERCENTILES:
        label = f"p{percentile * 100:g}".replace(".", "_")
        result[label] = nearest_rank(values, percentile)
    return result


def top_records(records: Iterable[dict[str, object]], field: str) -> list[dict[str, object]]:
    eligible = [record for record in records if isinstance(record.get(field), int)]
    eligible.sort(key=lambda record: int(record[field]), reverse=True)
    return [{"path": record["path"], field: record[field]} for record in eligible[:10]]


def summarize(stream: BinaryIO) -> None:
    records: list[dict[str, object]] = []
    for line_number, raw_line in enumerate(stream, start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise SystemExit(f"invalid profiler record on line {line_number}: {error}")

    valid = [record for record in records if record.get("valid") is True]
    invalid = [record for record in records if record.get("valid") is not True]
    dimensions = Counter(f"{record['width']}x{record['height']}" for record in valid)
    versions = Counter(str(record["version"]) for record in valid)
    errors = Counter(str(record.get("error", "unknown")) for record in invalid)

    report = {
        "files": {
            "total": len(records),
            "valid": len(valid),
            "invalid": len(invalid),
            "total_bytes": sum(int(record["size"]) for record in records),
        },
        "size_bytes": distribution([int(record["size"]) for record in records]),
        "frames": distribution([int(record["frames"]) for record in valid]),
        "duration_centiseconds": distribution([int(record["duration_cs"]) for record in valid]),
        "trailing_bytes": distribution([int(record["trailing_bytes"]) for record in valid]),
        "out_of_bounds_frames": {
            "files": sum(1 for record in valid if int(record["out_of_bounds_frames"]) > 0),
            "frames": sum(int(record["out_of_bounds_frames"]) for record in valid),
        },
        "dimensions": dict(dimensions.most_common()),
        "versions": dict(versions.most_common()),
        "errors": dict(errors.most_common()),
        "largest": top_records(records, "size"),
        "most_frames": top_records(valid, "frames"),
        "longest": top_records(valid, "duration_cs"),
        "invalid_examples": [{"path": record["path"], "size": record["size"], "error": record["error"]} for record in invalid[:20]],
    }
    json.dump(report, sys.stdout, indent=2, sort_keys=True)
    print()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("scan", "summarize"))
    args = parser.parse_args()
    if args.mode == "scan":
        scan_tar(sys.stdin.buffer)
    else:
        summarize(sys.stdin.buffer)


if __name__ == "__main__":
    main()
