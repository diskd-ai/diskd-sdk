/**
 * Shared validation harness -- ok/fail counters and summary output.
 */
export const createHarness = (label) => {
    let passed = 0;
    let failed = 0;
    return {
        ok: (name, detail) => {
            passed++;
            console.log(`  [PASS] ${name}${detail ? ` -- ${detail}` : ''}`);
        },
        fail: (name, err) => {
            failed++;
            console.log(`  [FAIL] ${name} -- ${String(err)}`);
        },
        summary: () => {
            console.log(`\n=== ${label} Results ===`);
            console.log(`  Passed: ${passed}`);
            console.log(`  Failed: ${failed}`);
            console.log(`  Total:  ${passed + failed}`);
        },
        exitCode: () => (failed > 0 ? 1 : 0),
    };
};
