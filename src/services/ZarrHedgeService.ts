import { pool } from '../db';

export class ZarrHedgeService {
  private intervalId: NodeJS.Timeout | null = null;

  // Constants
  private readonly TICK_INTERVAL_MS = 30000; // 30 seconds
  private readonly SYSTEM_RESERVE_UUID = '00000000-0000-0000-0000-000000000000';
  private readonly HEDGE_TRIGGER_THRESHOLD_GRAMS = 50.0; // 50 grams

  /**
   * Calculates current aggregate user liabilities in grams grouped by karat
   */
  private async calculateUserLiabilities(): Promise<Map<number, number>> {
    const queryStr = `
      SELECT 
        karat,
        (COALESCE(SUM(CASE WHEN to_account LIKE 'USER_%' THEN gold_weight_mg ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN from_account LIKE 'USER_%' THEN gold_weight_mg ELSE 0 END), 0)) / 1000.0 AS liabilities_g
      FROM gold_ledger
      GROUP BY karat
    `;
    const result = await pool.query(queryStr);
    const liabilitiesMap = new Map<number, number>();
    
    // Default initializations
    liabilitiesMap.set(18, 0.0);
    liabilitiesMap.set(24, 0.0);

    for (const row of result.rows) {
      liabilitiesMap.set(row.karat, parseFloat(row.liabilities_g));
    }
    return liabilitiesMap;
  }

  /**
   * Retrieves current physical vault inventory in grams grouped by karat (latest verified log per vault location)
   */
  private async calculatePhysicalVaultInventory(): Promise<Map<number, number>> {
    const queryStr = `
      WITH latest_vault_inventory AS (
        SELECT DISTINCT ON (vault_location, karat) gold_weight_grams, karat
        FROM vault_inventory_logs
        WHERE audit_status = 'VERIFIED'
        ORDER BY vault_location, karat, created_at DESC
      )
      SELECT karat, COALESCE(SUM(gold_weight_grams), 0) as physical_g
      FROM latest_vault_inventory
      GROUP BY karat
    `;
    const result = await pool.query(queryStr);
    const inventoryMap = new Map<number, number>();
    
    // Default initializations
    inventoryMap.set(18, 0.0);
    inventoryMap.set(24, 0.0);

    for (const row of result.rows) {
      inventoryMap.set(row.karat, parseFloat(row.physical_g));
    }
    return inventoryMap;
  }

  /**
   * Sends alert notifications to co-founders simulating Slack, Telegram, or SMS channels
   */
  private sendCoFounderAlert(karat: number, deficit: number, costIrr: number, treasuryIrr: number, requestId: string) {
    const alertMessage = 
      `\n================================================================================\n` +
      `[CO-FOUNDERS HEDGING ALERT] High-Priority Slack/Telegram/SMS Dispatch\n` +
      `--------------------------------------------------------------------------------\n` +
      `Attention: Tech & Business Co-founders\n` +
      `Unhedged position detected in users' wallets for ${karat}k gold!\n` +
      `Deficit: ${deficit.toFixed(3)} grams of gold (User liabilities exceed physical vault backing).\n` +
      `Estimated Wholesaler Purchase Cost: ${costIrr.toLocaleString()} IRR.\n` +
      `Current Platform Treasury Cash Balance: ${treasuryIrr.toLocaleString()} IRR.\n` +
      `Action Taken: Generated PENDING MULTISIG HEDGE REQUEST inside the database.\n` +
      `Request ID: ${requestId}\n` +
      `Requirement: BOTH co-founders must cryptographically sign this transaction to approve cash transfer.\n` +
      `================================================================================\n`;
    console.warn(alertMessage);
  }

