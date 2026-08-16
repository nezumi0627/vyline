/* ###
 * IP: GHIDRA
 */
//@category Vyline.Recovery

import java.io.File;
import java.io.FileWriter;
import java.util.Locale;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Listing;

public class ExportProgramSummary extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length < 1) {
			throw new IllegalArgumentException("usage: ExportProgramSummary <output-json>");
		}

		File outputFile = new File(args[0]);
		File parent = outputFile.getParentFile();
		if (parent != null) {
			parent.mkdirs();
		}

		Gson gson = new GsonBuilder().setPrettyPrinting().create();
		Listing listing = currentProgram.getListing();
		JsonObject root = new JsonObject();
		root.addProperty("programName", currentProgram.getName());
		root.addProperty("executablePath", currentProgram.getExecutablePath());
		root.addProperty("languageId", currentProgram.getLanguageID().toString());
		root.addProperty("compilerSpec", currentProgram.getCompilerSpec().getCompilerSpecID().toString());

		int totalFunctions = 0;
		JsonArray sampleFunctions = new JsonArray();
		FunctionIterator functionIterator = listing.getFunctions(true);
		while (functionIterator.hasNext() && !monitor.isCancelled()) {
			Function function = functionIterator.next();
			totalFunctions++;
			if (sampleFunctions.size() >= 5000) {
				continue;
			}
			JsonObject item = new JsonObject();
			item.addProperty("name", function.getName());
			item.addProperty("entry", function.getEntryPoint().toString());
			item.addProperty("thunk", function.isThunk());
			item.addProperty("external", function.isExternal());
			sampleFunctions.add(item);
		}
		root.addProperty("totalFunctions", totalFunctions);
		root.add("sampleFunctions", sampleFunctions);

		int totalStrings = 0;
		JsonArray sampleStrings = new JsonArray();
		DataIterator dataIterator = listing.getDefinedData(true);
		while (dataIterator.hasNext() && !monitor.isCancelled()) {
			Data data = dataIterator.next();
			String typeName = data.getDataType().getName().toLowerCase(Locale.ROOT);
			if (!typeName.contains("unicode") && !typeName.contains("string")) {
				continue;
			}
			String value = data.getDefaultValueRepresentation();
			if (value == null || value.length() <= 4) {
				continue;
			}
			totalStrings++;
			if (sampleStrings.size() >= 2000) {
				continue;
			}
			JsonObject item = new JsonObject();
			item.addProperty("address", data.getAddress().toString());
			item.addProperty("type", data.getDataType().getName());
			item.addProperty("value", value);
			sampleStrings.add(item);
		}
		root.addProperty("totalDefinedStrings", totalStrings);
		root.add("sampleDefinedStrings", sampleStrings);

		try (FileWriter writer = new FileWriter(outputFile)) {
			gson.toJson(root, writer);
		}

		println("Wrote summary to " + outputFile.getAbsolutePath());
	}
}
