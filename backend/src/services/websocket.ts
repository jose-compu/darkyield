import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { 
  WSEvent, 
  PoolUpdateEvent, 
  PositionUpdateEvent,
  RebalanceEvent,
  RiskAlertEvent,
} from '../../../shared/types/index.js';
import { logger } from '../utils/logger.js';

interface ClientConnection {
  ws: WebSocket;
  subscriptions: Set<string>;
  isAlive: boolean;
}

export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientConnection> = new Map();
  private isRunning: boolean = false;

  // Initialize WebSocket server
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    this.isRunning = true;
    logger.info('WebSocket server initialized');

    // Start heartbeat
    this.startHeartbeat();
  }

  // Handle new connection
  private handleConnection(ws: WebSocket): void {
    const client: ClientConnection = {
      ws,
      subscriptions: new Set(),
      isAlive: true,
    };
    
    this.clients.set(ws, client);
    logger.info('WebSocket client connected', { totalClients: this.clients.size });

    // Send welcome message
    this.sendToClient(ws, {
      type: 'CONNECTED',
      timestamp: new Date(),
      payload: {
        message: 'Connected to DarkYield WebSocket',
        version: '1.0.0',
      },
    });

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(ws, message);
      } catch (error) {
        logger.error('Invalid WebSocket message', error as Error);
      }
    });

    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      logger.info('WebSocket client disconnected', { totalClients: this.clients.size });
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error', error);
      this.clients.delete(ws);
    });
  }

  // Handle incoming message from client
  private handleMessage(ws: WebSocket, message: { type: string; payload?: unknown }): void {
    const client = this.clients.get(ws);
    if (!client) return;

    switch (message.type) {
      case 'SUBSCRIBE': {
        const { channel } = message.payload as { channel: string };
        client.subscriptions.add(channel);
        logger.debug('Client subscribed', { channel });
        
        this.sendToClient(ws, {
          type: 'SUBSCRIBED',
          timestamp: new Date(),
          payload: { channel },
        });
        break;
      }

      case 'UNSUBSCRIBE': {
        const { channel } = message.payload as { channel: string };
        client.subscriptions.delete(channel);
        logger.debug('Client unsubscribed', { channel });
        break;
      }

      case 'PING': {
        this.sendToClient(ws, {
          type: 'PONG',
          timestamp: new Date(),
          payload: {},
        });
        break;
      }

      default:
        logger.debug('Unknown message type', { type: message.type });
    }
  }

  // Send event to a specific client
  private sendToClient(ws: WebSocket, event: WSEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  // Broadcast event to all clients subscribed to a channel
  broadcast(channel: string, event: WSEvent): void {
    for (const [ws, client] of this.clients) {
      if (client.subscriptions.has(channel) && ws.readyState === WebSocket.OPEN) {
        this.sendToClient(ws, event);
      }
    }
  }

  // Broadcast to all clients
  broadcastAll(event: WSEvent): void {
    for (const [ws, client] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendToClient(ws, event);
      }
    }
  }

  // Specific event broadcasters
  broadcastPoolUpdate(event: PoolUpdateEvent): void {
    this.broadcast('pools', event);
    this.broadcast(`pool:${event.payload.poolId}`, event);
  }

  broadcastPositionUpdate(event: PositionUpdateEvent): void {
    this.broadcast('positions', event);
    this.broadcast(`portfolio:${event.payload.portfolioId}`, event);
  }

  broadcastRebalance(event: RebalanceEvent): void {
    this.broadcast('rebalances', event);
    this.broadcast(`portfolio:${event.payload.portfolioId}`, event);
  }

  broadcastRiskAlert(event: RiskAlertEvent): void {
    this.broadcast('alerts', event);
    this.broadcastAll(event); // Risk alerts go to everyone
  }

  // Heartbeat to keep connections alive
  private startHeartbeat(): void {
    const interval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(interval);
        return;
      }

      for (const [ws, client] of this.clients) {
        if (!client.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }

        client.isAlive = false;
        ws.ping();
      }
    }, 30000); // 30 seconds
  }

  // Stop WebSocket server
  stop(): void {
    this.isRunning = false;
    
    for (const [ws] of this.clients) {
      ws.terminate();
    }
    this.clients.clear();

    this.wss?.close();
    logger.info('WebSocket server stopped');
  }

  // Get connection stats
  getStats(): {
    connectedClients: number;
    isRunning: boolean;
  } {
    return {
      connectedClients: this.clients.size,
      isRunning: this.isRunning,
    };
  }
}

export const websocketService = new WebSocketService();
