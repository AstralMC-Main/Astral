const WebSocket = require('ws');
const http = require('http');

// Optional: Create HTTP server for future expansion (health check, REST endpoints, etc.)
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('WebSocket Server Running');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('Received:', message);

      // Broadcast the message to all connected clients
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
        }
      });
    } catch (err) {
      console.error('Invalid message:', err);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WebSocket server is running on ws://localhost:${PORT}`);
});
