// Macros: standard circuits built correctly by code. The AI (and MCP clients) pick a macro
// and its parameters instead of wiring every pin themselves, which small local models get wrong.
// Each macro returns a list of steps; a step is an op, or a function (ids) => op for wiring that
// needs the ids of symbols created by earlier steps.

export const MACROS = {
  dol_starter: {
    h: 160,
    help: 'Direct-on-line motor starter in one column: motor protection switch → contactor main contacts → terminals → motor. params: protection (-Q1), contactor (-K1), motor (-M1), strip (-X1), rating, power, cable (-W1), supply ("xref" adds L1/L2/L3 interruption points on top)',
    build: (p, x, y) => {
      const Q = p.protection || '-Q1', K = p.contactor || '-K1', M = p.motor || '-M1', X = p.strip || '-X1';
      const steps = [];
      if (p.supply !== 'none') ['L1', 'L2', 'L3'].forEach((n, i) => steps.push({ key: `in${i}`, op: { op: 'add', sym: 'xref', x: x - 8 + i * 8, y: y - 36, rot: 180, props: { name: n } } }));
      steps.push(
        { key: 'q', op: { op: 'add', sym: 'mpcb_3p', tag: Q, x, y, props: { rating: p.rating || '' } } },
        { key: 'k', op: { op: 'add', sym: 'main_contacts_3p', tag: K, x, y: y + 40 } },
        ...[1, 2, 3].map(i => ({ key: `t${i}`, op: { op: 'add', sym: 'terminal', tag: X, x: x - 16 + i * 8, y: y + 76, props: { term: String(p.firstTerm ? +p.firstTerm + i - 1 : i) } } })),
        { key: 'm', op: { op: 'add', sym: 'motor3', tag: M, x: x + 4, y: y + 116, props: { power: p.power || '' } } },
      );
      if (p.supply !== 'none') [0, 1, 2].forEach(i => steps.push({ wire: ids => ({ from: `${ids[`in${i}`]}.1`, to: `${ids.q}.${2 * i + 1}` }) }));
      [0, 1, 2].forEach(i => steps.push({ wire: ids => ({ from: `${ids.q}.${2 * i + 2}`, to: `${ids.k}.${2 * i + 1}` }) }));
      [0, 1, 2].forEach(i => steps.push({ wire: ids => ({ from: `${ids.k}.${2 * i + 2}`, to: `${ids[`t${i + 1}`]}.1` }) }));
      ['U', 'V', 'W'].forEach((ph, i) => steps.push({ wire: ids => ({ from: `${ids[`t${i + 1}`]}.2`, to: `${ids.m}.${ph}`, props: p.cable ? { cable: p.cable, core: String(i + 1) } : {} }) }));
      return steps;
    },
  },
  start_stop: {
    h: 150,
    help: 'Start/stop control with seal-in, in one column: L+ → emergency stop → stop (NC) → start (NO) ∥ seal-in contact 13-14 → coil → M. params: contactor (-K1), estop (-S0, or "none"), stop (-S1), start (-S2), supply (L+), return (M), voltage, lamp (-H1 adds a run lamp)',
    build: (p, x, y) => {
      const K = p.contactor || '-K1', sup = p.supply || 'L+', ret = p.return || 'M';
      const st = [{ key: 'top', op: { op: 'add', sym: 'xref', x, y, rot: 180, props: { name: sup } } }];
      let yy = y + 32, prev = 'top', prevPin = '1';
      st.push({ key: 'n0', op: { op: 'add', sym: 'node', x, y: y + 16 } }, { wire: ids => ({ from: `${ids.top}.1`, to: `${ids.n0}.1` }) });
      prev = 'n0';
      if (p.estop !== 'none') {
        st.push({ key: 'es', op: { op: 'add', sym: 'estop', tag: p.estop || '-S0', x, y: yy, props: { desc: 'Emergency stop' } } });
        const pv = prev; st.push({ wire: ids => ({ from: `${ids[pv]}.${pv === 'n0' ? '1' : prevPin}`, to: `${ids.es}.11` }) });
        prev = 'es'; prevPin = '12'; yy += 28;
      }
      st.push({ key: 'stop', op: { op: 'add', sym: 'pb_nc', tag: p.stop || '-S1', x, y: yy, props: { desc: 'Stop' } } });
      { const pv = prev, pp = prevPin; st.push({ wire: ids => ({ from: `${ids[pv]}.${pv === 'n0' ? '1' : pp}`, to: `${ids.stop}.11` }) }); }
      yy += 20;
      st.push({ key: 'n1', op: { op: 'add', sym: 'node', x, y: yy }, }, { wire: ids => ({ from: `${ids.stop}.12`, to: `${ids.n1}.1` }) });
      yy += 16;
      st.push(
        { key: 'start', op: { op: 'add', sym: 'pb_no', tag: p.start || '-S2', x, y: yy, props: { desc: 'Start' } } },
        { key: 'seal', op: { op: 'add', sym: 'contact_no', tag: K, x: x + 24, y: yy, props: { nums: '13-14' } } },
        { key: 'n2', op: { op: 'add', sym: 'node', x, y: yy + 16 } },
        { key: 'coil', op: { op: 'add', sym: 'coil', tag: K, x, y: yy + 36, props: { voltage: p.voltage || '24 V DC' } } },
        { key: 'n3', op: { op: 'add', sym: 'node', x, y: yy + 56 } },
        { key: 'bot', op: { op: 'add', sym: 'xref', x, y: yy + 72, props: { name: ret } } },
        { wire: ids => ({ from: `${ids.n1}.1`, to: `${ids.start}.13` }) },
        { wire: ids => ({ from: `${ids.n1}.1`, to: `${ids.seal}.1` }) },
        { wire: ids => ({ from: `${ids.start}.14`, to: `${ids.n2}.1` }) },
        { wire: ids => ({ from: `${ids.seal}.2`, to: `${ids.n2}.1` }) },
        { wire: ids => ({ from: `${ids.n2}.1`, to: `${ids.coil}.A1` }) },
        { wire: ids => ({ from: `${ids.coil}.A2`, to: `${ids.n3}.1` }) },
        { wire: ids => ({ from: `${ids.n3}.1`, to: `${ids.bot}.1` }) },
      );
      if (p.lamp) {
        st.push(
          { key: 'lc', op: { op: 'add', sym: 'contact_no', tag: K, x: x + 56, y: yy, props: { nums: '23-24' } } },
          { key: 'lamp', op: { op: 'add', sym: 'lamp', tag: p.lamp, x: x + 56, y: yy + 36, props: { color: 'green' } } },
          { key: 'n4', op: { op: 'add', sym: 'node', x: x + 56, y: yy + 56 } },
          { wire: ids => ({ from: `${ids.n0}.1`, to: `${ids.lc}.1` }) },
          { wire: ids => ({ from: `${ids.lc}.2`, to: `${ids.lamp}.X1` }) },
          { wire: ids => ({ from: `${ids.lamp}.X2`, to: `${ids.n4}.1` }) },
          { wire: ids => ({ from: `${ids.n4}.1`, to: `${ids.n3}.1` }) },
        );
      }
      return st;
    },
  },
  terminal_strip: {
    h: 8,
    help: 'A row of terminals 8 mm apart. params: strip (-X1), count, first (first terminal number), pe (true adds a PE terminal at the end)',
    build: (p, x, y) => {
      const n = Math.max(1, Math.min(40, +p.count || 4)), first = +p.first || 1;
      const st = Array.from({ length: n }, (_, i) => ({ op: { op: 'add', sym: 'terminal', tag: p.strip || '-X1', x: x + i * 8, y, props: { term: String(first + i) } } }));
      if (p.pe) st.push({ op: { op: 'add', sym: 'terminal_pe', tag: p.strip || '-X1', x: x + n * 8, y, props: { term: 'PE' } } });
      return st;
    },
  },
};

export const MACROS_HELP = Object.entries(MACROS).map(([k, m]) => `${k}: ${m.help}`).join('\n');
