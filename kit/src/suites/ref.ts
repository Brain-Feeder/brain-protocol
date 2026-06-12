// REF — Class D subset. Stub registrations; implemented in a later wave.
import { defineTest } from '../harness.js';
defineTest({ id: 'T-REF-01', suite: 'REF', cls: 'D', needs: 'none', name: 'reference clean-start run', clause: 'BP-09',
  run(ctx) { ctx.skip('REF not yet implemented (pending wave)'); } });
defineTest({ id: 'T-REF-02', suite: 'REF', cls: 'D', needs: 'none', name: 'break-a-law branches', clause: 'BP-09',
  run(ctx) { ctx.skip('REF not yet implemented (pending wave)'); } });