  /**
   * Main verification and hedging logic execution
   */
  public async tick(): Promise<void> {
    try {
      // 1. Reconcile ledger user liabilities vs physical vault reserves
      const userLiabilities = await this.calculateUserLiabilities();
      const physicalInventory = await this.calculatePhysicalVaultInventory();

      const karatsToCheck = [18, 24];

      for (const karat of karatsToCheck) {
        const liabilitiesG = userLiabilities.get(karat) || 0.0;
        const physicalG = physicalInventory.get(karat) || 0.0;
        const deficitG = liabilitiesG - physicalG;

        console.log(`[ZarrHedge] Checking ${karat}k: Users hold ${liabilitiesG.toFixed(3)}g, Vault holds ${physicalG.toFixed(3)}g. Deficit: ${deficitG.toFixed(3)}g.`);

        // 2. Trigger check: deficit > 50 grams
        if (deficitG > this.HEDGE_TRIGGER_THRESHOLD_GRAMS) {
          // Check if there is already a pending approval request for this karat to prevent duplicate spams
          const duplicateCheckQuery = `
            SELECT request_id 
            FROM multisig_requests 
            WHERE status = 'PENDING_APPROVAL' 
              AND action_type = 'HEDGE_LIQUIDATION' 
              AND (action_payload->>'karat')::int = $1
          `;
          const duplicateCheckRes = await pool.query(duplicateCheckQuery, [karat]);

          if (duplicateCheckRes.rows.length > 0) {
            const existingId = duplicateCheckRes.rows[0].request_id;
            console.log(`[ZarrHedge] Deficit of ${deficitG.toFixed(3)}g detected for ${karat}k gold, but a pending multisig request (${existingId}) already exists. Skipping duplicate draft.`);
            continue;
          }

          // Fetch current ask price per gram from live_prices to estimate wholesaler cost
          const rateQuery = 'SELECT ask_price_per_g_irr FROM live_prices WHERE karat = $1';
          const rateRes = await pool.query(rateQuery, [karat]);
          if (rateRes.rows.length === 0) {
            console.error(`[ZarrHedge] Cannot create hedge request: Price feed for ${karat}k is currently missing in database.`);
            continue;
          }
          const askPricePerG = parseFloat(rateRes.rows[0].ask_price_per_g_irr);
          const estimatedCostIrr = Math.round(deficitG * askPricePerG * 100) / 100;

          // Fetch current treasury cash balance (SYSTEM_RESERVE fiat wallet balance)
          const walletQuery = 'SELECT balance_irr FROM fiat_wallets WHERE user_id = $1';
          const walletRes = await pool.query(walletQuery, [this.SYSTEM_RESERVE_UUID]);
          if (walletRes.rows.length === 0) {
            console.error('[ZarrHedge] Cannot create hedge request: Platform reserve wallet not initialized.');
            continue;
          }
          const treasuryBalanceIrr = parseFloat(walletRes.rows[0].balance_irr);

          // 3. Generate pending multisig hedging request in the database
          const payload = {
            karat,
            gold_weight_grams: Math.round(deficitG * 1000) / 1000,
            estimated_cost_irr: estimatedCostIrr,
            treasury_balance_irr: treasuryBalanceIrr,
          };

          const insertRequestQuery = `
            INSERT INTO multisig_requests (requested_by, action_type, action_payload, status)
            VALUES ('ZarrHedge', 'HEDGE_LIQUIDATION', $1, 'PENDING_APPROVAL')
            RETURNING request_id
          `;

          const insertRes = await pool.query(insertRequestQuery, [JSON.stringify(payload)]);
          const requestId = insertRes.rows[0].request_id;

          // 4. Notify co-founders
          this.sendCoFounderAlert(karat, deficitG, estimatedCostIrr, treasuryBalanceIrr, requestId);
        }
      }
    } catch (error) {
      console.error('[ZarrHedge] Error executing vault inventory hedge check:', error);
    }
  }

  /**
   * Starts the scheduled background hedging monitor
   */
  public start(): void {
    if (this.intervalId) {
      console.warn('[ZarrHedge] Hedging monitor is already running.');
      return;
    }

    console.log('[ZarrHedge] Starting scheduled Vault Backing & Hedging Monitor (30s intervals)...');

    // Perform an immediate initial tick
    this.tick().catch(err => {
      console.error('[ZarrHedge] Initial tick error:', err);
    });

    // Schedule subsequent ticks
    this.intervalId = setInterval(() => {
      this.tick().catch(err => {
        console.error('[ZarrHedge] Tick execution error:', err);
      });
    }, this.TICK_INTERVAL_MS);
  }

  /**
   * Stops the scheduled background hedging monitor
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ZarrHedge] Hedging monitor stopped successfully.');
    }
  }
}
