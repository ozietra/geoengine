import prisma from "~/db.server";
import { runCatalogScan } from "~/features/scan/scanner.server";

// Maximum duration (in ms) after which a scan stuck in "SCANNING" is considered stale.
// If the server restarts, the in-memory worker is lost, leaving the DB status as SCANNING.
// This threshold (5 minutes) gives a generous buffer for large catalogs.
const STUCK_SCAN_THRESHOLD_MS = 5 * 60 * 1000;

// The weekly scheduler wakes up every hour to check if any STARTER+ store is
// overdue for an automatic re-scan.  Hourly wakeup + 7-day threshold means
// the worst-case latency of a missed weekly scan is only one hour.
const WEEKLY_SCHEDULE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// STARTER/GROWTH/UNLIMITED stores are automatically re-scanned after 7 days
// of inactivity, which is what the billing page's "Weekly automated catalog
// monitoring" feature describes.
const AUTO_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

class ScanQueue {
  private activeJobs = new Set<string>(); // Set of shops currently being scanned in-process
  private isProcessing = false;
  private queue: string[] = [];
  private initialized = false;
  private weeklySchedulerTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Recovery: on server startup, detect and reset any stores stuck in SCANNING.
    // The weekly scheduler starts only after recovery completes so the first
    // check doesn't accidentally re-queue a store that was mid-scan when the
    // server restarted.
    this.recoverStuckScans()
      .then(() => {
        this.initialized = true;
        this.startWeeklyScheduler();
      })
      .catch((err) => {
        console.error("[Queue Worker] Failed to recover stuck scans:", err);
        this.initialized = true;
        this.startWeeklyScheduler();
      });
  }

  /**
   * Finds stores whose scanStatus is SCANNING but whose last scan started more
   * than STUCK_SCAN_THRESHOLD_MS ago, and resets them to FAILED so the merchant
   * can retry.
   */
  private async recoverStuckScans(): Promise<void> {
    const threshold = new Date(Date.now() - STUCK_SCAN_THRESHOLD_MS);

    const stuckProfiles = await prisma.storeProfile.findMany({
      where: {
        scanStatus: "SCANNING",
        lastScannedAt: { lt: threshold },
      },
    });

    if (stuckProfiles.length > 0) {
      console.log(
        `[Queue Worker] Recovering ${stuckProfiles.length} stuck scan(s) that have been running since before ${threshold.toISOString()}`
      );

      for (const profile of stuckProfiles) {
        await prisma.storeProfile.update({
          where: { id: profile.id },
          data: { scanStatus: "FAILED" },
        });
      }
    }
  }

  /**
   * Starts the hourly timer that automatically re-scans STARTER+ stores
   * once per week ("Weekly automated catalog monitoring").
   *
   * The first check runs immediately (with a short delay to let the
   * server warm up) so stores that were overdue during a downtime/restart
   * are picked up without waiting a full hour.
   */
  private startWeeklyScheduler(): void {
    // Small initial delay so the server has fully booted before hitting the DB
    setTimeout(() => {
      this.runWeeklyScheduler().catch((err) => {
        console.error("[Queue Worker] Initial weekly scan check failed:", err);
      });
    }, 30_000); // 30 s after startup

    this.weeklySchedulerTimer = setInterval(() => {
      this.runWeeklyScheduler().catch((err) => {
        console.error("[Queue Worker] Weekly scheduler error:", err);
      });
    }, WEEKLY_SCHEDULE_CHECK_INTERVAL_MS);
  }

  /**
   * Finds STARTER/GROWTH/UNLIMITED stores that haven't been scanned in the
   * last 7 days and enqueues a new scan for each one.
   */
  private async runWeeklyScheduler(): Promise<void> {
    const threshold = new Date(Date.now() - AUTO_SCAN_INTERVAL_MS);

    const eligibleStores = await prisma.storeProfile.findMany({
      where: {
        plan: { in: ["STARTER", "GROWTH", "UNLIMITED"] },
        scanStatus: { not: "SCANNING" },
        OR: [
          { lastScannedAt: null },
          { lastScannedAt: { lt: threshold } },
        ],
      },
      select: { shop: true },
    });

    if (eligibleStores.length === 0) return;

    console.log(
      `[Queue Worker] Weekly scheduler: enqueueing ${eligibleStores.length} store(s) for automatic re-scan`
    );

    for (const store of eligibleStores) {
      // enqueue() already guards against duplicate jobs
      await this.enqueue(store.shop);
    }
  }

  // Wait for initialization before enqueuing
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      // Poll every 100ms until recovery is done
      while (!this.initialized) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  // Enqueue a scan job for a shop
  async enqueue(shop: string): Promise<boolean> {
    await this.ensureInitialized();
    // 1. Check if store is already scanning in active memory or DB
    const profile = await prisma.storeProfile.findUnique({
      where: { shop },
    });

    if (profile?.scanStatus === "SCANNING" || this.activeJobs.has(shop)) {
      return false; // Already scanning
    }

    // 2. Update store profile status in DB to SCANNING
    // Also set lastScannedAt so the stuck-scan recovery timer can detect it.
    await prisma.storeProfile.upsert({
      where: { shop },
      create: {
        shop,
        scanStatus: "SCANNING",
        overallScore: 0.0,
        lastScannedAt: new Date(),
      },
      update: {
        scanStatus: "SCANNING",
        lastScannedAt: new Date(),
      },
    });

    // 3. Add to queue
    if (!this.queue.includes(shop)) {
      this.queue.push(shop);
    }

    // 4. Trigger processing loop (async)
    this.processNext().catch((err) => {
      console.error("Queue execution error:", err);
    });

    return true;
  }

  // Get status of a shop's current scanning job
  async getStatus(shop: string): Promise<{ status: string; lastScanned: Date | null }> {
    await this.ensureInitialized();
    const profile = await prisma.storeProfile.findUnique({
      where: { shop },
    });
    return {
      status: profile?.scanStatus || "IDLE",
      lastScanned: profile?.lastScannedAt || null,
    };
  }

  // Process the next job in the queue
  private async processNext() {
    if (this.isProcessing) return;
    if (this.queue.length === 0) return;

    this.isProcessing = true;
    const shop = this.queue.shift()!;
    this.activeJobs.add(shop);

    try {
      console.log(`[Queue Worker] Starting scan for shop: ${shop}`);
      
      // Run the scanner service (defined in features/scan/scanner.server.ts)
      await runCatalogScan(shop);
      
      console.log(`[Queue Worker] Finished scan for shop: ${shop}`);
    } catch (error) {
      console.error(`[Queue Worker] Error scanning shop ${shop}:`, error);
      
      // Update DB to status FAILED
      await prisma.storeProfile.update({
        where: { shop },
        data: { scanStatus: "FAILED" },
      });
    } finally {
      this.activeJobs.delete(shop);
      this.isProcessing = false;
      
      // Process next in queue
      this.processNext().catch((err) => console.error("Queue recursive error:", err));
    }
  }
}

// Export a singleton instance of the scan queue
export const scanQueue = new ScanQueue();
