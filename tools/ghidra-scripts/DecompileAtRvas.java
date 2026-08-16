/* ###
 * IP: GHIDRA
 */
//@category Vyline.Recovery

import java.io.File;
import java.io.FileWriter;
import java.math.BigInteger;
import java.nio.file.Files;
import java.util.List;

import com.google.gson.stream.JsonWriter;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.Memory;

/**
 * 与えられた RVA (16進, 1行1個) を Ghidra の imageBase + rva に変換し、
 * その付近をバックスキャン (0xCC/int3 パディング境界探索) して
 * 関数開始点を推定 → disassemble → createFunction → decompile する。
 *
 * usage: DecompileAtRvas <rva-list-file> <output-dir> [timeout-seconds] [max-addresses] [back-scan-bytes]
 */
public class DecompileAtRvas extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length < 2) {
			throw new IllegalArgumentException(
				"usage: DecompileAtRvas <rva-list-file> <output-dir> [timeout-seconds] [max-addresses] [back-scan-bytes]");
		}
		File rvaFile = new File(args[0]);
		File outDir = new File(args[1]);
		outDir.mkdirs();
		int timeoutSeconds = args.length >= 3 ? Integer.parseInt(args[2]) : 20;
		long maxAddresses = args.length >= 4 ? Long.parseLong(args[3]) : 8000;
		int backScan = args.length >= 5 ? Integer.parseInt(args[4]) : 8192;

		List<String> lines = Files.readAllLines(rvaFile.toPath());
		Memory memory = currentProgram.getMemory();
		Address imageBase = currentProgram.getImageBase();

		DecompInterface decompiler = new DecompInterface();
		decompiler.setOptions(new DecompileOptions());
		decompiler.toggleCCode(true);
		decompiler.toggleSyntaxTree(false);
		decompiler.setSimplificationStyle("decompile");
		if (!decompiler.openProgram(currentProgram)) {
			throw new IllegalStateException("failed to open decompiler: " + decompiler.getLastMessage());
		}

		File indexFile = new File(outDir, "_index.json");
		try (JsonWriter root = new JsonWriter(new FileWriter(indexFile))) {
			root.beginObject();
			root.name("results");
			root.beginArray();

			for (String raw : lines) {
				String line = raw.trim();
				if (line.isEmpty() || line.startsWith("#")) {
					continue;
				}
				String[] parts = line.split("\\s+", 2);
				String rvaHex = parts[0].replace("0x", "");
				String label = parts.length > 1 ? parts[1] : rvaHex;

				long rva = new BigInteger(rvaHex, 16).longValue();
				Address instrAddr = imageBase.add(rva);

				root.beginObject();
				root.name("label").value(label);
				root.name("rva").value("0x" + Long.toHexString(rva));
				root.name("instrAddr").value(instrAddr.toString());

				// backward-scan for a run of 0xCC (int3) padding -> function start heuristic
				Address funcStart = instrAddr;
				try {
					Address scanFrom = instrAddr.subtract(backScan);
					int ccRun = 0;
					Address candidate = null;
					Address cursor = scanFrom;
					while (cursor.compareTo(instrAddr) < 0) {
						byte b;
						try {
							b = memory.getByte(cursor);
						}
						catch (Exception e) {
							cursor = cursor.add(1);
							continue;
						}
						if ((b & 0xFF) == 0xCC) {
							ccRun++;
						}
						else {
							if (ccRun >= 1) {
								candidate = cursor;
							}
							ccRun = 0;
						}
						cursor = cursor.add(1);
					}
					if (candidate != null) {
						funcStart = candidate;
					}
				}
				catch (Exception e) {
					// keep funcStart = instrAddr as fallback
				}

				root.name("guessedFuncStart").value(funcStart.toString());

				Function fn = getFunctionContaining(funcStart);
				boolean created = false;
				if (fn == null) {
					try {
						clearListing(funcStart, instrAddr.add(64));
						disassemble(funcStart);
						fn = createFunction(funcStart, null);
						created = fn != null;
					}
					catch (Exception e) {
						root.name("createError").value(String.valueOf(e.getMessage()));
					}
				}

				boolean ok = false;
				String body = "/* no function recovered at guessed start */\n";
				String outFileName = "unknown.c";
				if (fn != null) {
					long bodyAddresses = fn.getBody().getNumAddresses();
					outFileName = sanitize(label) + "_" + fn.getEntryPoint() + ".c";
					if (bodyAddresses > maxAddresses) {
						body = "/* decompile skipped: function body too large (" + bodyAddresses + " addresses) */\n";
					}
					else {
						DecompileResults results = decompiler.decompileFunction(fn, timeoutSeconds, monitor);
						ok = results.decompileCompleted() && results.getDecompiledFunction() != null;
						body = ok ? results.getDecompiledFunction().getC()
							: "/* decompile failed: " + results.getErrorMessage() + " */\n";
					}
					root.name("functionName").value(fn.getName());
					root.name("functionEntry").value(fn.getEntryPoint().toString());
					root.name("bodyAddresses").value(fn.getBody().getNumAddresses());
				}
				root.name("created").value(created);
				root.name("decompiled").value(ok);
				root.name("file").value(outFileName);

				File outFile = new File(outDir, outFileName);
				try (FileWriter writer = new FileWriter(outFile)) {
					writer.write("/*\n label: " + label + "\n rva: 0x" + Long.toHexString(rva) + "\n instrAddr: " +
						instrAddr + "\n guessedFuncStart: " + funcStart + "\n decompiled: " + ok + "\n*/\n\n");
					writer.write(body);
				}

				root.endObject();
				println(label + " @ " + instrAddr + " -> funcStart=" + funcStart + " decompiled=" + ok);
			}

			root.endArray();
			root.endObject();
		}
		finally {
			decompiler.dispose();
		}

		println("Wrote index to " + indexFile.getAbsolutePath());
	}

	private String sanitize(String name) {
		String cleaned = name.replaceAll("[^A-Za-z0-9._-]+", "_");
		cleaned = cleaned.replaceAll("_+", "_").replaceAll("^_+", "").replaceAll("_+$", "");
		return cleaned.isEmpty() ? "x" : (cleaned.length() > 80 ? cleaned.substring(0, 80) : cleaned);
	}
}
