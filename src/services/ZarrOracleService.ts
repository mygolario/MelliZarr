import { pool } from '../db';

export class ZarrOracleService {
  private intervalId: NodeJS.Timeout | null = null;
  private priceHistory: number[] = []; // Rolling history of 18k base prices (up to 30 entries = 5 minutes at 10s ticks)
  private isFrozen = false;

  // Mock initial feed parameters
  private currentSpotPrice = 2300.00; // USD/oz spot gold price
  private currentUsdToIrr = 577000.00; // Tehran free market USD to IRR exchange rate

  // Constants
  private readonly TICK_INTERVAL_MS = 10000; // 10 seconds
  private readonly MAX_HISTORY_SIZE = 30; // 5 minutes (30 * 10 seconds)
  private readonly DELTA_CAP_LIMIT = 0.025; // 2.5%
  private readonly BASE_SPREAD_PERCENTAGE = 1.20; // 1.20% base spread

  /**
   * Simulates fetching global spot gold price (USD/oz) with minor random fluctuations
   */
  private fetchGlobalSpotPrice(): number {
    // Fluctuate price by up to ±0.1%
    const changePercent = (Math.random() - 0.5) * 0.002;
    this.currentSpotPrice += this.currentSpotPrice * changePercent;
    return Math.round(this.currentSpotPrice * 100) / 100;
  }

  /**
   * Simulates fetching Tehran free market USD-to-IRR exchange rate with minor fluctuations
   */
  private fetchTehranOpenMarketUSD(): number {
    // Fluctuate exchange rate by up to ±0.05%
    const changePercent = (Math.random() - 0.5) * 0.001;
    this.currentUsdToIrr += this.currentUsdToIrr * changePercent;
    return Math.round(this.currentUsdToIrr * 100) / 100;
  }

  /**
   * Simulates comparing against wholesale bazaar baseline rates (TGJU rate adjustment)
   * Returns a premium multiplier factor (e.g. 1.012 for a 1.2% local premium)
   */
  private fetchTraditionalBazaarTGJU(): number {
    // Returns a multiplier between 1.005 and 1.020 (0.5% to 2.0% local market premium)
    const premiumPercent = 0.005 + Math.random() * 0.015;
    return 1 + premiumPercent;
  }

  /**
   * Broadcasts updated rates to WebSockets / other backend nodes (Simulated)
   */
  private broadcastRates(data: any) {
    console.log(`[ZarrOracle] BROADCAST: Live prices updated: 18k Ask: ${data.ask18k} IRR, 24k Ask: ${data.ask24k} IRR. Volatility: ${data.isHighVolatility ? 'HIGH' : 'LOW'}`);
  }

  /**
   * Sends an emergency notification to the co-founders
   */
  private sendEmergencyAlert(message: string) {
    console.error(`\n================================================================================`);
    console.error(`[EMERGENCY SMS & TELEGRAM ALERT SENT TO CO-FOUNDERS]`);
    console.error(`ALERT: ${message}`);
    console.error(`ACTION: Market prices FROZEN instantly. System requires manual inspection.`);
    console.error(`================================================================================\n`);
  }

