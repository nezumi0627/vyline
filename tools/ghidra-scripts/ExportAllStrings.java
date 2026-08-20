/* ###
 * IP: GHIDRA
 */
//@category Vyline.Recovery

import java.io.File;
import java.io.FileWriter;

import com.google.gson.stream.JsonWriter;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Listing;

/**
 * Dumps EVERY defined string/unicode Data item in the program (no sampling cap),
 * so we can grep for exact symbols like "sendMessage" across the whole binary.
 *
 * usage: ExportAllStrings <output-json> [minLength]
 */
public class ExportAllStrings extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length < 1) {
			throw new IllegalArgumentException("usage: ExportAllStrings <output-json> [minLength]");
		}

		File outputFile = new File(args[0]);
		File parent = outputFile.getParentFile();
		if (parent != null) {
			parent.mkdirs();
		}
		int minLength = args.length >= 2 ? Integer.parseInt(args[1]) : 3;

		Listing listing = currentProgram.getListing();
		int total = 0;
		int written = 0;

		try (JsonWriter writer = new JsonWriter(new FileWriter(outputFile))) {
			writer.beginObject();
			writer.name("programName").value(currentProgram.getName());
			writer.name("minLength").value(minLength);
			writer.name("strings");
			writer.beginArray();

			DataIterator dataIterator = listing.getDefinedData(true);
			while (dataIterator.hasNext() && !monitor.isCancelled()) {
				Data data = dataIterator.next();
				String typeName = data.getDataType().getName().toLowerCase(java.util.Locale.ROOT);
				if (!typeName.contains("unicode") && !typeName.contains("string")) {
					continue;
				}
				String value = data.getDefaultValueRepresentation();
				if (value == null || value.length() < minLength) {
					continue;
				}
				total++;
				writer.beginObject();
				writer.name("a").value(data.getAddress().toString());
				writer.name("v").value(value);
				writer.endObject();
				written++;
			}

			writer.endArray();
			writer.name("total").value(total);
			writer.endObject();
		}

		println("Exported " + written + " strings to " + outputFile.getAbsolutePath());
	}
}
