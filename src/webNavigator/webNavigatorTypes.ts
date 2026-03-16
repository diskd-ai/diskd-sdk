// Domain types for the Web Navigator API.
// These are pure data types only -- no classes, no I/O, no side effects.
// The Web Navigator REST API already returns camelCase; no wire-level conversion needed.

// -- Job status --

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

// -- Scrape request params --

export type ScrapeParams = {
  readonly url: string;
  /** Crawl depth from the seed URL. Range 0-10. Default: 0. */
  readonly depth?: number;
  /** Maximum number of pages to scrape. Range 1-1000. Default: 100. */
  readonly maxPages?: number;
  /** Regex or glob pattern to restrict which URLs are followed. */
  readonly urlPattern?: string;
  /** Regex or glob pattern for URLs to exclude from crawling. */
  readonly excludePattern?: string;
  /** CSS selector to wait for before capturing the page. */
  readonly waitForSelector?: string;
  /** Per-page navigation timeout in seconds. Default: 15. */
  readonly timeout?: number;
  /** Extra wait time after page load, in seconds. Default: 5. */
  readonly postWaitTime?: number;
  /** Additional HTTP request headers forwarded to the target site. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Proxy URL to route scrape requests through. */
  readonly proxy?: string;
  /** Geo-location hint for the scraping agent (e.g. "us", "gb"). */
  readonly geo?: string;
  /** Block image requests to speed up scraping. */
  readonly blockImages?: boolean;
  /** Block audio/video media requests. */
  readonly blockMedia?: boolean;
  /** Capture a screenshot of each page. */
  readonly screenshot?: boolean;
  /** Extractor pipeline identifier (e.g. "markdown", "raw-html"). */
  readonly extractor?: string;
  /** Number of retry attempts per page. Range 1-5. Default: 3. */
  readonly retryNum?: number;
  /** Maximum concurrent page requests. Range 1-10. Default: 1. */
  readonly concurrency?: number;
};

// -- Submit result --

export type ScrapeSubmitResult = {
  readonly jobId: string;
  readonly status: 'queued';
  readonly message: string;
};

// -- Job progress --

export type JobProgress = {
  readonly scrapedPages: number;
  readonly totalDiscovered: number;
  readonly currentDepth: number;
};

// -- Scraped page --

export type ScrapedPage = {
  readonly url: string;
  readonly statusCode: number;
  readonly finalUrl: string;
  readonly title?: string;
  readonly description?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly screenshot?: string;
  readonly links: readonly string[];
  readonly depth: number;
  readonly scrapedAt: string;
  readonly error?: string;
};

// -- Scrape summary --

export type ScrapeSummary = {
  readonly totalPages: number;
  readonly successfulPages: number;
  readonly failedPages: number;
  readonly uniqueUrls: number;
  readonly domain: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly duration: number;
};

// -- Scrape result (full job output) --

export type ScrapeResult = {
  readonly driveDbName: string;
  readonly pages: readonly ScrapedPage[];
  readonly summary: ScrapeSummary;
};

// -- Full job record --

export type ScrapeJob = {
  readonly id: string;
  readonly workspaceId?: string;
  readonly request: ScrapeParams;
  readonly status: JobStatus;
  readonly result?: ScrapeResult;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attempts: number;
  readonly maxRetries: number;
  readonly podName?: string;
  readonly progress?: JobProgress;
};

// -- Lightweight status poll result --

export type JobStatusResult = {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly progress?: JobProgress;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attempts: number;
  readonly maxRetries: number;
};

// -- URL resolution params and result --

export type ResolveParams = {
  readonly url: string;
};

export type ResolveResult = {
  readonly title: string | null;
  readonly description: string | null;
  readonly favicon: string | null;
  readonly dbname: string;
};

// -- Client interface --

/**
 * Web Navigator REST client organized by namespace.
 *
 * Obtain via `createWebNavigatorClient`. The `workspaceId` is bound at
 * creation time and is forwarded as `X-Workspace-Id` on all requests.
 */
export type WebNavigatorClient = {
  readonly scrape: {
    /** POST /api/v1/scrape -- submit an async scrape job. */
    readonly submit: (params: ScrapeParams) => Promise<ScrapeSubmitResult>;
    /** POST /api/v1/scrape/sync -- submit a scrape job and wait for completion. */
    readonly sync: (params: ScrapeParams) => Promise<ScrapeSubmitResult>;
    /** GET /api/v1/scrape/{jobId} -- fetch the full job record. */
    readonly getJob: (jobId: string) => Promise<ScrapeJob>;
    /** GET /api/v1/scrape/{jobId}/status -- poll lightweight job status. */
    readonly getStatus: (jobId: string) => Promise<JobStatusResult>;
    /** GET /api/v1/scrape/{jobId}/result -- fetch completed job result. Throws if not yet completed. */
    readonly getResult: (jobId: string) => Promise<ScrapeResult>;
    /** POST /api/v1/scrape/{jobId}/cancel -- request cancellation of a queued or processing job. */
    readonly cancel: (jobId: string) => Promise<ScrapeJob>;
  };
  /** POST /api/v1/resolve -- resolve metadata for a URL (title, description, favicon, dbname). */
  readonly resolve: (params: ResolveParams) => Promise<ResolveResult>;
};
