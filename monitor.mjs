// Lightweight server health monitor — logs every 30 seconds
// Tracks: memory, event loop lag, active handles, child processes

import { execSync } from 'node:child_process';

const INTERVAL_MS = 30_000;

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

function getProcessTree() {
  try {
    const output = execSync('ps aux --sort=-%mem 2>/dev/null || ps aux 2>/dev/null', {
      encoding: 'utf8',
      timeout: 5000,
    });
    const lines = output.trim().split('\n');
    const procs = lines.slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parts[1],
        cpu: parts[2],
        mem: parts[3],
        rss: parts[5],
        command: parts.slice(10).join(' ').slice(0, 80),
      };
    });
    // Top 10 by memory
    return procs.slice(0, 10);
  } catch {
    return [];
  }
}

function getSystemMemory() {
  try {
    const output = execSync('cat /proc/meminfo 2>/dev/null', {
      encoding: 'utf8',
      timeout: 3000,
    });
    const total = output.match(/MemTotal:\s+(\d+)/)?.[1];
    const available = output.match(/MemAvailable:\s+(\d+)/)?.[1];
    if (total && available) {
      const totalMB = (parseInt(total) / 1024).toFixed(0);
      const availMB = (parseInt(available) / 1024).toFixed(0);
      const usedPct = (((parseInt(total) - parseInt(available)) / parseInt(total)) * 100).toFixed(1);
      return { totalMB, availMB, usedPct };
    }
  } catch {}
  return null;
}

function measure() {
  const mem = process.memoryUsage();
  const sysMem = getSystemMemory();
  const procs = getProcessTree();
  const nodeProcs = procs.filter(p => p.command.includes('node') || p.command.includes('claude') || p.command.includes('tsx'));

  const report = {
    timestamp: new Date().toISOString(),
    nodeMemory: {
      rss: formatMB(mem.rss),
      heapUsed: formatMB(mem.heapUsed),
      heapTotal: formatMB(mem.heapTotal),
      external: formatMB(mem.external),
    },
    system: sysMem ? {
      totalMB: sysMem.totalMB,
      availableMB: sysMem.availMB,
      usedPct: sysMem.usedPct + '%',
    } : 'unavailable',
    topProcesses: nodeProcs.length > 0 ? nodeProcs : procs.slice(0, 5),
    totalProcesses: procs.length,
  };

  // Alert on high memory
  if (sysMem && parseFloat(sysMem.usedPct) > 85) {
    console.error(`[MONITOR] ⚠️  HIGH MEMORY: ${sysMem.usedPct}% used (${sysMem.availMB}MB available)`);
    console.error(`[MONITOR] Top processes:`, JSON.stringify(procs.slice(0, 5), null, 2));
  }

  console.log(`[MONITOR]`, JSON.stringify(report));
}

// Initial measurement
measure();

// Periodic measurement
setInterval(measure, INTERVAL_MS);
