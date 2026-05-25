const http = require('http');

function testSyncProxy() {
  console.log('--- Testing Synchronous Proxy Spec Translation ---');
  const body = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Say: Sync Proxy Adapter is active and verified.' }],
    stream: false
  });

  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log(`Status: ${res.statusCode}`);
      console.log('Response Body:');
      try {
        console.log(JSON.stringify(JSON.parse(data), null, 2));
      } catch {
        console.log(data);
      }
      console.log('--------------------------------------------------\n');
      
      // Run streaming test next
      testStreamProxy();
    });
  });

  req.on('error', err => console.error('Sync test failed:', err.message));
  req.write(body);
  req.end();
}

function testStreamProxy() {
  console.log('--- Testing Real-time Streaming & Emulation Proxy ---');
  const body = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Say: Streaming Emulation is active and verified.' }],
    stream: true
  });

  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, (res) => {
    console.log(`Status: ${res.statusCode}`);
    console.log('Streaming Output:');
    
    res.on('data', (chunk) => {
      const chunkStr = chunk.toString();
      const lines = chunkStr.split('\n');
      for (const line of lines) {
        const cleanLine = line.trim();
        if (cleanLine.startsWith('data: ') && cleanLine !== 'data: [DONE]') {
          try {
            const parsed = JSON.parse(cleanLine.slice(6));
            const content = parsed.choices?.[0]?.delta?.content || '';
            process.stdout.write(content);
          } catch {}
        }
      }
    });

    res.on('end', () => {
      console.log('\n--- Stream Ended ---');
      console.log('--------------------------------------------------\n');
      process.exit(0);
    });
  });

  req.on('error', err => console.error('Stream test failed:', err.message));
  req.write(body);
  req.end();
}

// Start sequence
testSyncProxy();
