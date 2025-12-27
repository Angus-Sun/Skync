const io = require('socket.io-client');

const serverUrl = 'http://localhost:3001';
const roomId = 'latency-test-room';

const clientA = io(serverUrl);
const clientB = io(serverUrl);

let aJoined = false;
let bJoined = false;

const ensureStart = () => {
  if (aJoined && bJoined) {
    runTest();
  }
};

clientA.on('connect', () => {
  console.log('ClientA connected', clientA.id);
  clientA.emit('join-room', roomId);
  aJoined = true;
  ensureStart();
});

clientB.on('connect', () => {
  console.log('ClientB connected', clientB.id);
  clientB.emit('join-room', roomId);
  bJoined = true;
  ensureStart();
});

// Client B behavior: on drawing, measure server->client delay and report it
clientB.on('drawing', (data) => {
  if (!data) return;
  const { strokeId, ownerId, serverReceivedAt } = data;
  // ignore our own drawings
  if (ownerId === clientB.id) return;
  const now = Date.now();
  if (serverReceivedAt) {
    const serverToClientMs = now - serverReceivedAt;
    // report back to server for owner
    clientB.emit('drawing-received', {
      strokeId,
      originalSenderId: ownerId,
      measuredLatency: serverToClientMs
    });
  }
});

// Client A collects reports
const reports = {};
clientA.on('stroke-latency-report', ({ strokeId, from, measuredLatency }) => {
  if (!reports[strokeId]) reports[strokeId] = [];
  reports[strokeId].push({ from, measuredLatency });
  console.log(`A received latency report for ${strokeId} from ${from}: ${measuredLatency} ms`);
});

// latency-pong handler for RTT measurement
clientA.on('latency-pong', ({ clientSentAt, serverReceivedAt }) => {
  const rtt = Date.now() - clientSentAt;
  console.log('ClientA RTT (ms):', rtt, 'serverReceivedAt:', serverReceivedAt);
});

let strokesToSend = 5;
const runTest = async () => {
  console.log('Starting latency test: sending', strokesToSend, 'strokes');

  // send a ping for RTT
  clientA.emit('latency-ping', { clientSentAt: Date.now() });

  for (let i = 0; i < strokesToSend; i++) {
    const strokeId = `test-${Date.now()}-${i}`;
    const payload = {
      roomId,
      strokeId,
      x1: i, y1: i,
      colour: '#000',
      tool: 'pen',
      brushSize: 2,
      ownerId: clientA.id,
      clientSentAt: Date.now()
    };
    console.log('ClientA emitting drawing', strokeId);
    clientA.emit('drawing', payload);
    // space out strokes a bit
    await new Promise(r => setTimeout(r, 200));
  }

  // wait for reports to arrive
  await new Promise(r => setTimeout(r, 2000));

  // summarize
  console.log('\nSummary of latency reports collected by A:');
  for (const [strokeId, arr] of Object.entries(reports)) {
    const vals = arr.map(a => a.measuredLatency);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    console.log(`${strokeId}: reports=${vals.length}, avg=${avg.toFixed(2)} ms, values=${vals.join(',')}`);
  }

  // cleanup
  clientA.disconnect();
  clientB.disconnect();
  process.exit(0);
};

// error handlers
clientA.on('connect_error', (e) => console.error('ClientA connect_error', e));
clientB.on('connect_error', (e) => console.error('ClientB connect_error', e));