  /**
   * Performs a single tick of the oracle price generation and update process
   */
  public async tick(): Promise<void> {
    if (this.isFrozen) {
      console.warn('[ZarrOracle] Service is FROZEN due to a safety guardrail violation. No updates will be pushed.');
      return;
    }

    try {
      // 1. Fetch mock feeds
      const spotPriceUsd = this.fetchGlobalSpotPrice();
      const usdToIrr = this.fetchTehranOpenMarketUSD();
      const bazaarPremium = this.fetchTraditionalBazaarTGJU();

      // Convert Troy Ounce (oz) to grams: 1 oz = 31.1034768 grams
      const spotPriceUsdPerGram = spotPriceUsd / 31.1034768;

      // Base 24k Price (IRR/g) = Spot price in IRR/g * Bazaar premium factor
      const basePrice24k = spotPriceUsdPerGram * usdToIrr * bazaarPremium;
      // Base 18k Price is 75% of 24k
      const basePrice18k = basePrice24k * 0.75;

      // 2. Guardrail Check: Max Delta Cap (2.5% price change in less than 5 minutes)
      if (this.priceHistory.length > 0) {
        const oldestPrice = this.priceHistory[0];
        const deltaChange = Math.abs(basePrice18k - oldestPrice) / oldestPrice;

        if (deltaChange > this.DELTA_CAP_LIMIT) {
          this.isFrozen = true;
          this.sendEmergencyAlert(
            `Max Delta Cap Violated! Price changed by ${(deltaChange * 100).toFixed(2)}% in the last 5 minutes. ` +
            `Oldest Base 18k: ${oldestPrice.toFixed(0)} IRR, New Base 18k: ${basePrice18k.toFixed(0)} IRR.`
          );
          return;
        }
      }

      // Add new price to history queue
      this.priceHistory.push(basePrice18k);
      if (this.priceHistory.length > this.MAX_HISTORY_SIZE) {
        this.priceHistory.shift(); // Evict oldest
      }

      // 3. Volatility spread calculation
      // Calculate immediate step change (last 10 seconds)
      let isHighVolatility = false;
      if (this.priceHistory.length > 1) {
        const previousPrice = this.priceHistory[this.priceHistory.length - 2];
        const stepChange = Math.abs(basePrice18k - previousPrice) / previousPrice;
        // Trigger high volatility if price moves by > 0.2% in 10 seconds, or 10% random chance
        isHighVolatility = stepChange > 0.002 || Math.random() < 0.10;
      }

      // Fetch base spread percentage from database (or fallback)
      let baseSpread = this.BASE_SPREAD_PERCENTAGE;
      try {
        const dbSpreadRes = await pool.query('SELECT spread_percentage FROM live_prices WHERE karat = 18');
        if (dbSpreadRes.rows.length > 0) {
          // If volatility was previously updated in DB, we should read a baseline.
          // Since the DB value might be modified dynamically, we use it as baseline but bound it.
          const dbSpread = parseFloat(dbSpreadRes.rows[0].spread_percentage);
          // If dbSpread is double the base spread, it means it was in High Volatility state in last tick.
          // We normalise it back to base spread to calculate from a clean baseline.
          baseSpread = dbSpread > this.BASE_SPREAD_PERCENTAGE * 1.5 ? this.BASE_SPREAD_PERCENTAGE : dbSpread;
        }
      } catch (err) {
        console.warn('[ZarrOracle] Failed to fetch spread from DB, using fallback:', err);
      }

      const spreadFraction = baseSpread / 100.0;

      let askSpread: number;
      let bidSpread: number;
      let currentSpreadPercentage: number;

      if (isHighVolatility) {
        // High Volatility: Ask Price = Base Rate * (1 + 2 * spread), Bid Price = Base Rate * (1 - 4/3 * spread)
        askSpread = 2.0 * spreadFraction;
        bidSpread = (4.0 / 3.0) * spreadFraction;
        currentSpreadPercentage = baseSpread * 2.0; // Dynamic spread doubles to protect treasury
      } else {
        // Low Volatility: Ask Price = Base Rate * (1 + spread), Bid Price = Base Rate * (1 - 2/3 * spread)
        askSpread = spreadFraction;
        bidSpread = (2.0 / 3.0) * spreadFraction;
        currentSpreadPercentage = baseSpread;
      }

      // Calculate final prices
      const askPrice24k = basePrice24k * (1 + askSpread);
      const bidPrice24k = basePrice24k * (1 - bidSpread);

      const askPrice18k = basePrice18k * (1 + askSpread);
      const bidPrice18k = basePrice18k * (1 - bidSpread);

      // Round to 2 decimal places for IRR database precision
      const roundedBase18k = Math.round(basePrice18k * 100) / 100;
      const roundedAsk18k = Math.round(askPrice18k * 100) / 100;
      const roundedBid18k = Math.round(bidPrice18k * 100) / 100;

      const roundedBase24k = Math.round(basePrice24k * 100) / 100;
      const roundedAsk24k = Math.round(askPrice24k * 100) / 100;
      const roundedBid24k = Math.round(bidPrice24k * 100) / 100;

      const roundedSpreadPercentage = Math.round(currentSpreadPercentage * 100) / 100;

      // 4. Update Database
      await pool.query('BEGIN');
      
      const updateQuery = `
        UPDATE live_prices
        SET base_price_per_g_irr = $1,
            ask_price_per_g_irr = $2,
            bid_price_per_g_irr = $3,
            spread_percentage = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE karat = $5
      `;
      
      await pool.query(updateQuery, [roundedBase18k, roundedAsk18k, roundedBid18k, roundedSpreadPercentage, 18]);
      await pool.query(updateQuery, [roundedBase24k, roundedAsk24k, roundedBid24k, roundedSpreadPercentage, 24]);
      
      await pool.query('COMMIT');

      // 5. Broadcast updates
      this.broadcastRates({
        ask18k: roundedAsk18k,
        bid18k: roundedBid18k,
        ask24k: roundedAsk24k,
        bid24k: roundedBid24k,
        isHighVolatility
      });

    } catch (error) {
      await pool.query('ROLLBACK').catch(() => {});
      console.error('[ZarrOracle] Error executing price generation tick:', error);
    }
  }

  /**
   * Starts the scheduled background pricing service
   */
  public start(): void {
    if (this.intervalId) {
      console.warn('[ZarrOracle] Service is already running.');
      return;
    }

    console.log('[ZarrOracle] Starting scheduled Market Pricing Service (10s intervals)...');
    
    // Perform an immediate initial tick
    this.tick().catch(err => {
      console.error('[ZarrOracle] Initial tick error:', err);
    });

    // Schedule subsequent ticks
    this.intervalId = setInterval(() => {
      this.tick().catch(err => {
        console.error('[ZarrOracle] Tick execution error:', err);
      });
    }, this.TICK_INTERVAL_MS);
  }

  /**
   * Stops the scheduled background pricing service
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ZarrOracle] Market Pricing Service stopped successfully.');
    }
  }

  /**
   * Manually unfreezes the pricing service if it was locked by guardrails
   */
  public unfreeze(): void {
    if (this.isFrozen) {
      this.isFrozen = false;
      this.priceHistory = []; // Reset queue
      console.log('[ZarrOracle] Market Pricing Service has been manually UNFROZEN and history reset.');
    }
  }

  /**
   * Returns whether the service is currently frozen
   */
  public getIsFrozen(): boolean {
    return this.isFrozen;
  }
}
