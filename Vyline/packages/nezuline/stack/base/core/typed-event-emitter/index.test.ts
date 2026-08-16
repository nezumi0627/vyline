import { assertEquals } from "jsr:@std/assert@^1.0.2";
import { TypedEventEmitter } from "./index.ts";

Deno.test("promise() should be vaild", async () => {
	type Events = {
		example: (v: number) => void;
	};
	class Client extends TypedEventEmitter<Events, "example"> {}
	const client = new Client();

	const promise = client.waitFor("example");

	client.emit("example", 123456);

	const [v] = await promise;

	assertEquals(v, 123456);
});
