const { execSync } = require("node:child_process");

function findVylineProcesses() {
  try {
    const output = execSync('tasklist /FO CSV /IM "node.exe" /IM "bun.exe"', { encoding: "utf8" });
    const processes = [];
    const lines = output.split("\n");
    for (const line of lines) {
      if (
        line.includes("Vyline") ||
        line.includes("localhost") ||
        line.includes("5173") ||
        line.includes("3001")
      ) {
        processes.push(line);
      }
    }
    return processes;
  } catch {
    return [];
  }
}

console.log("=== Vyline Task Cleanup ===");
const processes = findVylineProcesses();

if (processes.length === 0) {
  console.log("No Vyline-related processes found.");
} else {
  console.log("Found " + processes.length + " Vyline-related processes:");
  processes.forEach((p, i) => {
    console.log(i + 1 + ". " + p);
  });

  console.log("\nKilling all Vyline processes...");
  // Parse CSV and kill
  // Format: "PID","IMAGENAME","WINDOWTITLE"
  processes.forEach((p) => {
    const match = p.match(/"(\d+)"/);
    if (match) {
      try {
        require("node:process").kill(Number.parseInt(match[1]), "SIGKILL");
        console.log("Killed process " + match[1]);
      } catch (e) {
        console.log("Failed to kill " + match[1] + ": " + e.message);
      }
    }
  });
}

console.log("=== Cleanup Complete ===");
