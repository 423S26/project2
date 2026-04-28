import { bleManager } from '../lib/ble';
import { Ping } from '../lib/pb/hardware';

async function runSimulation() {
  console.log('--- Starting Rigorous BLE Stream Simulation ---');
  let receivedCount = 0;
  
  // Hook the listener
  bleManager.onPing((ping) => {
    receivedCount++;
  });

  // Generate 500 Pings
  const generatedPings: Ping[] = [];
  for (let i = 0; i < 500; i++) {
    generatedPings.push({
      deviceId: 'test-device',
      timestamp: Date.now() + i * 10,
      lat: 30.0 + (i * 0.0001),
      lon: -90.0 + (i * 0.0001),
      alt: 10,
      speedMps: Math.random() * 20,
      heading: 90,
      hdop: 1.5,
      sats: 8,
      tempC: 25,
      battPct: 90,
      accelX: Math.random(),
      accelY: Math.random(),
      accelZ: 1.0 + Math.random(),
      gyroX: Math.random(),
      gyroY: Math.random(),
      gyroZ: 50.0 + Math.random(), // spinning
    });
  }

  console.log(`Generated ${generatedPings.length} Ping objects. Compiling into byte stream...`);
  
  // Serialize into a massive byte stream
  const payloads = generatedPings.map(p => Ping.toBinary(p));
  const totalLength = payloads.reduce((acc, p) => acc + p.length, 0);
  const stream = new Uint8Array(totalLength);
  
  let offset = 0;
  for (const p of payloads) {
    stream.set(p, offset);
    offset += p.length;
  }

  console.log(`Total Byte Stream Size: ${stream.length} bytes. Stream will be broken into 20-byte MTU chunks.`);

  // Chunk it into 20 bytes
  const CHUNK_SIZE = 20;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < stream.length; i += CHUNK_SIZE) {
    chunks.push(stream.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Feeding ${chunks.length} chunks into BLE Manager...`);

  // Inject into BLE Manager using the private handler (for test purposes)
  for (const chunk of chunks) {
    // Mock the Event target with a DataView
    const mockEvent = {
       target: {
         value: new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
       }
    } as any;
    
    // Call private method
    (bleManager as any).handlePingNotification(mockEvent);
  }

  // Wait for idle timers to flush
  await new Promise(resolve => setTimeout(resolve, 200));

  console.log(`\n--- Test 1 Results: Perfect Stream ---`);
  console.log(`Expected Pings:  ${generatedPings.length}`);
  console.log(`Decoded Pings:   ${receivedCount}`);
  
  if (generatedPings.length === receivedCount) {
    console.log('✅ PERFECT RECOVERY. All pings successfully reassembled from chunks. No errors.');
  } else {
    console.log('❌ MISMATCH. Stream assembler failed or dropped valid data.');
  }

  // Test 2: Simulating dropped BLE chunks (Data Loss Recovery)
  console.log('\n--- Test 2: Severe Data Loss Recovery ---');
  receivedCount = 0;
  let droppedChunks = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    // Drop every 15th chunk to corrupt the stream
    if (i % 15 === 0) {
      droppedChunks++;
      continue;
    }
    const mockEvent = {
       target: { value: new DataView(chunks[i].buffer, chunks[i].byteOffset, chunks[i].byteLength) }
    } as any;
    (bleManager as any).handlePingNotification(mockEvent);
  }

  await new Promise(resolve => setTimeout(resolve, 200));
  console.log(`Simulated dropped chunks: ${droppedChunks}`);
  console.log(`Recovered Pings: ${receivedCount} out of ${generatedPings.length}`);
  if (receivedCount > generatedPings.length - droppedChunks * 2) {
    console.log(`✅ EXCELLENT RECOVERY. The framing logic cleanly recovered from corruption!`);
  } else {
    console.log(`⚠️ POOR RECOVERY. Many frames were lost due to broken framing bounds.`);
  }

  // Test 3: Simulating jumbled order
  
  process.exit(0);
}

runSimulation().catch(console.error);
