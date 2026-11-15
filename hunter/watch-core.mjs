// The watcher's pure logic: turn new bytes of app.log into wake events, and say where reading stopped.
// State is { offset, pending }. offset counts only whole lines already read. pending holds `request.failed` lines
// still waiting for their `http.request` line (the app writes the failure first, the request line when the response ends).

/** @param {{offset:number,pending:Record<string,object>}} state @param {Buffer} bytes the log from state.offset to its end */
export function readNew(state, bytes) {
  const end = bytes.lastIndexOf(0x0a);
  const pending = { ...state.pending };
  const events = [];
  if (end < 0) return { events, next: { offset: state.offset, pending } }; // no whole line yet
  for (const text of bytes.subarray(0, end).toString('utf8').split('\n')) {
    let line;
    try { line = JSON.parse(text); } catch { continue; }
    if (!line || typeof line.requestId !== 'string') continue;
    if (line.event === 'request.failed') pending[line.requestId] = line;
    else if (line.event === 'http.request' && pending[line.requestId]) {
      events.push({ id: line.requestId, lines: [pending[line.requestId], line] });
      delete pending[line.requestId];
    }
  }
  return { events, next: { offset: state.offset + end + 1, pending } };
}
export const START = { offset: 0, pending: {} };
