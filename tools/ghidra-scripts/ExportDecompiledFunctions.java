/* ###
 * IP: GHIDRA
 */
//@category Vyline.Recovery

import java.io.File;
import java.io.FileWriter;
import java.nio.file.Files;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Listing;

public class ExportDecompiledFunctions extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length < 1) {
			throw new IllegalArgumentException(
				"usage: ExportDecompiledFunctions <output-directory> [timeout-seconds] [max-addresses]");
		}

		File outDir = new File(args[0]);
		outDir.mkdirs();
		int timeoutSeconds = args.length >= 2 ? Integer.parseInt(args[1]) : 10;
		long maxAddresses = args.length >= 3 ? Long.parseLong(args[2]) : 250;

		Gson gson = new GsonBuilder().setPrettyPrinting().create();
		JsonObject root = new JsonObject();
		root.addProperty("programName", currentProgram.getName());
		root.addProperty("outputDir", outDir.getAbsolutePath());
		root.addProperty("timeoutSeconds", timeoutSeconds);
		root.addProperty("maxAddresses", maxAddresses);

		JsonArray files = new JsonArray();
		int totalFunctions = 0;
		int exportedFunctions = 0;
		int reusedFunctions = 0;
		int skippedLargeFunctions = 0;

		DecompInterface decompiler = new DecompInterface();
		decompiler.setOptions(new DecompileOptions());
		decompiler.toggleCCode(true);
		decompiler.toggleSyntaxTree(false);
		decompiler.setSimplificationStyle("decompile");

		if (!decompiler.openProgram(currentProgram)) {
			throw new IllegalStateException(
				"failed to open program for decompiler: " + decompiler.getLastMessage());
		}

		try {
			Listing listing = currentProgram.getListing();
			FunctionIterator functionIterator = listing.getFunctions(true);
			while (functionIterator.hasNext() && !monitor.isCancelled()) {
				Function function = functionIterator.next();
				totalFunctions++;

				String entry = function.getEntryPoint().toString();
				String baseName = String.format(
					"%04d_%s_%s.c",
					totalFunctions,
					entry,
					sanitize(function.getName()));
				File outFile = new File(outDir, baseName);
				long bodyAddresses = function.getBody().getNumAddresses();
				boolean reused = isReusable(outFile);
				boolean skippedLarge = false;

				String body;
				boolean ok = false;
				if (reused) {
					reusedFunctions++;
					body = "/* existing file kept */\n";
				}
				else if (bodyAddresses > maxAddresses) {
					skippedLarge = true;
					skippedLargeFunctions++;
					body = "/* decompile skipped: function body too large (" + bodyAddresses +
						" addresses) */\n";
				}
				else {
					DecompileResults results =
						decompiler.decompileFunction(function, timeoutSeconds, monitor);
					ok = results.decompileCompleted() && results.getDecompiledFunction() != null;
					if (ok) {
						exportedFunctions++;
						body = results.getDecompiledFunction().getC();
					}
					else {
						String err = results.getErrorMessage();
						body = "/* decompile failed: " + (err == null ? "unknown" : err) + " */\n";
					}
				}

				if (!reused) {
					try (FileWriter writer = new FileWriter(outFile)) {
						writer.write("/*\n");
						writer.write(" program: " + currentProgram.getName() + "\n");
						writer.write(" function: " + function.getName() + "\n");
						writer.write(" entry: " + entry + "\n");
						writer.write(" decompiled: " + ok + "\n");
						writer.write(" addresses: " + bodyAddresses + "\n");
						if (skippedLarge) {
							writer.write(" skipped_large: true\n");
						}
						writer.write("*/\n\n");
						writer.write(body);
						writer.write("\n");
					}
				}

				JsonObject item = new JsonObject();
				item.addProperty("name", function.getName());
				item.addProperty("entry", entry);
				item.addProperty("file", outFile.getName());
				item.addProperty("addresses", bodyAddresses);
				item.addProperty("decompiled", ok);
				item.addProperty("reused", reused);
				item.addProperty("skippedLarge", skippedLarge);
				files.add(item);
			}
		}
		finally {
			decompiler.dispose();
		}

		root.addProperty("totalFunctions", totalFunctions);
		root.addProperty("exportedFunctions", exportedFunctions);
		root.addProperty("reusedFunctions", reusedFunctions);
		root.addProperty("skippedLargeFunctions", skippedLargeFunctions);
		root.add("files", files);

		try (FileWriter writer = new FileWriter(new File(outDir, "_index.json"))) {
			gson.toJson(root, writer);
		}

		println("Exported " + exportedFunctions + ", reused " + reusedFunctions + ", skipped " +
			skippedLargeFunctions + " / " + totalFunctions + " functions to " +
			outDir.getAbsolutePath());
	}

	private String sanitize(String name) {
		if (name == null || name.isEmpty()) {
			return "anonymous";
		}
		String cleaned = name.replaceAll("[^A-Za-z0-9._-]+", "_");
		cleaned = cleaned.replaceAll("_+", "_");
		cleaned = cleaned.replaceAll("^_+", "");
		cleaned = cleaned.replaceAll("_+$", "");
		if (cleaned.isEmpty()) {
			return "anonymous";
		}
		if (cleaned.length() > 80) {
			return cleaned.substring(0, 80);
		}
		return cleaned;
	}

	private boolean isReusable(File outFile) throws Exception {
		if (!outFile.isFile() || outFile.length() <= 0) {
			return false;
		}
		String text = Files.readString(outFile.toPath());
		return text.contains("decompiled: true") || text.contains("skipped_large: true");
	}
}
