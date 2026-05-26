import TelegramBot from 'node-telegram-bot-api';
import { 
  Portfolio, 
  Position, 
  RebalancePlan, 
  RiskAlertEvent,
  PerformanceMetrics,
  YieldMode,
} from '../../../shared/types/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export class TelegramService {
  private bot: TelegramBot | null = null;
  private chatId: string = '';
  private enabled: boolean = false;

  constructor() {
    if (config.telegram?.botToken && config.telegram?.chatId) {
      try {
        this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
        this.chatId = config.telegram.chatId;
        this.enabled = true;
        logger.info('Telegram bot initialized');
      } catch (error) {
        logger.error('Failed to initialize Telegram bot', error as Error);
      }
    } else {
      logger.info('Telegram notifications disabled - missing configuration');
    }
  }

  async sendMessage(message: string, options?: TelegramBot.SendMessageOptions): Promise<void> {
    if (!this.enabled || !this.bot) {
      logger.debug('Telegram message skipped (disabled)', { message: message.substring(0, 100) });
      return;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...options,
      });
    } catch (error) {
      logger.error('Failed to send Telegram message', error as Error);
    }
  }

  // Send rebalance notification
  async notifyRebalance(
    portfolio: Portfolio,
    plan: RebalancePlan,
    executed: boolean
  ): Promise<void> {
    if (!config.telegram?.notifications?.rebalance) return;

    const emoji = executed ? '✅' : '⏳';
    const status = executed ? 'Executed' : 'Pending';
    
    let message = `${emoji} **Rebalance ${status}**\n\n`;
    message += `📊 Portfolio: ${portfolio.id.slice(0, 8)}\n`;
    message += `🎯 Mode: ${portfolio.mode}\n`;
    message += `💰 Total Value: $${portfolio.totalValue.toFixed(2)}\n\n`;
    
    message += `**Actions (${plan.actions.length}):**\n`;
    for (const action of plan.actions.slice(0, 5)) {
      const typeEmoji = action.type === 'ENTER' ? '🟢' : action.type === 'EXIT' ? '🔴' : '🟡';
      const amount = action.delta ? `$${Math.abs(action.delta).toFixed(2)}` : '';
      message += `${typeEmoji} ${action.type}: ${action.poolId.slice(0, 20)} ${amount}\n`;
    }
    if (plan.actions.length > 5) {
      message += `... and ${plan.actions.length - 5} more\n`;
    }
    
    message += `\n📈 Expected Return: ${plan.expectedReturn.toFixed(2)}%\n`;
    message += `💸 Total Fees: $${plan.totalFees.toFixed(2)}\n`;

    await this.sendMessage(message);
  }

  // Send risk alert
  async notifyRiskAlert(
    portfolio: Portfolio,
    alert: RiskAlertEvent
  ): Promise<void> {
    if (!config.telegram?.notifications?.riskAlert) return;

    const levelEmoji = {
      'LOW': '🟢',
      'MODERATE': '🟡',
      'HIGH': '🟠',
      'EXTREME': '🔴',
    };

    const emoji = levelEmoji[alert.payload.level];
    
    let message = `${emoji} **RISK ALERT: ${alert.payload.level}**\n\n`;
    message += `📊 Portfolio: ${portfolio.id.slice(0, 8)}\n`;
    message += `🎯 Mode: ${portfolio.mode}\n\n`;
    
    message += `**Alert Details:**\n`;
    message += `⚠️ Trigger: ${alert.payload.trigger.type}\n`;
    message += `📍 Affected: ${alert.payload.affectedPositions.length} position(s)\n\n`;
    
    message += `**Message:**\n${alert.payload.message}\n\n`;
    message += `**Recommended Action:**\n${alert.payload.recommendedAction}`;

    await this.sendMessage(message);
  }

  // Send performance update
  async notifyPerformance(
    portfolio: Portfolio,
    metrics: PerformanceMetrics
  ): Promise<void> {
    if (!config.telegram?.notifications?.performance) return;

    const trendEmoji = metrics.totalReturn >= 0 ? '📈' : '📉';
    const returnEmoji = metrics.totalReturn >= 0 ? '🟢' : '🔴';
    
    let message = `${trendEmoji} **Performance Update**\n\n`;
    message += `📊 Portfolio: ${portfolio.id.slice(0, 8)}\n`;
    message += `🎯 Mode: ${portfolio.mode}\n`;
    message += `💰 Total Value: $${portfolio.totalValue.toFixed(2)}\n\n`;
    
    message += `**Returns:**\n`;
    message += `${returnEmoji} Total: ${metrics.totalReturn >= 0 ? '+' : ''}${metrics.totalReturn.toFixed(2)}%\n`;
    message += `📅 Daily: ${metrics.dailyReturn >= 0 ? '+' : ''}${metrics.dailyReturn.toFixed(2)}%\n`;
    message += `📆 Weekly: ${metrics.weeklyReturn >= 0 ? '+' : ''}${metrics.weeklyReturn.toFixed(2)}%\n`;
    message += `📈 Monthly: ${metrics.monthlyReturn >= 0 ? '+' : ''}${metrics.monthlyReturn.toFixed(2)}%\n`;
    message += `🎯 APY: ${metrics.annualizedApy.toFixed(2)}%\n\n`;
    
    message += `**Risk Metrics:**\n`;
    message += `📊 Volatility: ${metrics.volatility.toFixed(2)}%\n`;
    message += `📉 Max Drawdown: ${metrics.maxDrawdown.toFixed(2)}%\n`;
    message += `🎯 Sortino Ratio: ${metrics.sortinoRatio.toFixed(2)}\n\n`;
    
    message += `**Trading:**\n`;
    message += `💸 Fees Paid: $${metrics.feesPaid.toFixed(2)}\n`;
    message += `🔄 Rebalances: ${metrics.rebalanceCount}\n`;
    message += `⏱️ Avg Hold: ${(metrics.averageHoldingPeriod / 24).toFixed(1)} days\n`;
    message += `🏆 Win Rate: ${metrics.winRate.toFixed(1)}%`;

    await this.sendMessage(message);
  }

  // Send daily summary
  async notifyDailySummary(portfolios: Portfolio[]): Promise<void> {
    if (!config.telegram?.notifications?.dailySummary) return;

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    let totalValue = 0;
    let totalReturn = 0;
    const activePositions: Position[] = [];

    for (const portfolio of portfolios) {
      totalValue += portfolio.totalValue;
      totalReturn += portfolio.performanceMetrics.totalReturn;
      activePositions.push(...portfolio.positions.filter(p => p.status === 'ACTIVE'));
    }

    let message = `📋 **Daily Summary - ${dateStr}**\n\n`;
    message += `📊 **Overall:**\n`;
    message += `💰 Total Value: $${totalValue.toFixed(2)}\n`;
    message += `📈 Total Return: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%\n`;
    message += `📍 Active Positions: ${activePositions.length}\n`;
    message += `🗂️ Portfolios: ${portfolios.length}\n\n`;

    if (portfolios.length > 0) {
      message += `**Portfolio Breakdown:**\n`;
      for (const portfolio of portfolios) {
        const emoji = portfolio.performanceMetrics.totalReturn >= 0 ? '🟢' : '🔴';
        message += `${emoji} ${portfolio.mode}: $${portfolio.totalValue.toFixed(2)} `;
        message += `(${portfolio.performanceMetrics.totalReturn >= 0 ? '+' : ''}${portfolio.performanceMetrics.totalReturn.toFixed(2)}%)\n`;
      }
    }

    // Top positions by value
    if (activePositions.length > 0) {
      message += `\n**Top Positions:**\n`;
      const sorted = [...activePositions]
        .sort((a, b) => (b.amount + b.unrealizedPnl) - (a.amount + a.unrealizedPnl))
        .slice(0, 3);
      
      for (const pos of sorted) {
        const value = pos.amount + pos.unrealizedPnl;
        const pnlEmoji = pos.unrealizedPnl >= 0 ? '🟢' : '🔴';
        message += `${pnlEmoji} ${pos.pool.symbol} (${pos.pool.project}): $${value.toFixed(2)} `;
        message += `| APY: ${pos.currentApy.toFixed(2)}%\n`;
      }
    }

    await this.sendMessage(message);
  }

  // Send error notification
  async notifyError(context: string, error: Error, details?: Record<string, unknown>): Promise<void> {
    if (!config.telegram?.notifications?.error) return;

    let message = `❌ **Error Alert**\n\n`;
    message += `**Context:** ${context}\n`;
    message += `**Error:** ${error.message}\n\n`;
    
    if (details && Object.keys(details).length > 0) {
      message += `**Details:**\n`;
      for (const [key, value] of Object.entries(details)) {
        message += `• ${key}: ${JSON.stringify(value).slice(0, 50)}\n`;
      }
    }

    message += `\n⏰ Time: ${new Date().toISOString()}`;

    await this.sendMessage(message);
  }

  // Send new opportunity alert
  async notifyOpportunity(
    pool: { symbol: string; project: string; chain: string; apy: number; tvlUsd: number },
    reason: string
  ): Promise<void> {
    let message = `🎯 **New Opportunity Detected**\n\n`;
    message += `**Pool:** ${pool.symbol}\n`;
    message += `**Protocol:** ${pool.project}\n`;
    message += `**Chain:** ${pool.chain}\n`;
    message += `**APY:** ${pool.apy.toFixed(2)}%\n`;
    message += `**TVL:** $${(pool.tvlUsd / 1_000_000).toFixed(2)}M\n\n`;
    message += `**Why:** ${reason}`;

    await this.sendMessage(message);
  }

  // Send startup notification
  async notifyStartup(): Promise<void> {
    if (!this.enabled) return;

    let message = `🚀 **DarkYield Started**\n\n`;
    message += `Mode: ${config.paperTrading ? '📄 Paper Trading' : '💰 Live Trading'}\n`;
    message += `Time: ${new Date().toISOString()}\n\n`;
    message += `Monitoring yield opportunities across DeFi...`;

    await this.sendMessage(message);
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    if (!this.enabled || !this.bot) {
      return false;
    }

    try {
      const me = await this.bot.getMe();
      logger.info('Telegram bot connected', { username: me.username });
      return true;
    } catch (error) {
      logger.error('Telegram bot connection failed', error as Error);
      return false;
    }
  }

  // Get bot status
  getStatus(): { enabled: boolean; chatId: string; connected: boolean } {
    return {
      enabled: this.enabled,
      chatId: this.chatId,
      connected: this.bot !== null,
    };
  }
}

export const telegramService = new TelegramService();
