/**
 * DiskD SDK - Drive Tree Demo
 *
 * Authenticates using credentials.json and prints a neat console tree
 * of Drive contents with depth 3.
 *
 * Usage:
 *   npx tsx examples/node/drive-tree.ts [credentials-path] [max-depth]
 *
 * Environment:
 *   DISKD_CREDENTIALS_PATH  - path to credentials.json (default: ./data/credentials.json)
 *   APIS_BASE_URL           - API base URL (default: https://apis.diskd.local:8080)
 */

import path from 'node:path';
import type { DrivePathEntry } from '@diskd/sdk';
import { diskd } from '@diskd/sdk';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CREDENTIALS = path.resolve(process.cwd(), 'data', 'credentials.json');
const DEFAULT_MAX_DEPTH = 3;

const credentialsPath =
  process.argv[2] ?? process.env.DISKD_CREDENTIALS_PATH ?? DEFAULT_CREDENTIALS;

const maxDepth = Number(process.argv[3] ?? DEFAULT_MAX_DEPTH);

// ---------------------------------------------------------------------------
// Icon mapping (pure)
// ---------------------------------------------------------------------------

type IconRule = {
  readonly extensions: ReadonlySet<string>;
  readonly icon: string;
};

const iconRules: readonly IconRule[] = [
  { extensions: new Set(['pdf']), icon: '[pdf]' },
  {
    extensions: new Set(['xlsx', 'xls', 'csv', 'tsv', 'ods']),
    icon: '[sheet]',
  },
  { extensions: new Set(['pptx', 'ppt', 'odp', 'key']), icon: '[slides]' },
  { extensions: new Set(['doc', 'docx', 'odt', 'rtf']), icon: '[doc]' },
  { extensions: new Set(['md', 'markdown', 'txt', 'log']), icon: '[text]' },
  {
    extensions: new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico']),
    icon: '[image]',
  },
  {
    extensions: new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv']),
    icon: '[video]',
  },
  {
    extensions: new Set(['mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac']),
    icon: '[audio]',
  },
  {
    extensions: new Set(['zip', 'tar', 'gz', 'rar', '7z', 'bz2']),
    icon: '[archive]',
  },
  {
    extensions: new Set(['json', 'yaml', 'yml', 'toml', 'xml']),
    icon: '[config]',
  },
  {
    extensions: new Set(['ts', 'js', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'sh', 'rb']),
    icon: '[code]',
  },
];

const fileIcon = (name: string): string => {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex < 0) return '[file]';
  const ext = name.slice(dotIndex + 1).toLowerCase();
  for (const rule of iconRules) {
    if (rule.extensions.has(ext)) return rule.icon;
  }
  return '[file]';
};

const entryIcon = (entry: DrivePathEntry): string => {
  switch (entry.type) {
    case 'dir':
      return '[dir]';
    case 'symlink':
      return '[link]';
    case 'index':
      return '[index]';
    case 'capsule':
      return '[capsule]';
    case 'note':
      return '[note]';
    case 'chat':
      return '[chat]';
    case 'file':
      return fileIcon(entry.name);
    default:
      return '[file]';
  }
};

// ---------------------------------------------------------------------------
// Size formatting (pure)
// ---------------------------------------------------------------------------

const formatSize = (bytes: number | undefined): string => {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

// ---------------------------------------------------------------------------
// Date formatting (pure)
// ---------------------------------------------------------------------------

const formatDate = (timestamp: number | undefined): string => {
  if (timestamp === undefined || timestamp === null) return '';
  const d = new Date(timestamp);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${month}/${day}/${year}, ${h12}:${minutes} ${ampm}`;
};

// ---------------------------------------------------------------------------
// Tree node (pure data)
// ---------------------------------------------------------------------------

type TreeNode = {
  readonly entry: DrivePathEntry;
  readonly children: readonly TreeNode[];
};

// ---------------------------------------------------------------------------
// Recursive fetcher (effectful - isolated at edge)
// ---------------------------------------------------------------------------

type DriveList = (params?: { readonly path?: string }) => Promise<readonly DrivePathEntry[]>;

const fetchTree = async (
  list: DriveList,
  parentPath: string,
  depth: number,
  currentMaxDepth: number
): Promise<readonly TreeNode[]> => {
  if (depth >= currentMaxDepth) return [];

  const entries = await list({ path: parentPath });

  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    const childPath = parentPath === '/' ? `/${entry.name}` : `${parentPath}/${entry.name}`;
    const children =
      entry.type === 'dir' ? await fetchTree(list, childPath, depth + 1, currentMaxDepth) : [];
    nodes.push({ entry, children });
  }
  return nodes;
};

// ---------------------------------------------------------------------------
// Tree renderer (pure)
// ---------------------------------------------------------------------------

const renderTree = (nodes: readonly TreeNode[], prefix: string): readonly string[] => {
  const lines: string[] = [];
  const count = nodes.length;

  for (let i = 0; i < count; i++) {
    const node = nodes[i];
    const isLast = i === count - 1;
    const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
    const childPrefix = isLast ? '    ' : '\u2502   ';

    const icon = entryIcon(node.entry);
    const name = node.entry.name;

    if (node.entry.type === 'dir') {
      lines.push(`${prefix}${connector}${icon} ${name}`);
    } else {
      const size = formatSize(node.entry.size);
      const date = formatDate(node.entry.updatedAt ?? node.entry.createdAt);
      const sizeCol = size ? `  ${size}` : '';
      const dateCol = date ? `  ${date}` : '';
      lines.push(`${prefix}${connector}${icon} ${name}${sizeCol}${dateCol}`);
    }

    if (node.children.length > 0) {
      const childLines = renderTree(node.children, `${prefix}${childPrefix}`);
      for (const cl of childLines) {
        lines.push(cl);
      }
    }
  }

  return lines;
};

// ---------------------------------------------------------------------------
// Main (composition root - effectful)
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  console.log();
  console.log('DiskD Drive Tree Demo');
  console.log('\u{2500}'.repeat(50));
  console.log(`  Credentials: ${credentialsPath}`);
  console.log(`  Base URL:    ${process.env.APIS_BASE_URL ?? 'https://apis.diskd.local:8080'}`);
  console.log(`  Max depth:   ${maxDepth}`);
  console.log('\u{2500}'.repeat(50));
  console.log();

  // Auth
  console.log('Authenticating...');
  const auth = await diskd.auth.credentials({
    scopes: ['openid'],
    keyfilePath: credentialsPath,
  });
  const drive = diskd.os.drive({ version: 'v1', auth });

  // Init
  console.log('Initializing drive...');
  await drive.init();

  // Fetch tree
  console.log(`Fetching tree (depth ${maxDepth})...`);
  console.log();
  const tree = await fetchTree(drive.list.bind(drive), '/', 0, maxDepth);

  // Render
  console.log('Drive');
  const lines = renderTree(tree, '');
  for (const line of lines) {
    console.log(line);
  }

  // Stats
  const countNodes = (nodes: readonly TreeNode[]): { dirs: number; files: number } => {
    let dirs = 0;
    let files = 0;
    for (const n of nodes) {
      if (n.entry.type === 'dir') {
        dirs += 1;
      } else {
        files += 1;
      }
      const sub = countNodes(n.children);
      dirs += sub.dirs;
      files += sub.files;
    }
    return { dirs, files };
  };

  const stats = countNodes(tree);
  console.log();
  console.log('\u{2500}'.repeat(50));
  console.log(`${stats.dirs} directories, ${stats.files} files`);
  console.log();
};

main().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
