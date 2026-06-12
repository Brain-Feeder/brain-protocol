// SEC — Class D subset. Stub registrations; implemented in a later wave.
import { defineTest } from '../harness.js';
defineTest({ id: 'T-SEC-01', suite: 'SEC', cls: 'D', needs: 'none', name: 'S3 never-on-wire scan', clause: 'BP-07',
  run(ctx) { ctx.skip('SEC not yet implemented (pending wave)'); } });
defineTest({ id: 'T-SEC-02', suite: 'SEC', cls: 'D', needs: 'none', name: 'pointer passes', clause: 'BP-07',
  run(ctx) { ctx.skip('SEC not yet implemented (pending wave)'); } });
defineTest({ id: 'T-SEC-05', suite: 'SEC', cls: 'D', needs: 'none', name: 'no downgrade', clause: 'BP-07',
  run(ctx) { ctx.skip('SEC not yet implemented (pending wave)'); } });
defineTest({ id: 'T-SEC-06', suite: 'SEC', cls: 'D', needs: 'none', name: 'unsigned batch rejected', clause: 'BP-07',
  run(ctx) { ctx.skip('SEC not yet implemented (pending wave)'); } });
defineTest({ id: 'T-SEC-07', suite: 'SEC', cls: 'D', needs: 'none', name: 'tampered batch rejected', clause: 'BP-07',
  run(ctx) { ctx.skip('SEC not yet implemented (pending wave)'); } });
defineTest({ id: 'T-SEC-08', suite: 'SEC', cls: 'D', needs: 'none', name: 'replay rejected', clause: 'BP-07',
  run(ctx) { ctx.skip('SEC not yet implemented (pending wave)'); } });
defineTest({ id: 'T-SEC-10', suite: 'SEC', cls: 'D', needs: 'none', name: 'SSRF closed', clause: 'BP-07',
  run(ctx) { ctx.skip('SEC not yet implemented (pending wave)'); } });
defineTest({ id: 'T-SEC-11', suite: 'SEC', cls: 'D', needs: 'none', name: 'no central telemetry', clause: 'BP-07',
  run(ctx) { ctx.skip('SEC not yet implemented (pending wave)'); } });
