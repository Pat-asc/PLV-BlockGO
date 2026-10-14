const assert = require('node:assert/strict');
const test = require('node:test');

const { createMetrics } = require('../src/shared/metrics');

test('metrics exporter includes the process memory gauges used by Grafana', () => {
    const output = createMetrics('test-service').render();
    const resident = output.match(/^process_resident_memory_bytes (\d+)$/m);
    const heapUsed = output.match(/^nodejs_heap_size_used_bytes (\d+)$/m);

    assert.ok(resident, 'resident-memory metric is missing');
    assert.ok(heapUsed, 'heap-used metric is missing');
    assert.ok(Number(resident[1]) > 0);
    assert.ok(Number(heapUsed[1]) > 0);
});
