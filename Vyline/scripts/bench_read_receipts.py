"""Micro-benchmark candidate read-receipt lookup strategies.

Run with: py scripts/bench_read_receipts.py
Synthetic workload: 100k messages, 1k chats, and 200 monotonic watermark updates.
"""

from bisect import bisect_right
from statistics import median
from time import perf_counter


MESSAGE_COUNT = 100_000
CHAT_COUNT = 1_000
UPDATES = 200
TARGET_CHAT = 537


def build_data():
    rows = []
    per_chat = [[] for _ in range(CHAT_COUNT)]
    for message_id in range(1, MESSAGE_COUNT + 1):
        chat_id = message_id % CHAT_COUNT
        # Half of each chat's messages are outgoing.
        row = (chat_id, message_id, ((message_id - 1) // CHAT_COUNT) % 2 == 0)
        rows.append(row)
        if chat_id == TARGET_CHAT and row[2]:
            per_chat[chat_id].append(message_id)
    return rows, per_chat[TARGET_CHAT]


def full_scan(rows, watermarks):
    total = 0
    for watermark in watermarks:
        total += sum(1 for chat_id, message_id, mine in rows
                     if chat_id == TARGET_CHAT and mine and message_id <= watermark)
    return total


def chat_bucket(outgoing_ids, watermarks):
    total = 0
    for watermark in watermarks:
        total += sum(message_id <= watermark for message_id in outgoing_ids)
    return total


def sorted_index(outgoing_ids, watermarks):
    total = 0
    for watermark in watermarks:
        total += bisect_right(outgoing_ids, watermark)
    return total


def measure(fn, *args):
    samples = []
    expected = None
    for _ in range(5):
        started = perf_counter()
        result = fn(*args)
        samples.append(perf_counter() - started)
        if expected is None:
            expected = result
        elif result != expected:
            raise AssertionError("candidate strategies returned different counts")
    return median(samples), expected


def main():
    rows, outgoing_ids = build_data()
    max_id = rows[-1][1]
    watermarks = [max_id * (i + 1) // UPDATES for i in range(UPDATES)]
    methods = [
        ("full scan", full_scan, (rows, watermarks)),
        ("chat bucket scan", chat_bucket, (outgoing_ids, watermarks)),
        ("sorted index + binary search", sorted_index, (outgoing_ids, watermarks)),
    ]
    results = [(name, *measure(fn, *args)) for name, fn, args in methods]
    baseline = results[0][1]
    print(f"workload: {MESSAGE_COUNT:,} messages / {CHAT_COUNT:,} chats / {UPDATES} updates")
    print("method                         median ms   speedup")
    for name, seconds, count in results:
        print(f"{name:30} {seconds * 1000:9.2f}   {baseline / seconds:7.1f}x")
    print(f"verified read-message count: {count:,}")


if __name__ == "__main__":
    main()
