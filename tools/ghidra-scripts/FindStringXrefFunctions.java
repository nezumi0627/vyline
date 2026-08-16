/* ###
 * IP: GHIDRA
 */
//@category Vyline.Recovery

import java.io.File;
import java.io.FileWriter;
import java.util.LinkedHashSet;
import java.util.Set;

import com.google.gson.stream.JsonWriter;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.ReferenceManager;

/**
 * For each ASCII needle, scans raw program memory (independent of whether Ghidra
 * marked it as Data), finds all occurrences, resolves which function(s) reference
 * that address, and decompiles those functions to <outDir>/<needle>/<n>_<func>.c
 *
 * usage: FindStringXrefFunctions <needles-file> <output-dir> [timeout-seconds] [max-addresses]
 *   needles-file: one ASCII needle per line
 */
public class FindStringXrefFunctions extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length < 2) {
			throw new IllegalArgumentException(
				"usage: FindStringXrefFunctions <needles-file> <output-dir> [timeout-seconds] [max-addresses]");
		}
		File needlesFile = new File(args[0]);
		File outDir = new File(args[1]);
		outDir.mkdirs();
		int timeoutSeconds = args.length >= 3 ? Integer.parseInt(args[2]) : 15;
		long maxAddresses = args.length >= 4 ? Long.parseLong(args[3]) : 4000;

		java.util.List<String> needles = java.nio.file.Files.readAllLines(needlesFile.toPath());

		Memory memory = currentProgram.getMemory();
		ReferenceManager refMgr = currentProgram.getReferenceManager();
		FunctionManager funcMgr = currentProgram.getFunctionManager();

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

			for (String needleRaw : needles) {
				String needle = needleRaw.trim();
				if (needle.isEmpty()) {
					continue;
				}
				root.beginObject();
				root.name("needle").value(needle);

				byte[] pattern = needle.getBytes("US-ASCII");
				Set<Address> matchAddrs = new LinkedHashSet<>();
				Address start = currentProgram.getMinAddress();
				Address found = start;
				while (!monitor.isCancelled()) {
					found = memory.findBytes(found, pattern, null, true, monitor);
					if (found == null) {
						break;
					}
					matchAddrs.add(found);
					try {
						found = found.add(1);
					}
					catch (Exception e) {
						break;
					}
					if (matchAddrs.size() > 50) {
						break;
					}
				}

				// The needle may sit in the middle of a longer string literal; walk
				// backward over printable ASCII to find the real string start, since
				// pointers reference the start, not our substring's offset.
				Set<Address> stringAddrs = new LinkedHashSet<>();
				for (Address matchAddr : matchAddrs) {
					Address cursor = matchAddr;
					for (int i = 0; i < 200; i++) {
						Address prev;
						try {
							prev = cursor.subtract(1);
						}
						catch (Exception e) {
							break;
						}
						byte b;
						try {
							b = memory.getByte(prev);
						}
						catch (Exception e) {
							break;
						}
						if (b < 0x20 || b > 0x7e) {
							break;
						}
						cursor = prev;
					}
					stringAddrs.add(cursor);
					stringAddrs.add(matchAddr);
				}

				root.name("stringHits").value(stringAddrs.size());
				root.name("functions");
				root.beginArray();

				Set<Function> functions = new LinkedHashSet<>();
				for (Address addr : stringAddrs) {
					ReferenceIterator refs = refMgr.getReferencesTo(addr);
					while (refs.hasNext() && !monitor.isCancelled()) {
						Reference ref = refs.next();
						Address fromAddr = ref.getFromAddress();
						Function fn = funcMgr.getFunctionContaining(fromAddr);
						if (fn != null) {
							functions.add(fn);
						}
					}
				}

				File needleDir = new File(outDir, sanitize(needle));
				needleDir.mkdirs();
				int idx = 0;
				for (Function fn : functions) {
					idx++;
					long bodyAddresses = fn.getBody().getNumAddresses();
					String fileName = String.format("%02d_%s_%s.c", idx, fn.getEntryPoint(), sanitize(fn.getName()));
					File outFile = new File(needleDir, fileName);

					root.beginObject();
					root.name("name").value(fn.getName());
					root.name("entry").value(fn.getEntryPoint().toString());
					root.name("addresses").value(bodyAddresses);
					root.name("file").value(outFile.getName());

					String body;
					boolean ok = false;
					if (bodyAddresses > maxAddresses) {
						body = "/* decompile skipped: function body too large (" + bodyAddresses + " addresses) */\n";
					}
					else {
						DecompileResults results = decompiler.decompileFunction(fn, timeoutSeconds, monitor);
						ok = results.decompileCompleted() && results.getDecompiledFunction() != null;
						body = ok ? results.getDecompiledFunction().getC()
							: "/* decompile failed: " + results.getErrorMessage() + " */\n";
					}
					root.name("decompiled").value(ok);

					try (FileWriter writer = new FileWriter(outFile)) {
						writer.write("/*\n needle: " + needle + "\n function: " + fn.getName() + "\n entry: " +
							fn.getEntryPoint() + "\n decompiled: " + ok + "\n*/\n\n");
						writer.write(body);
					}

					root.endObject();
				}

				root.endArray();
				root.endObject();
				println(needle + ": " + stringAddrs.size() + " string hit(s), " + functions.size() +
					" referring function(s)");
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
		if (cleaned.isEmpty()) {
			return "x";
		}
		return cleaned.length() > 80 ? cleaned.substring(0, 80) : cleaned;
	}
}
